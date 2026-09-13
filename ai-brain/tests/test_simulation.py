"""Tests for the simulation-validation harness.

This harness grades the planner, so an error here produces a confident wrong
verdict about the paper's central mechanism. Two failure modes matter most and
both already bit during development:

  * the ground-truth reachable set drifting from what the planner can actually
    reach, which manufactures phantom "broken promises";
  * miscounting the levers a plan moves, which manufactures phantom
    minimality results.
"""

from __future__ import annotations

import pytest

import wake_plan
from evaluation import scenarios, simulation

# Enough to exercise every adversarial shape without the full 42-cell grid.
# The complete study lives in `evaluation/run_study.py`.
FAST_SCENARIOS = {k: scenarios.SCENARIOS[k]
                  for k in ("monotone", "non_monotone", "redundant_levers",
                            "ceilinged", "flat")}
FAST_TARGETS = (0.6, 0.8, 0.95)


class TestReachableSetMatchesThePlanner:
    def test_lever_values_use_the_planners_own_step_rule(self):
        feats = dict(scenarios.BASELINE)
        values = simulation.lever_values(feats, "caffeine_mg", max_steps=3)
        # 200 with step 40: one planner round moves 3 steps, i.e. 200 -> 80.
        assert 200.0 in values and 80.0 in values

    def test_lever_values_clamp_to_the_admissible_range(self):
        feats = dict(scenarios.BASELINE)
        for name, _d, lo, hi, _s, _l in wake_plan.CONTROLLABLE:
            for v in simulation.lever_values(feats, name, max_steps=20):
                assert lo - 1e-9 <= v <= hi + 1e-9, name

    def test_the_set_widens_with_the_budget(self):
        feats = dict(scenarios.BASELINE)
        narrow = simulation.lever_values(feats, "stress_level", max_steps=1)
        wide = simulation.lever_values(feats, "stress_level", max_steps=9)
        assert set(narrow) <= set(wide)
        assert len(wide) > len(narrow)

    def test_a_narrow_ground_truth_would_invent_broken_promises(self):
        """Why max_steps must track max_rounds.

        Searching a third of what the planner can reach makes any plan beyond
        that boundary look like a promise the world cannot keep. This test
        exists because that artifact appeared and was briefly mistaken for a
        finding.
        """
        model, feats = scenarios.SCENARIOS["monotone"]
        narrow = simulation.true_reachability(model, feats, 0.90, max_steps=1)
        wide = simulation.true_reachability(model, feats, 0.90, max_steps=9)
        assert wide["best_reliability"] >= narrow["best_reliability"]
        assert not (narrow["feasible"] and not wide["feasible"])

    def test_bedtime_grid_matches_the_planners(self):
        grid = simulation.bedtime_grid()
        assert len(grid) == 25
        assert grid[0] == wake_plan.BEDTIME_MAX
        assert grid[-1] == wake_plan.BEDTIME_MIN
        assert grid == sorted(grid, reverse=True)      # latest first


class TestGroundTruthIsCorrect:
    def test_finds_the_latest_bedtime_by_exhaustive_scan(self):
        # rel = 1 - (bedtime - 20)/10 crosses 0.8 at exactly 22:00.
        model = lambda f: max(0.0, min(1.0, 1.0 - (f["bedtime_hour"] - 20.0) * 0.1))
        got = simulation.true_latest_bedtime(model, {"bedtime_hour": 24.0}, 0.80)
        assert got == pytest.approx(22.0)

    def test_returns_none_when_no_bedtime_suffices(self):
        assert simulation.true_latest_bedtime(lambda f: 0.30, {"bedtime_hour": 24.0}, 0.90) is None

    def test_reports_infeasible_for_a_flat_model(self):
        truth = simulation.true_reachability(scenarios.flat, dict(scenarios.BASELINE), 0.90)
        assert truth["feasible"] is False
        assert truth["best_reliability"] == pytest.approx(0.40)

    def test_respects_a_hard_ceiling(self):
        feats = dict(scenarios.BASELINE)
        assert simulation.true_reachability(scenarios.ceilinged, feats, 0.71)["feasible"]
        assert not simulation.true_reachability(scenarios.ceilinged, feats, 0.73)["feasible"]

    def test_minimal_levers_is_zero_when_nothing_need_change(self):
        model, feats = scenarios.SCENARIOS["monotone"]
        baseline = model(feats)
        truth = simulation.true_reachability(model, feats, baseline - 0.01)
        assert truth["minimal_levers"] == 0


