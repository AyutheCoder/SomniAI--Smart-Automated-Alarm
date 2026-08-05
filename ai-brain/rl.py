"""Continuous-learning RL policy for adaptive wake-up (M14 / C1).

A lightweight, *stateless* per-user contextual bandit served to the Next.js
backend via `POST /rl/update`. The server holds no per-user state: the caller
passes the user's serialized policy in, and we return an updated one to persist
in MongoDB (see `models/RlPolicy.ts`). This keeps the AI Brain horizontally
scalable and mirrors the research implementation in
`research/sim/bandit.py` (disjoint LinUCB), reduced to a JSON-friendly form.

Formulation (spec Section 20.1): at each wake episode the agent observes a
context `s` (chronotype, fatigue, task importance, sleep debt, weekend), picks
an action `a = (offset, strategy)` from a small grid, and receives

    r = w1 * 1[woke before deadline]
      - w2 * snoozes
      - w3 * TTW(min)
      - w4 * aggressiveness(a)
      + w5 * satisfaction

We learn a disjoint **LinUCB** policy minimizing regret. Everything is pure
Python (no numpy) so the policy serializes to plain JSON and the module has zero
import cost - consistent with the "graceful degradation" principle: even a tiny
deployment can run the loop.
"""

from __future__ import annotations

import math
from typing import Any

# ------------------------------------------------------------------------------
# Action grid + context features
# ------------------------------------------------------------------------------

OFFSET_CHOICES_MIN = (-20, -10, 0)
STRATEGY_CHOICES = ("gentle", "adaptive", "aggressive")
# Intensity is implied by the strategy to keep the arm count small (9 arms).
_STRATEGY_INTENSITY = {"gentle": 40, "adaptive": 70, "aggressive": 100}
_STRATEGY_IDX = {s: i for i, s in enumerate(STRATEGY_CHOICES)}

# Ordered action grid: (offsetMin, strategy). Index == arm id.
ACTION_GRID: list[dict[str, Any]] = [
    {"offsetMin": off, "strategy": strat, "intensity": _STRATEGY_INTENSITY[strat]}
    for off in OFFSET_CHOICES_MIN
    for strat in STRATEGY_CHOICES
]
N_ARMS = len(ACTION_GRID)
FEATURE_DIM = 6  # [bias, chronotype, fatigue, importance, sleep_debt, weekend]

# Default reward weights (spec Section 20.1).
DEFAULT_WEIGHTS = {"w1": 1.0, "w2": 0.3, "w3": 0.02, "w4": 0.3, "w5": 0.5}
_ALPHA = 0.6  # UCB exploration coefficient


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _num(value: Any, default: float) -> float:
    try:
        if value is None:
            return float(default)
        return float(value)
    except (TypeError, ValueError):
        return float(default)


_CHRONO_CODE = {"lark": 0, "intermediate": 1, "owl": 2}


def context_features(context: dict | None) -> list[float]:
    """Map a context dict to a fixed `FEATURE_DIM` feature vector in [0, 1]."""
    ctx = context or {}
    chrono = ctx.get("chronotype")
    if isinstance(chrono, str):
        chrono_code = _CHRONO_CODE.get(chrono.lower(), 1)
    else:
        chrono_code = int(_clamp(_num(ctx.get("chronotypeCode"), 1), 0, 2))
    fatigue = _clamp(_num(ctx.get("fatigueScore"), 40.0) / 100.0)
    importance = _clamp(_num(ctx.get("taskImportance"), 0.5))
    # Sleep debt expressed in hours, normalized by a 4 h cap.
    debt = _clamp(_num(ctx.get("sleepDebtHours"), 0.5) / 4.0, 0.0, 1.0)
    weekend = 1.0 if ctx.get("isWeekend") else 0.0
    return [1.0, chrono_code / 2.0, fatigue, importance, debt, weekend]


def aggressiveness(action: dict | None) -> float:
    """A 0..1 burden proxy for an action (louder + earlier == more aggressive)."""
    a = action or {}
    intensity = _clamp(_num(a.get("intensity"), 70.0) / 100.0)
    strat = a.get("strategy", "adaptive")
    strat_idx = _STRATEGY_IDX.get(strat, 1) / (len(STRATEGY_CHOICES) - 1)
    offset = abs(_num(a.get("offsetMin"), 0.0))
    early = _clamp(offset / 30.0)
    return _clamp(0.55 * intensity + 0.30 * strat_idx + 0.15 * early)


