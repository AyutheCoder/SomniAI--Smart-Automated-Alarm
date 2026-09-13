"""Tests for calibration and refusal-quality evaluation.

This is the paper's central claim, so the tests are built to catch the two ways
it could be wrong without looking wrong: calibration maths that flatters the
model, and a baseline that is subtly crippled so the proposed method wins by
default.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from sklearn.ensemble import RandomForestClassifier

import wake_plan
from evaluation import planner_eval


class TestCalibrationMaths:
    def test_a_perfectly_calibrated_predictor_scores_zero_error(self):
        rng = np.random.default_rng(0)
        probs = rng.uniform(0, 1, 20000)
        outcomes = (rng.uniform(0, 1, 20000) < probs).astype(float)
        err = planner_eval.calibration_error(outcomes, probs)
        assert err["ece"] < 0.02
        assert err["mce"] < 0.06

    def test_an_overconfident_predictor_is_caught(self):
        rng = np.random.default_rng(1)
        truth = rng.uniform(0, 1, 8000)
        outcomes = (rng.uniform(0, 1, 8000) < truth).astype(float)
        overconfident = np.clip(truth * 1.4, 0, 1)     # claims more than it delivers
        err = planner_eval.calibration_error(outcomes, overconfident)
        assert err["ece"] > 0.08

    def test_gap_sign_shows_the_direction_of_the_error(self):
        # Always claims 0.9, delivers 0.5 - a positive gap means over-claiming.
        table = planner_eval.calibration_table(
            [1, 0] * 100, [0.9] * 200, n_bins=10
        )
        assert (table["gap"] > 0).all()

    def test_ece_weights_bins_by_how_many_nights_they_hold(self):
        """A wild gap in a near-empty bin must not dominate the headline."""
        probs = np.concatenate([np.full(999, 0.5), np.full(1, 0.95)])
        truth = np.concatenate([(np.arange(999) % 2).astype(float), [0.0]])
        err = planner_eval.calibration_error(truth, probs)
        assert err["mce"] > 0.5       # the lone bin is badly off
        assert err["ece"] < 0.05      # but it barely moves the weighted error

    def test_brier_catches_a_calibrated_but_useless_predictor(self):
        """Always predicting the base rate is perfectly calibrated and worthless."""
        rng = np.random.default_rng(2)
        outcomes = (rng.uniform(0, 1, 5000) < 0.7).astype(float)
        base = np.full(5000, 0.7)
        err = planner_eval.calibration_error(outcomes, base)
        assert err["ece"] < 0.02          # calibration says it is fine
        assert err["brier"] > 0.15        # Brier says it knows nothing

    def test_reports_nothing_rather_than_guessing_on_empty_input(self):
        err = planner_eval.calibration_error([], [])
        assert err["n"] == 0 and np.isnan(err["ece"])

    def test_every_night_lands_in_exactly_one_bin(self):
        rng = np.random.default_rng(3)
        probs = rng.uniform(0, 1, 500)
        table = planner_eval.calibration_table(rng.integers(0, 2, 500), probs)
        assert table["n"].sum() == 500

    def test_bins_handle_the_endpoints(self):
        table = planner_eval.calibration_table([1, 0], [0.0, 1.0])
        assert table["n"].sum() == 2


def toy_frame(n_participants=6, nights=25, seed=0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for p in range(n_participants):
        skill = 0.4 + 0.1 * p                       # differing achievable rates
        for i in range(nights):
            bedtime = 23.0 + rng.normal(0, 0.6)
            rows.append({
                "participant_id": f"p{p}",
                "bedtime_hour": bedtime,
                "stress_level": rng.uniform(0, 100),
                "resting_hr": rng.uniform(50, 75),
                "steps": rng.uniform(2000, 14000),
                "wake_time_hour": 7.0 + rng.normal(0, 0.3),
                "wake_success": float(rng.uniform(0, 1) < skill),
            })
    return pd.DataFrame(rows)


FEATURES = ["bedtime_hour", "stress_level", "resting_hr", "steps"]


@pytest.fixture
def fitted():
    df = toy_frame()
    model = RandomForestClassifier(n_estimators=40, random_state=0).fit(
        df[FEATURES], df["wake_success"].astype(int)
    )
    return df, model


class TestPlannerInjection:
    def test_runs_the_real_planner_against_a_supplied_model(self, fitted):
        df, model = fitted
        with planner_eval.planner_using(model, FEATURES):
            out = planner_eval.plan_inverse(df.iloc[0].to_dict(), 0.6, FEATURES)
        assert "promises" in out and 0.0 <= out["stated_reliability"] <= 1.0

    def test_restores_the_shipped_predictors_afterwards(self, fitted):
        df, model = fitted
        before = wake_plan.predict_wake_success
        with planner_eval.planner_using(model, FEATURES):
            assert wake_plan.predict_wake_success is not before
        assert wake_plan.predict_wake_success is before

    def test_restores_them_even_when_the_block_raises(self, fitted):
        df, model = fitted
        before = wake_plan.predict_wake_success
        with pytest.raises(RuntimeError):
            with planner_eval.planner_using(model, FEATURES):
                raise RuntimeError("boom")
        assert wake_plan.predict_wake_success is before


class TestBaselinesAreNotCrippled:
    """A baseline that quietly under-performs is how papers get caught."""

    def test_always_promise_never_refuses(self, fitted):
        df, _ = fitted
        for target in planner_eval.TARGET_GRID:
            assert planner_eval.plan_always_promise(df.iloc[0].to_dict(), target, FEATURES)["promises"]

    def test_cycle_calculator_counts_back_real_sleep_cycles(self):
        row = {"wake_time_hour": 7.0}
        out = planner_eval.plan_cycle_calculator(row, 0.8, FEATURES, cycles=5, onset_min=14)
        # 07:00 minus 7.5 h minus 14 min = 23:16 the previous evening.
        assert out["recommended_bedtime"] == pytest.approx(23.27, abs=0.02)

    def test_cycle_calculator_respects_its_own_parameters(self):
        row = {"wake_time_hour": 7.0}
        five = planner_eval.plan_cycle_calculator(row, 0.8, FEATURES, cycles=5)
        six = planner_eval.plan_cycle_calculator(row, 0.8, FEATURES, cycles=6)
        assert six["recommended_bedtime"] < five["recommended_bedtime"]

    def test_cycle_calculator_tracks_the_wake_time_it_is_given(self):
        early = planner_eval.plan_cycle_calculator({"wake_time_hour": 5.0}, 0.8, FEATURES)
        late = planner_eval.plan_cycle_calculator({"wake_time_hour": 9.0}, 0.8, FEATURES)
        assert early["recommended_bedtime"] < late["recommended_bedtime"]

    def test_forward_only_uses_the_same_model_as_the_inverse_planner(self, fitted):
        """It must be handicapped only by not searching, not by a worse model."""
        df, model = fitted
        row = df.iloc[0].to_dict()
        with planner_eval.planner_using(model, FEATURES):
            fwd = planner_eval.plan_forward_only(row, 0.9, FEATURES)
            direct = wake_plan.predict_wake_success(
                {k: row[k] for k in FEATURES}
            )["wakeSuccessProbability"]
        assert fwd["stated_reliability"] == pytest.approx(direct)

    def test_forward_only_promises_exactly_when_tonight_already_clears(self, fitted):
        df, model = fitted
        row = df.iloc[0].to_dict()
        with planner_eval.planner_using(model, FEATURES):
            p = planner_eval.plan_forward_only(row, 0.0, FEATURES)["stated_reliability"]
            assert planner_eval.plan_forward_only(row, p - 0.01, FEATURES)["promises"]
            assert not planner_eval.plan_forward_only(row, p + 0.01, FEATURES)["promises"]

    def test_the_inverse_planner_can_promise_where_forward_only_cannot(self, fitted):
        """The point of inversion: searching finds a bedtime tonight does not have."""
        df, model = fitted
        with planner_eval.planner_using(model, FEATURES):
            rows = [df.iloc[i].to_dict() for i in range(40)]
            gained = sum(
                planner_eval.plan_inverse(r, 0.5, FEATURES)["promises"]
                and not planner_eval.plan_forward_only(r, 0.5, FEATURES)["promises"]
                for r in rows
            )
        assert gained > 0


class TestRefusalEvaluation:
    def test_achievable_rate_is_per_participant(self):
        df = toy_frame()
        rates = planner_eval.achievable_rate(df)
        assert len(rates) == 6
        assert rates.between(0, 1).all()

    def test_always_promise_over_promises_at_high_targets(self, fitted):
        df, model = fitted
        with planner_eval.planner_using(model, FEATURES):
            out = planner_eval.refusal_evaluation(
                df, FEATURES, planners={"always_promise": planner_eval.plan_always_promise},
                targets=(0.95,), max_nights_per_participant=5,
            )
        assert out.iloc[0]["over_promise_rate"] > 0.5
        assert out.iloc[0]["correct_refusals"] == 0

    def test_the_confusion_counts_add_up(self, fitted):
        df, model = fitted
        with planner_eval.planner_using(model, FEATURES):
            out = planner_eval.refusal_evaluation(
                df, FEATURES, targets=(0.7,), max_nights_per_participant=4
            )
        for _, r in out.iterrows():
            assert (r["promised"] + r["correct_refusals"] + r["missed_opportunities"]
                    == r["n"])

    def test_covers_every_planner_and_target(self, fitted):
        df, model = fitted
        with planner_eval.planner_using(model, FEATURES):
            out = planner_eval.refusal_evaluation(
                df, FEATURES, targets=(0.6, 0.9), max_nights_per_participant=3
            )
        assert len(out) == len(planner_eval.PLANNERS) * 2
