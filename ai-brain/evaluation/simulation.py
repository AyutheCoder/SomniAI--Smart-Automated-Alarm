"""Validate the inverse planning *algorithm* against known ground truth.

Step 10 established that the planner's recommendation cannot be checked on
observational data: it promises an outcome conditional on a bedtime nobody in
LifeSnaps or PMData actually adopted. That leaves the paper's central mechanism
unevaluated, which is the strongest reason a reviewer has to reject it.

Simulation closes exactly that gap and nothing more. With a ground-truth
reliability function in hand the counterfactual becomes computable, so the
questions the real data cannot answer become decidable by exhaustive search:

  * does the bedtime sweep return the genuinely *latest* admissible bedtime that
    meets the target, or merely an adequate one?
  * when bedtime alone is insufficient, does coordinate ascent find a *minimal*
    sufficient set of changes, or just a sufficient one?
  * does an infeasibility verdict coincide with genuine infeasibility - no false
    refusals, no promises that cannot be kept?

What this does **not** establish is that following the advice improves anyone's
waking. That needs a deployment study. The paper should state the division
plainly: algorithm validated here, model validated on real cohorts, end-to-end
effect out of scope.
"""

from __future__ import annotations

import itertools
import os
import sys
from contextlib import contextmanager
from typing import Callable

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import wake_plan  # noqa: E402
from feature_spec import FEATURE_DEFAULTS  # noqa: E402

# How far a single lever may be pushed, in units of its step.
#
# `_optimize_plan` advances the chosen lever by 3 steps per round and may pick
# the same lever every round, so with `max_rounds` rounds one lever can travel
# 3 x max_rounds steps. The ground-truth set must cover at least that far or it
# is narrower than what the planner can reach - and then any "broken promise" it
# reports is an artifact of the measurement rather than a fault in the planner.
# Values clamp to each lever's admissible range, so this saturates quickly and
# the search stays tractable.
ROUNDS_DEFAULT = 3
STEPS_PER_ROUND = 3
MAX_STEPS = STEPS_PER_ROUND * ROUNDS_DEFAULT
Model = Callable[[dict], float]


@contextmanager
def planner_using_fn(model: Model, sleep_hours: float = 7.5):
    """Point `wake_plan` at an analytic ground-truth function."""
    originals = (wake_plan.predict_wake_success,
                 wake_plan.predict_wake_success_batch,
                 wake_plan.predict_sleep)
    wake_plan.predict_wake_success = lambda f: {"wakeSuccessProbability": model(f or {})}
    wake_plan.predict_wake_success_batch = lambda rows: [model(r or {}) for r in rows]
    wake_plan.predict_sleep = lambda f: {"predictedSleepDuration": sleep_hours}
    try:
        yield
    finally:
        (wake_plan.predict_wake_success,
         wake_plan.predict_wake_success_batch,
         wake_plan.predict_sleep) = originals


def _current(features: dict, name: str) -> float:
    return float(features.get(name, FEATURE_DEFAULTS[name]))


def lever_values(features: dict, name: str, max_steps: int = MAX_STEPS,
                 levers: list | None = None) -> list[float]:
    """Every value a lever can take, at 0..MAX_STEPS of movement.

    Mirrors `wake_plan`'s own candidate rule exactly. If these diverged, the
    "ground truth" would be over a set the planner cannot reach and every
    comparison below would be meaningless.
    """
    for lname, direction, lo, hi, step, _label in (levers or wake_plan.CONTROLLABLE):
        if lname != name:
            continue
        cur = _current(features, name)
        if direction == 0:
            return sorted({cur, wake_plan.IDEAL_ROOM_TEMP})
        seen = {cur}
        for k in range(1, max_steps + 1):
            seen.add(wake_plan._clamp(cur + direction * step * k, lo, hi))
        return sorted(seen, reverse=direction < 0)
    raise KeyError(name)


def bedtime_grid() -> list[float]:
    steps = int(round((wake_plan.BEDTIME_MAX - wake_plan.BEDTIME_MIN) / wake_plan.BEDTIME_STEP)) + 1
    return [wake_plan.BEDTIME_MAX - i * wake_plan.BEDTIME_STEP for i in range(steps)]


# ---------------------------------------------------------------------------
# Ground truth by exhaustive search
# ---------------------------------------------------------------------------