# ------------------------------------------------------------------------------
# Tiny linear algebra (FEATURE_DIM is small, so pure-Python is plenty fast)
# ------------------------------------------------------------------------------


def _identity(d: int) -> list[list[float]]:
    return [[1.0 if i == j else 0.0 for j in range(d)] for i in range(d)]


def _matvec(m: list[list[float]], v: list[float]) -> list[float]:
    return [sum(m[i][j] * v[j] for j in range(len(v))) for i in range(len(m))]


def _dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def _sherman_morrison(a_inv: list[list[float]], x: list[float]) -> list[list[float]]:
    """Rank-1 update of an inverse for `A <- A + x x^T`."""
    d = len(x)
    ax = _matvec(a_inv, x)  # A_inv x
    denom = 1.0 + _dot(x, ax)
    if denom <= 1e-12:
        return a_inv
    # A_inv_new = A_inv - (ax)(ax)^T / denom (since A_inv is symmetric)
    return [
        [a_inv[i][j] - ax[i] * ax[j] / denom for j in range(d)]
        for i in range(d)
    ]


# ------------------------------------------------------------------------------
# Policy lifecycle
# ------------------------------------------------------------------------------


def new_policy() -> dict[str, Any]:
    """A fresh disjoint-LinUCB policy serialized as plain JSON."""
    return {
        "version": 1,
        "kind": "linucb",
        "d": FEATURE_DIM,
        "nArms": N_ARMS,
        "alpha": _ALPHA,
        "AInv": [_identity(FEATURE_DIM) for _ in range(N_ARMS)],
        "b": [[0.0] * FEATURE_DIM for _ in range(N_ARMS)],
        "counts": [0] * N_ARMS,
        "n": 0,
        "rewardSum": 0.0,
    }


def _coerce_policy(policy: dict | None) -> dict[str, Any]:
    if not policy or policy.get("kind") != "linucb":
        return new_policy()
    if policy.get("d") != FEATURE_DIM or policy.get("nArms") != N_ARMS:
        return new_policy()
    # Shallow structural validation; rebuild on any inconsistency.
    try:
        if len(policy["AInv"]) != N_ARMS or len(policy["b"]) != N_ARMS:
            return new_policy()
    except (KeyError, TypeError):
        return new_policy()
    policy.setdefault("counts", [0] * N_ARMS)
    policy.setdefault("n", 0)
    policy.setdefault("rewardSum", 0.0)
    policy.setdefault("alpha", _ALPHA)
    return policy


def _theta(policy: dict, arm: int) -> list[float]:
    return _matvec(policy["AInv"][arm], policy["b"][arm])


def _best_arm(policy: dict, x: list[float], explore: bool = True) -> int:
    alpha = policy.get("alpha", _ALPHA) if explore else 0.0
    best_i, best_score = 0, -1e18
    for arm in range(N_ARMS):
        a_inv = policy["AInv"][arm]
        mean = _dot(_theta(policy, arm), x)
        bonus = alpha * math.sqrt(max(0.0, _dot(x, _matvec(a_inv, x))))
        score = mean + bonus
        if score > best_score:
            best_i, best_score = arm, score
    return best_i


def reward_from_outcome(
    outcome: str,
    *,
    snoozes: float = 0.0,
    ttw_min: float = 0.0,
    action: dict | None = None,
    satisfaction: float = 0.0,
    weights: dict | None = None,
) -> float:
    """Compute the scalar reward from an episode outcome (spec Section 20.1)."""
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    woke = 1.0 if outcome in ("success", "snooze") else 0.0
    r = (
        w["w1"] * woke
        - w["w2"] * max(0.0, _num(snoozes, 0.0))
        - w["w3"] * max(0.0, _num(ttw_min, 0.0))
        - w["w4"] * aggressiveness(action)
        + w["w5"] * _clamp(_num(satisfaction, 0.0), -1.0, 1.0)
    )
    # Keep rewards in a sane band for stable online updates.
    return round(max(-2.0, min(2.0, r)), 4)


