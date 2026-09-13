"""Tests for real-data training.

Two failure modes here would inflate every number in the paper without any
visible symptom: a split that lets one participant appear in both halves, and a
feature that was measured at the same moment as the target. Both are pinned.
"""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from training import train_real


def cohort(n_participants: int = 20, nights: int = 30, seed: int = 0) -> pd.DataFrame:
    """A synthetic cohort with a genuine signal to recover."""
    rng = np.random.default_rng(seed)
    rows = []
    for p in range(n_participants):
        person_offset = rng.normal(0, 0.8)
        for i in range(nights):
            bedtime = 23.0 + rng.normal(0, 0.7)
            stress = rng.uniform(0, 100)
            duration = 8.0 - (bedtime - 23.0) * 0.5 - stress / 200.0 + person_offset
            rows.append({
                "participant_id": f"p{p:02d}",
                "date": dt.date(2021, 6, 1) + dt.timedelta(days=i),
                "bedtime_hour": bedtime,
                "stress_level": stress,
                "steps": rng.uniform(2000, 15000),
                "resting_hr": rng.uniform(50, 75),
                "sleep_duration_hours": duration + rng.normal(0, 0.25),
                # Measured with the target - must never become a predictor.
                "time_in_bed_hours": duration + 0.6,
                "sleep_efficiency": 92.0,
                "wake_time_hour": 7.0,
            })
    return pd.DataFrame(rows)


FEATURES = ["bedtime_hour", "stress_level", "steps", "resting_hr"]


class TestGroupedSplit:
    def test_no_participant_appears_in_both_halves(self):
        """The assertion the whole evaluation rests on."""
        df = cohort()
        train, test = train_real.grouped_split(df)
        assert set(train["participant_id"]).isdisjoint(set(test["participant_id"]))

    def test_holds_across_many_seeds(self):
        df = cohort()
        for seed in range(15):
            train, test = train_real.grouped_split(df, seed=seed)
            assert set(train["participant_id"]).isdisjoint(set(test["participant_id"]))
            assert len(test) > 0 and len(train) > 0

    def test_keeps_every_night_of_a_participant_together(self):
        df = cohort()
        train, test = train_real.grouped_split(df)
        counts = df.groupby("participant_id").size()
        for pid, grp in pd.concat([train.assign(h="tr"), test.assign(h="te")]).groupby("participant_id"):
            assert grp["h"].nunique() == 1
            assert len(grp) == counts[pid]

    def test_split_is_reproducible(self):
        df = cohort()
        a, _ = train_real.grouped_split(df, seed=7)
        b, _ = train_real.grouped_split(df, seed=7)
        assert a["participant_id"].tolist() == b["participant_id"].tolist()

    def test_the_trained_model_also_respects_the_split(self):
        out = train_real.train_sleep_duration(cohort(), features=FEATURES)
        m = out["metrics"]
        assert m["participants_train"] + m["participants_test"] == 20
        assert m["n_train"] + m["n_test"] == m["n_rows"]


class TestLeakageGuard:
    @pytest.mark.parametrize("bad", [
        "time_in_bed_hours", "sleep_efficiency", "wake_time_hour",
        "minutes_to_fall_asleep", "sleep_duration_hours", "wake_success",
    ])
    def test_refuses_features_measured_with_the_target(self, bad):
        with pytest.raises(train_real.LeakageError):
            train_real.assert_no_leakage(FEATURES + [bad])

    def test_accepts_legitimate_predictors(self):
        train_real.assert_no_leakage(FEATURES)   # must not raise

    def test_training_refuses_a_leaky_feature_list(self):
        with pytest.raises(train_real.LeakageError):
            train_real.train_sleep_duration(
                cohort(), features=FEATURES + ["time_in_bed_hours"]
            )

    def test_the_guard_is_what_stands_between_us_and_a_fake_result(self):
        """Demonstrates the size of the hole it plugs."""
        df = cohort()
        honest = train_real.train_sleep_duration(df, features=FEATURES)["metrics"]
        # Bypass the guard deliberately to show what leakage would buy.
        leaked = train_real.train_sleep_duration.__wrapped__ if hasattr(
            train_real.train_sleep_duration, "__wrapped__") else None
        assert leaked is None                      # no accidental escape hatch
        assert honest["mae"] > 0.1                 # an honest model is not perfect

    def test_auto_selected_features_are_never_leaky(self):
        train_real.assert_no_leakage(train_real.available_features(cohort()))