def true_latest_bedtime(model: Model, features: dict, target: float) -> float | None:
    """The latest grid bedtime meeting `target`, everything else untouched."""
    best = None
    for bedtime in bedtime_grid():                    # already latest-first
        trial = dict(features, bedtime_hour=bedtime)
        if model(trial) >= target:
            return bedtime
    return best


def true_reachability(model: Model, features: dict, target: float,
                      max_steps: int = MAX_STEPS, levers: list | None = None) -> dict:
    """Exhaustive search of the whole reachable set.

    Returns whether the target is attainable at all, the best reliability
    available, and the fewest distinct levers needed to attain it. This is the
    answer the planner is graded against.
    """
    levers = levers or wake_plan.CONTROLLABLE
    others = [name for name, *_ in levers if name != "bedtime_hour"]
    option_lists = [lever_values(features, name, max_steps, levers) for name in others]
    baselines = {name: _current(features, name) for name in others}

    best_rel = 0.0
    min_levers: int | None = None

    for combo in itertools.product(*option_lists):
        trial = dict(features)
        touched = 0
        for name, value in zip(others, combo):
            trial[name] = value
            if abs(value - baselines[name]) > 1e-9:
                touched += 1
        for bedtime in bedtime_grid():
            trial["bedtime_hour"] = bedtime
            rel = model(trial)
            if rel > best_rel:
                best_rel = rel
            if rel >= target:
                moved = touched + (
                    1 if abs(bedtime - _current(features, "bedtime_hour")) > 1e-9 else 0
                )
                if min_levers is None or moved < min_levers:
                    min_levers = moved
    return {
        "feasible": min_levers is not None,
        "best_reliability": best_rel,
        "minimal_levers": min_levers,
    }


# ---------------------------------------------------------------------------
# Grading one scenario
# ---------------------------------------------------------------------------


def grade(model: Model, features: dict, target: float,
          check_minimality: bool = True, max_steps: int = MAX_STEPS,
          levers: list | None = None) -> dict:
    """Compare the planner's output against exhaustive ground truth."""
    with planner_using_fn(model):
        plan = wake_plan.plan_wake({"features": dict(features),
                                    "requiredReliability": target})

    truth_bedtime = true_latest_bedtime(model, features, target)
    truth = (true_reachability(model, features, target, max_steps=max_steps, levers=levers)
             if check_minimality else {"feasible": None, "minimal_levers": None})

    planned_bedtime = plan["recommendedBedtimeHour"]
    result = {
        "target": target,
        # Bedtime sweep: did it find the latest admissible bedtime?
        "bedtime_truth": truth_bedtime,
        "bedtime_planned": planned_bedtime,
        "bedtime_found": (truth_bedtime is None) == (planned_bedtime is None),
        "bedtime_optimal": (
            truth_bedtime is None and planned_bedtime is None
        ) or (
            truth_bedtime is not None and planned_bedtime is not None
            and abs(truth_bedtime - planned_bedtime) < 1e-6
        ),
        # Feasibility verdict against genuine reachability.
        "truth_feasible": truth["feasible"],
        "planner_promises": bool(plan["reachesTarget"]),
        # Count distinct levers the plan actually moves. A bedtime recommendation
        # that differs from the current one is a moved lever even though it is
        # reported separately from `combinedPlan`; counting only the latter would
        # make a bedtime-only plan look like zero changes.
        "planner_levers": (
            len(plan["combinedPlan"])
            + (1 if planned_bedtime is not None
               and abs(planned_bedtime - _current(features, "bedtime_hour")) > 1e-9
               else 0)
        ),
        "truth_minimal_levers": truth["minimal_levers"],
    }
    if truth["feasible"] is not None:
        result["false_refusal"] = truth["feasible"] and not result["planner_promises"]
        result["broken_promise"] = (not truth["feasible"]) and result["planner_promises"]
        result["verdict_correct"] = truth["feasible"] == result["planner_promises"]
    return result


def study(scenarios: dict[str, tuple[Model, dict]],
          targets: tuple[float, ...] = (0.5, 0.6, 0.7, 0.8, 0.9, 0.95),
          check_minimality: bool = True,
          max_steps: int = MAX_STEPS,
          levers: list | None = None) -> pd.DataFrame:
    """Grade every (scenario, target) pair."""
    rows = []
    for name, (model, features) in scenarios.items():
        for target in targets:
            rows.append({"scenario": name,
                         **grade(model, features, target,
                                 check_minimality=check_minimality,
                                 max_steps=max_steps, levers=levers)})
    return pd.DataFrame(rows)