class TestLeverCounting:
    def test_a_bedtime_only_plan_counts_as_one_lever(self):
        """The accounting bug that made plans look better than minimal."""
        model, feats = scenarios.SCENARIOS["monotone"]
        result = simulation.grade(model, feats, 0.60)
        if result["planner_promises"] and result["bedtime_planned"] is not None:
            assert result["planner_levers"] >= 1

    def test_never_reports_fewer_levers_than_the_exhaustive_minimum(self):
        """Beating the minimum is arithmetically impossible; it means a bug."""
        df = simulation.study(FAST_SCENARIOS, targets=(0.6,))
        solved = df[df.truth_minimal_levers.notna() & df.planner_promises]
        assert (solved["planner_levers"] >= solved["truth_minimal_levers"]).all()


class TestPlannerSoundness:
    """The properties the paper will claim."""

    def test_the_bedtime_sweep_is_optimal_including_non_monotone_responses(self):
        df = simulation.study(scenarios.SCENARIOS, check_minimality=False)
        assert df["bedtime_optimal"].all(), "the sweep missed a latest-feasible bedtime"

    def test_it_never_promises_what_cannot_be_delivered(self):
        """Soundness. The safety-critical direction, and it must be exact."""
        df = simulation.study(FAST_SCENARIOS, targets=FAST_TARGETS)
        assert df["broken_promise"].sum() == 0

    @pytest.mark.slow
    def test_soundness_holds_across_the_full_grid(self):
        df = simulation.study(scenarios.SCENARIOS)
        assert df["broken_promise"].sum() == 0
        assert df["bedtime_optimal"].all()

    @pytest.mark.slow
    def test_it_is_conservative_rather_than_optimistic(self):
        """Incompleteness is the acceptable failure; over-promising is not.

        Needs the full grid: at `max_rounds=8` only 3 of 42 cells still refuse
        something achievable, and none of them at a single mid-range target. An
        earlier version asserted this over one target and started failing once
        the budget was raised - which was the fix working, not a regression.
        """
        df = simulation.study(scenarios.SCENARIOS)
        assert df["broken_promise"].sum() == 0      # soundness, non-negotiable
        assert df["false_refusal"].sum() > 0        # documents the residual gap
        assert df["false_refusal"].sum() < 6        # but it must stay small

    @pytest.mark.parametrize("target,expect_promise", [
        (0.715, True),    # comfortably below the ceiling
        (0.719, True),
        (0.720, True),    # exactly the ceiling - achievable, so promise it
        (0.721, False),   # one thousandth above - must refuse
        (0.725, False),
    ])
    def test_the_ceiling_boundary_is_exact(self, target, expect_promise):
        """A target equal to the achievable ceiling is achievable.

        The boundary is where an off-by-one in the `>=` comparison would hide,
        and it would be invisible on a coarse target grid: refusing exactly at
        the ceiling loses reachable plans, while promising just above it breaks
        soundness.
        """
        result = simulation.grade(scenarios.ceilinged, dict(scenarios.BASELINE),
                                  target)
        assert result["planner_promises"] is expect_promise
        assert result["verdict_correct"]
        assert not result["broken_promise"]

    def test_a_flat_model_is_always_refused(self):
        df = simulation.study({"flat": scenarios.SCENARIOS["flat"]},
                              targets=(0.5, 0.7, 0.9))
        assert not df["planner_promises"].any()

    def test_the_planner_is_restored_after_grading(self):
        before = wake_plan.predict_wake_success
        simulation.grade(scenarios.flat, dict(scenarios.BASELINE), 0.9,
                         check_minimality=False)
        assert wake_plan.predict_wake_success is before


class TestIterationBudget:
    """`max_rounds` was raised from 3 to 8 on the evidence below."""

    def test_the_production_budget_is_the_one_the_study_justified(self):
        assert wake_plan._optimize_plan.__defaults__ == (8,)

    @pytest.mark.slow
    def test_a_larger_budget_refuses_less_without_over_promising(self):
        original = wake_plan._optimize_plan

        def with_rounds(n):
            def patched(features, target, max_rounds=n, _f=original):
                return _f(features, target, max_rounds=max_rounds)
            return patched

        results = {}
        try:
            for rounds in (3, 8):
                wake_plan._optimize_plan = with_rounds(rounds)
                # Ground truth must cover what the planner can reach at this budget.
                df = simulation.study(scenarios.SCENARIOS, max_steps=3 * rounds)
                results[rounds] = (int(df.false_refusal.sum()),
                                   int(df.broken_promise.sum()))
        finally:
            wake_plan._optimize_plan = original

        assert results[8][0] < results[3][0], "more rounds should refuse less"
        # Soundness is the property that must survive the change.
        assert results[3][1] == 0 and results[8][1] == 0
