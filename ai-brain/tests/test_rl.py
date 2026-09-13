"""Tests for the disjoint-LinUCB wake-strategy policy.

Two things carry the weight here. The Sherman-Morrison update is the numerical
core - if it drifts, the policy silently learns the wrong thing and nothing else
in the system notices - so it is checked against the definition it claims to
implement rather than against a recorded snapshot. Arm selection is checked for
the properties that make it a bandit at all: it exploits what it has learned,
and it still explores what it has not tried.
"""

from __future__ import annotations

import json
import math

import pytest

import rl


# ---------------------------------------------------------------------------
# Helpers: independent linear algebra, so the tests do not reuse the code under
# test to check itself.
# ---------------------------------------------------------------------------


def matmul(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    n, k, m = len(a), len(b), len(b[0])
    return [[sum(a[i][t] * b[t][j] for t in range(k)) for j in range(m)] for i in range(n)]


def outer(x: list[float]) -> list[list[float]]:
    return [[x[i] * x[j] for j in range(len(x))] for i in range(len(x))]


def add(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    return [[a[i][j] + b[i][j] for j in range(len(a[0]))] for i in range(len(a))]


def assert_is_identity(m: list[list[float]], tol: float = 1e-9) -> None:
    for i, row in enumerate(m):
        for j, value in enumerate(row):
            assert value == pytest.approx(1.0 if i == j else 0.0, abs=tol)


# ---------------------------------------------------------------------------
# Sherman-Morrison
# ---------------------------------------------------------------------------


def test_rank_one_update_really_inverts_the_updated_matrix():
    """A_inv_new must be the true inverse of A + x x^T, not merely close."""
    d = rl.FEATURE_DIM
    a = rl._identity(d)
    a_inv = rl._identity(d)
    x = [1.0, 0.5, 0.25, 0.75, 0.1, 1.0]

    a_inv_new = rl._sherman_morrison(a_inv, x)
    a_new = add(a, outer(x))

    assert_is_identity(matmul(a_new, a_inv_new))


def test_stays_correct_across_a_sequence_of_updates():
    """Errors in a rank-1 update compound, so one step proving out is not enough."""
    d = rl.FEATURE_DIM
    a = rl._identity(d)
    a_inv = rl._identity(d)
    contexts = [
        [1.0, 0.0, 0.4, 0.5, 0.125, 0.0],
        [1.0, 0.5, 0.9, 0.2, 0.75, 1.0],
        [1.0, 1.0, 0.1, 0.8, 0.5, 0.0],
        [1.0, 0.5, 0.6, 0.6, 0.25, 1.0],
    ]
    for x in contexts:
        a_inv = rl._sherman_morrison(a_inv, x)
        a = add(a, outer(x))

    assert_is_identity(matmul(a, a_inv), tol=1e-8)


def test_preserves_symmetry():
    """The derivation assumes a symmetric inverse; losing that breaks the bonus."""
    a_inv = rl._sherman_morrison(rl._identity(rl.FEATURE_DIM),
                                 [1.0, 0.3, 0.7, 0.2, 0.9, 1.0])
    for i in range(len(a_inv)):
        for j in range(len(a_inv)):
            assert a_inv[i][j] == pytest.approx(a_inv[j][i], abs=1e-12)


def test_shrinks_uncertainty_in_the_direction_observed():
    """Seeing a context must reduce the exploration bonus along it."""
    x = [1.0, 0.5, 0.5, 0.5, 0.5, 0.5]
    before = rl._dot(x, rl._matvec(rl._identity(rl.FEATURE_DIM), x))
    a_inv = rl._sherman_morrison(rl._identity(rl.FEATURE_DIM), x)
    after = rl._dot(x, rl._matvec(a_inv, x))

    assert after < before
    assert after > 0  # but never collapses to certainty from one observation


def test_declines_a_degenerate_update_rather_than_dividing_by_zero():
    # Contrived: a real A_inv is positive definite, so the denominator cannot
    # vanish. The guard exists so a corrupted stored policy cannot crash serving.
    unchanged = rl._sherman_morrison([[-1.0]], [1.0])
    assert unchanged == [[-1.0]]


# ---------------------------------------------------------------------------
# Arm selection
# ---------------------------------------------------------------------------


NEUTRAL = {"chronotype": "intermediate", "fatigueScore": 40, "taskImportance": 0.5}


def train(policy, context, action, reward, times=1):
    for _ in range(times):
        policy = rl.update(
            {"policy": policy, "context": context, "action": action, "reward": reward}
        )["policy"]
    return policy


def test_an_untrained_policy_has_no_preference():
    """All arms are identical at initialisation, so the first is as good as any."""
    policy = rl.new_policy()
    x = rl.context_features(NEUTRAL)
    assert rl._best_arm(policy, x, explore=False) == 0


def test_learns_to_prefer_the_arm_that_paid_off():
    policy = rl.new_policy()
    target = rl.ACTION_GRID[7]  # (offset -10, aggressive)
    policy = train(policy, NEUTRAL, target, reward=1.8, times=5)

    chosen = rl.recommend(policy, NEUTRAL)
    assert chosen["offsetMin"] == target["offsetMin"]
    assert chosen["strategy"] == target["strategy"]
    assert chosen["expectedReward"] > 0


def test_learns_to_avoid_an_arm_that_was_punished():
    policy = rl.new_policy()
    punished = rl.ACTION_GRID[2]
    policy = train(policy, NEUTRAL, punished, reward=-1.9, times=5)

    chosen = rl.recommend(policy, NEUTRAL)
    assert (chosen["offsetMin"], chosen["strategy"]) != (
        punished["offsetMin"], punished["strategy"]
    )


TIRED = {"chronotype": "owl", "fatigueScore": 95, "taskImportance": 0.9,
         "sleepDebtHours": 3.5}
RESTED = {"chronotype": "lark", "fatigueScore": 5, "taskImportance": 0.1,
          "sleepDebtHours": 0.0}


def test_learns_per_context_rather_than_globally():
    """The context steers the recommendation when the evidence discriminates.

    Each arm is trained with opposite rewards in the two contexts, which is what
    a real feedback stream looks like: an aggressive wake that works on an
    exhausted night is resented on a rested one.
    """
    policy = rl.new_policy()
    for _ in range(6):
        policy = train(policy, TIRED, rl.ACTION_GRID[8], reward=1.9)
        policy = train(policy, RESTED, rl.ACTION_GRID[8], reward=-1.9)
        policy = train(policy, RESTED, rl.ACTION_GRID[0], reward=1.9)
        policy = train(policy, TIRED, rl.ACTION_GRID[0], reward=-1.9)

    assert rl.recommend(policy, TIRED)["strategy"] == "aggressive"
    assert rl.recommend(policy, RESTED)["strategy"] == "gentle"


def test_a_single_arm_does_discriminate_between_contexts():
    """Per-arm, the learned weights are genuinely context-sensitive."""
    policy = train(rl.new_policy(), TIRED, rl.ACTION_GRID[8], reward=1.9, times=6)
    theta = rl._theta(policy, 8)

    on_tired = rl._dot(theta, rl.context_features(TIRED))
    on_rested = rl._dot(theta, rl.context_features(RESTED))
    assert on_tired > on_rested * 2


def test_equal_rewards_in_different_contexts_do_not_separate_arms():
    """Documents a real limitation, so it is not discovered by a reviewer.

    Ridge regularisation scales the fitted weights by the inverse of the
    context's norm, so an arm trained on a *low-norm* context (few features
    active) ends up with its weight concentrated on the shared bias term - and
    then scores well on every context, including ones it was never rewarded in.

    Here both arms are rewarded 1.9 in their own context. The arm trained on the
    sparse `RESTED` context wins even when scored on `TIRED`, by a hair. The
    per-arm models are still context-sensitive (see the test above); what fails
    is the cross-arm comparison when the two contexts have different norms.

    This matters for any claim that the policy adapts strategy to context: it
    does so only when the feedback actually discriminates. If the policy is ever
    changed to normalise contexts or drop the shared bias, this test should
    start failing and be replaced rather than repaired.
    """
    policy = rl.new_policy()
    policy = train(policy, TIRED, rl.ACTION_GRID[8], reward=1.9, times=6)
    policy = train(policy, RESTED, rl.ACTION_GRID[0], reward=1.9, times=6)

    x_tired = rl.context_features(TIRED)
    sparse_arm = rl._dot(rl._theta(policy, 0), x_tired)
    dense_arm = rl._dot(rl._theta(policy, 8), x_tired)

    assert sparse_arm > dense_arm
    # The margin is vanishingly small - the arms are effectively tied.
    assert sparse_arm - dense_arm < 0.01


def test_exploration_bonus_favours_the_arm_never_tried():
    """Without this the policy locks onto its first lucky arm forever."""
    policy = rl.new_policy()
    policy = train(policy, NEUTRAL, rl.ACTION_GRID[0], reward=0.05, times=30)
    x = rl.context_features(NEUTRAL)

    # Greedily, the well-tested arm wins on its small positive mean.
    assert rl._best_arm(policy, x, explore=False) == 0
    # With exploration on, an untried arm's uncertainty outweighs that margin.
    assert rl._best_arm(policy, x, explore=True) != 0


def test_exploration_decays_as_evidence_accumulates():
    x = rl.context_features(NEUTRAL)
    policy = rl.new_policy()

    def bonus(pol):
        a_inv = pol["AInv"][0]
        return pol["alpha"] * math.sqrt(max(0.0, rl._dot(x, rl._matvec(a_inv, x))))

    first = bonus(policy)
    policy = train(policy, NEUTRAL, rl.ACTION_GRID[0], reward=1.0, times=10)
    assert bonus(policy) < first


def test_recommend_never_explores():
    """A recommendation shown to a user should not be a deliberate experiment."""
    policy = train(rl.new_policy(), NEUTRAL, rl.ACTION_GRID[4], reward=1.5, times=4)
    x = rl.context_features(NEUTRAL)
    greedy = rl.ACTION_GRID[rl._best_arm(policy, x, explore=False)]
    assert rl.recommend(policy, NEUTRAL)["strategy"] == greedy["strategy"]


def test_every_recommendation_comes_from_the_action_grid():
    policy = train(rl.new_policy(), NEUTRAL, rl.ACTION_GRID[3], reward=1.0, times=3)
    action = rl.recommend(policy, NEUTRAL)
    assert any(
        a["offsetMin"] == action["offsetMin"] and a["strategy"] == action["strategy"]
        for a in rl.ACTION_GRID
    )
    assert 0.0 <= action["aggressiveness"] <= 1.0


# ---------------------------------------------------------------------------
# Mapping a taken action back onto the grid
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("offset,expected", [(-20, -20), (-14, -10), (-7, -10), (3, 0)])
def test_snaps_an_arbitrary_offset_to_the_nearest_grid_point(offset, expected):
    arm = rl._action_to_arm({"offsetMin": offset, "strategy": "gentle"})
    assert rl.ACTION_GRID[arm]["offsetMin"] == expected


def test_falls_back_to_adaptive_for_an_unknown_strategy():
    arm = rl._action_to_arm({"offsetMin": 0, "strategy": "telepathy"})
    assert rl.ACTION_GRID[arm]["strategy"] == "adaptive"


# ---------------------------------------------------------------------------
# Reward shaping and context encoding
# ---------------------------------------------------------------------------


def test_waking_at_all_dominates_the_reward():
    action = {"offsetMin": 0, "strategy": "adaptive", "intensity": 70}
    assert rl.reward_from_outcome("success", action=action) > rl.reward_from_outcome(
        "missed", action=action
    )
    # Snoozing still counts as waking, just less cleanly.
    assert rl.reward_from_outcome("snooze", snoozes=3, action=action) < (
        rl.reward_from_outcome("success", action=action)
    )


def test_penalises_a_more_burdensome_action_for_the_same_outcome():
    gentle = rl.reward_from_outcome(
        "success", action={"offsetMin": 0, "strategy": "gentle", "intensity": 40}
    )
    harsh = rl.reward_from_outcome(
        "success", action={"offsetMin": -20, "strategy": "aggressive", "intensity": 100}
    )
    assert harsh < gentle


def test_keeps_rewards_inside_a_stable_band():
    absurd = rl.reward_from_outcome("success", snoozes=1000, ttw_min=10_000)
    assert -2.0 <= absurd <= 2.0


def test_context_encoding_is_bounded_and_fixed_width():
    for context in ({}, NEUTRAL, {"chronotype": "owl", "fatigueScore": 1e6,
                                  "sleepDebtHours": -50, "isWeekend": True}):
        x = rl.context_features(context)
        assert len(x) == rl.FEATURE_DIM
        assert x[0] == 1.0  # bias term
        assert all(0.0 <= v <= 1.0 for v in x)


def test_unparseable_context_values_fall_back_to_defaults():
    assert rl.context_features({"fatigueScore": "very"}) == rl.context_features({})


# ---------------------------------------------------------------------------
# Policy lifecycle
# ---------------------------------------------------------------------------


def test_update_returns_a_json_serialisable_policy():
    """It is persisted to MongoDB as plain JSON, so it must survive a round trip."""
    result = rl.update({"policy": None, "context": NEUTRAL,
                        "action": rl.ACTION_GRID[1], "outcome": "success"})
    restored = json.loads(json.dumps(result["policy"]))
    assert restored == result["policy"]


def test_update_records_the_episode():
    result = rl.update({"policy": None, "context": NEUTRAL,
                        "action": rl.ACTION_GRID[1], "reward": 1.0})
    policy = result["policy"]
    assert policy["n"] == 1
    assert policy["counts"][1] == 1
    assert policy["rewardSum"] == pytest.approx(1.0)
    assert result["summary"]["updates"] == 1


@pytest.mark.parametrize("corrupt", [
    None,
    {"kind": "not-linucb"},
    {"kind": "linucb", "d": 99, "nArms": rl.N_ARMS},
    {"kind": "linucb", "d": rl.FEATURE_DIM, "nArms": 3},
    {"kind": "linucb", "d": rl.FEATURE_DIM, "nArms": rl.N_ARMS},  # missing AInv
])
def test_rebuilds_a_policy_it_cannot_trust(corrupt):
    policy = rl._coerce_policy(corrupt)
    assert policy["kind"] == "linucb"
    assert policy["d"] == rl.FEATURE_DIM
    assert len(policy["AInv"]) == rl.N_ARMS
    assert policy["n"] == 0


def test_summary_reports_how_much_of_the_grid_has_been_tried():
    policy = rl.new_policy()
    assert rl.summarize(policy)["explored"] == 0

    policy = train(policy, NEUTRAL, rl.ACTION_GRID[0], reward=1.0)
    policy = train(policy, NEUTRAL, rl.ACTION_GRID[5], reward=1.0)
    summary = rl.summarize(policy)
    assert summary["explored"] == 2
    assert summary["totalArms"] == rl.N_ARMS
    assert summary["updates"] == 2