def recommend(policy: dict | None, context: dict | None) -> dict[str, Any]:
    """Greedily recommend the best action for a context (no exploration)."""
    pol = _coerce_policy(policy)
    x = context_features(context)
    arm = _best_arm(pol, x, explore=False)
    action = dict(ACTION_GRID[arm])
    action["aggressiveness"] = round(aggressiveness(action), 3)
    action["expectedReward"] = round(_dot(_theta(pol, arm), x), 4)
    return action


def summarize(policy: dict | None) -> dict[str, Any]:
    """Human-readable policy summary for explainability + the analytics UI."""
    pol = _coerce_policy(policy)
    n = int(pol.get("n", 0))
    counts = pol.get("counts", [0] * N_ARMS)
    # Most-exercised action and the currently-preferred action at neutral context.
    fav_arm = max(range(N_ARMS), key=lambda i: counts[i]) if n else 1
    neutral = context_features({})
    best_arm = _best_arm(pol, neutral, explore=False)
    return {
        "updates": n,
        "meanReward": round(pol.get("rewardSum", 0.0) / n, 4) if n else 0.0,
        "preferredAction": dict(ACTION_GRID[best_arm]),
        "mostUsedAction": dict(ACTION_GRID[fav_arm]),
        "explored": sum(1 for c in counts if c > 0),
        "totalArms": N_ARMS,
    }


def update(payload: dict | None) -> dict[str, Any]:
    """Online update from a single feedback event; returns the new policy.

    Request body keys:
      `policy`       previously persisted policy (or null for a fresh one)
      `context`      dict (chronotype, fatigueScore, taskImportance, ...)
      `action`       dict (offsetMin, strategy, intensity) actually taken
      `outcome`      "success" | "snooze" | "missed"
      `snoozes`      int (optional)
      `ttwMin`       float minutes alarm+verified (optional)
      `satisfaction` float in [-1, 1] (optional)
      `reward`       explicit reward override (optional)
    """
    payload = payload or {}
    pol = _coerce_policy(payload.get("policy"))
    context = payload.get("context") or {}
    action = payload.get("action") or {}
    outcome = str(payload.get("outcome", "success"))

    reward = payload.get("reward")
    if reward is None:
        reward = reward_from_outcome(
            outcome,
            snoozes=payload.get("snoozes", 0),
            ttw_min=payload.get("ttwMin", 0),
            action=action,
            satisfaction=payload.get("satisfaction", 0),
            weights=payload.get("weights"),
        )
    else:
        reward = round(max(-2.0, min(2.0, _num(reward, 0.0))), 4)

    # Map the taken action to the nearest arm in the grid.
    arm = _action_to_arm(action)
    x = context_features(context)

    # Disjoint LinUCB update: A_arm += x x^T (via Sherman-Morrison), b_arm += r x.
    pol["AInv"][arm] = _sherman_morrison(pol["AInv"][arm], x)
    pol["b"][arm] = [pol["b"][arm][i] + reward * x[i] for i in range(FEATURE_DIM)]
    pol["counts"][arm] = int(pol["counts"][arm]) + 1
    pol["n"] = int(pol.get("n", 0)) + 1
    pol["rewardSum"] = float(pol.get("rewardSum", 0.0)) + reward

    recommended = recommend(pol, context)
    return {
        "policy": pol,
        "reward": reward,
        "recommendedAction": recommended,
        "summary": summarize(pol),
    }


def _action_to_arm(action: dict | None) -> int:
    a = action or {}
    strat = a.get("strategy", "adaptive")
    if strat not in _STRATEGY_IDX:
        strat = "adaptive"
    off = _num(a.get("offsetMin"), 0.0)
    # Snap offset to the nearest grid choice.
    nearest_off = min(OFFSET_CHOICES_MIN, key=lambda o: abs(o - off))
    for i, act in enumerate(ACTION_GRID):
        if act["offsetMin"] == nearest_off and act["strategy"] == strat:
            return i
    return _STRATEGY_IDX.get(strat, 1)  # fallback (offset 0 block)


__all__ = [
    "ACTION_GRID",
    "N_ARMS",
    "FEATURE_DIM",
    "context_features",
    "aggressiveness",
    "reward_from_outcome",
    "new_policy",
    "recommend",
    "summarize",
    "update",
]