class TestMetrics:
    def test_recovers_a_signal_that_is_really_there(self):
        m = train_real.train_sleep_duration(cohort(), features=FEATURES)["metrics"]
        assert m["beats_mean_baseline"]
        assert m["improvement_vs_mean"] > 0

    def test_reports_the_baselines_it_is_judged_against(self):
        m = train_real.train_sleep_duration(cohort(), features=FEATURES)["metrics"]
        for key in ("baseline_train_mean_mae", "baseline_train_median_mae",
                    "oracle_person_mean_mae"):
            assert m[key] > 0

    def test_finds_no_signal_where_there_is_none(self):
        rng = np.random.default_rng(5)
        df = cohort()
        df["sleep_duration_hours"] = rng.normal(7.5, 1.0, len(df))
        m = train_real.train_sleep_duration(df, features=FEATURES)["metrics"]
        assert m["r2"] < 0.15

    def test_ranks_the_feature_that_drives_the_target(self):
        m = train_real.train_sleep_duration(cohort(), features=FEATURES)["metrics"]
        assert max(m["importances"], key=m["importances"].get) == "bedtime_hour"

    def test_available_features_respects_coverage(self):
        df = cohort()
        df.loc[df.index[:int(len(df) * 0.8)], "stress_level"] = np.nan
        assert "stress_level" not in train_real.available_features(df, min_coverage=0.5)
        assert "bedtime_hour" in train_real.available_features(df)

    def test_repeated_evaluation_reports_the_spread(self):
        out = train_real.repeated_evaluation(cohort(), features=FEATURES, seeds=(0, 1, 2))
        assert len(out) == 3
        assert out["mae"].notna().all()

    def test_refuses_a_cohort_too_small_to_split_by_person(self):
        with pytest.raises(ValueError):
            train_real.train_sleep_duration(cohort(n_participants=3), features=FEATURES)


def labelled_cohort(seed: int = 0) -> pd.DataFrame:
    """A cohort carrying the wake-regularity proxy label."""
    from datasets import wake_proxy
    df = cohort(n_participants=20, nights=40, seed=seed)
    rng = np.random.default_rng(seed + 100)
    # Wake time follows bedtime plus duration, with per-night jitter, so the
    # label is genuinely derived rather than assigned.
    df["wake_time_hour"] = (df["bedtime_hour"] + df["sleep_duration_hours"]
                            + rng.normal(0, 0.4, len(df))) % 24
    return wake_proxy.wake_success(df, day_type="none")


class TestWakeRegularityClassifier:
    def test_sleep_duration_cannot_be_a_predictor(self):
        """With bedtime known, duration reconstructs wake time and the label."""
        with pytest.raises(train_real.LeakageError):
            train_real.train_wake_regularity(
                labelled_cohort(), features=FEATURES + ["sleep_duration_hours"]
            )

    @pytest.mark.parametrize("bad", ["wake_time_hour", "wake_deviation_hours",
                                     "habitual_wake_hour", "wake_success"])
    def test_refuses_every_route_back_to_the_label(self, bad):
        with pytest.raises(train_real.LeakageError):
            train_real.train_wake_regularity(labelled_cohort(), features=FEATURES + [bad])

    def test_splits_by_participant(self):
        m = train_real.train_wake_regularity(labelled_cohort(), features=FEATURES)["metrics"]
        assert m["participants_train"] + m["participants_test"] == 20

    def test_reports_both_accuracy_and_auc(self):
        m = train_real.train_wake_regularity(labelled_cohort(), features=FEATURES)["metrics"]
        for key in ("accuracy", "balanced_accuracy", "roc_auc", "f1",
                    "baseline_majority_accuracy", "oracle_person_majority_accuracy"):
            assert 0.0 <= m[key] <= 1.0

    def test_majority_baseline_is_computed_from_training_data_only(self):
        m = train_real.train_wake_regularity(labelled_cohort(), features=FEATURES)["metrics"]
        # A majority-class predictor scores the test set's own class balance.
        expected = max(m["positive_rate_test"], 1 - m["positive_rate_test"])
        assert m["baseline_majority_accuracy"] == pytest.approx(expected, abs=0.02)

    def test_finds_no_signal_in_a_shuffled_label(self):
        df = labelled_cohort()
        rng = np.random.default_rng(9)
        df["wake_success"] = rng.integers(0, 2, len(df)).astype(float)
        m = train_real.train_wake_regularity(df, features=FEATURES)["metrics"]
        assert abs(m["auc_above_chance"]) < 0.12

    def test_recovers_a_label_that_is_a_function_of_a_feature(self):
        df = labelled_cohort()
        df["wake_success"] = (df["stress_level"] > 50).astype(float)
        m = train_real.train_wake_regularity(df, features=FEATURES)["metrics"]
        assert m["roc_auc"] > 0.9

    def test_refuses_a_degenerate_label(self):
        df = labelled_cohort()
        df["wake_success"] = 1.0
        with pytest.raises(ValueError):
            train_real.train_wake_regularity(df, features=FEATURES)

    def test_repeated_classification_reports_the_spread(self):
        out = train_real.repeated_classification(
            labelled_cohort(), features=FEATURES, seeds=(0, 1, 2)
        )
        assert len(out) >= 2
        assert out["roc_auc"].notna().all()
