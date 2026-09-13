"""Tests for the ablation study and the matched-subset analysis.

The ablation's ground truth is the thing most able to go quietly wrong: if it
were computed from an ablated CONTROLLABLE rather than the honest one, the
partition ablation would be graded against its own inflated beliefs and the
failure it exists to expose would vanish.
"""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

import wake_plan
from evaluation import ablation, matched, scenarios


class TestAblationRestoresThePlanner:
    @pytest.mark.parametrize("component", ablation.ABLATIONS)
    def test_every_ablation_is_reverted(self, component):
        before = (wake_plan._latest_feasible_bedtime, wake_plan._optimize_plan,
                  wake_plan._habit_constraints, list(wake_plan.CONTROLLABLE))
        with ablation.ablate(component):
            pass
        assert wake_plan._latest_feasible_bedtime is before[0]
        assert wake_plan._optimize_plan is before[1]
        assert wake_plan._habit_constraints is before[2]
        assert list(wake_plan.CONTROLLABLE) == before[3]

    def test_reverts_even_when_the_block_raises(self):
        before = list(wake_plan.CONTROLLABLE)
        with pytest.raises(RuntimeError):
            with ablation.ablate("partition"):
                raise RuntimeError("boom")
        assert list(wake_plan.CONTROLLABLE) == before

    def test_rejects_an_unknown_component(self):
        with pytest.raises(ValueError):
            with ablation.ablate("nonsense"):
                pass

    def test_partition_ablation_actually_widens_the_lever_set(self):
        before = len(wake_plan.CONTROLLABLE)
        with ablation.ablate("partition"):
            assert len(wake_plan.CONTROLLABLE) > before
            names = {n for n, *_ in wake_plan.CONTROLLABLE}
            assert "alarm_response_ms" in names     # a habit feature, wrongly a lever
        assert len(wake_plan.CONTROLLABLE) == before


class TestAblationGradesHonestly:
    def test_ground_truth_ignores_the_ablated_lever_set(self):
        """The load-bearing property of the whole ablation study.

        Truth must be the world as it is - habit features cannot change tonight.
        Grading the partition ablation against its own widened set would hide
        exactly the broken promises it is meant to reveal.
        """
        from evaluation import simulation

        model, feats = scenarios.SCENARIOS["habit_bound"]
        honest = list(wake_plan.CONTROLLABLE)
        # 0.70 sits above what tonight's levers can reach (0.30) but within
        # what fixing the habits would reach (0.75), so the two sets disagree.
        target = 0.70
        with ablation.ablate("partition"):
            widened = simulation.true_reachability(model, feats, target, max_steps=3)
            honest_truth = simulation.true_reachability(
                model, feats, target, max_steps=3, levers=honest)
        # Under the honest set the habit-bound scenario stays unreachable.
        assert honest_truth["feasible"] is False
        # Under the widened set it looks reachable - which is the illusion the
        # partition exists to prevent, and what grading honestly exposes.
        assert widened["feasible"] is True

    @pytest.mark.slow
    def test_each_component_earns_its_place(self):
        df = ablation.study().set_index("ablation")
        full = df.loc["none"]
        assert df.loc["ascent", "false_refusals"] > full["false_refusals"]
        assert df.loc["sweep", "bedtime_optimal"] < full["bedtime_optimal"]
        assert df.loc["partition", "broken_promises"] > full["broken_promises"]
        # Attribution is explanatory: it must not change any verdict.
        assert df.loc["attribution", "verdict_correct"] == full["verdict_correct"]

    def test_attribution_changes_explanation_not_verdict(self):
        out = ablation.attribution_quality().set_index("ablation")
        assert out.loc["none", "refused"] == out.loc["attribution", "refused"]
        assert out.loc["none", "habit_causes_named"] > 0
        assert out.loc["attribution", "habit_causes_named"] == 0


def recs_frame(rows):
    return pd.DataFrame(rows)


class TestMatchedSubset:
    def test_matching_respects_the_tolerance(self):
        recs = recs_frame([
            {"participant_id": "a", "date": dt.date(2021, 6, 1),
             "actual_bedtime": 23.0, "recommended_bedtime": 23.2,
             "planner_promised": True, "wake_success": 1.0},
            {"participant_id": "a", "date": dt.date(2021, 6, 2),
             "actual_bedtime": 23.0, "recommended_bedtime": 25.0,
             "planner_promised": True, "wake_success": 0.0},
        ])
        tight = matched.label_matched(recs, 0.25)
        assert tight["matched"].tolist() == [1.0, 0.0]

    def test_nights_without_advice_are_unlabelled_not_unmatched(self):
        """A refusal is not advice the participant failed to follow."""
        recs = recs_frame([{
            "participant_id": "a", "date": dt.date(2021, 6, 1),
            "actual_bedtime": 23.0, "recommended_bedtime": np.nan,
            "planner_promised": False, "wake_success": 1.0}])
        assert np.isnan(matched.label_matched(recs, 0.5)["matched"].iloc[0])

    def test_a_participant_with_only_matched_nights_contributes_nothing(self):
        recs = recs_frame([
            {"participant_id": "a", "date": dt.date(2021, 6, i),
             "actual_bedtime": 23.0, "recommended_bedtime": 23.0,
             "planner_promised": True, "wake_success": 1.0} for i in range(1, 5)])
        out = matched.within_participant_effect(matched.label_matched(recs, 0.5))
        assert out["participants_usable"] == 0
        assert out["conclusive"] is False

    def test_reports_inconclusive_rather_than_inventing_an_effect(self):
        rng = np.random.default_rng(0)
        rows = []
        for p in range(6):
            for i in range(20):
                rows.append({
                    "participant_id": f"p{p}", "date": dt.date(2021, 6, 1),
                    "actual_bedtime": 23.0 + rng.normal(0, 1),
                    "recommended_bedtime": 23.0, "planner_promised": True,
                    "wake_success": float(rng.integers(0, 2))})
        out = matched.within_participant_effect(
            matched.label_matched(recs_frame(rows), 0.5))
        assert out["crosses_zero"] is True
        assert out["conclusive"] is False

    def test_detects_a_large_real_effect(self):
        rows = []
        for p in range(6):
            for i in range(10):
                rows.append({"participant_id": f"p{p}", "date": dt.date(2021, 6, 1),
                             "actual_bedtime": 23.0, "recommended_bedtime": 23.0,
                             "planner_promised": True, "wake_success": 1.0})
                rows.append({"participant_id": f"p{p}", "date": dt.date(2021, 6, 2),
                             "actual_bedtime": 26.0, "recommended_bedtime": 23.0,
                             "planner_promised": True, "wake_success": 0.0})
        out = matched.within_participant_effect(
            matched.label_matched(recs_frame(rows), 0.5))
        assert out["mean_difference"] == pytest.approx(1.0)
        assert out["conclusive"] is True

    def test_power_calculation_scales_inversely_with_effect_size(self):
        assert matched.participants_needed(0.2) > matched.participants_needed(0.5)
        # ((1.96 + 0.84) / 0.4) ** 2 == 49 exactly.
        assert matched.participants_needed(0.4) == 49
        assert matched.participants_needed(0.0) == -1
