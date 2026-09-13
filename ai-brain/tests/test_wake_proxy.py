"""Tests for the wake-success proxy.

This label is constructed, not measured, so these tests are less about
arithmetic and more about pinning the construct: late is a miss, early is not,
weekends are not failures by default, and no night contributes to its own
baseline.
"""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from datasets import wake_proxy


def nights(wake_hours, start=dt.date(2021, 6, 7), participant="p1"):
    """A frame of consecutive nights. 2021-06-07 is a Monday."""
    return pd.DataFrame({
        "participant_id": [participant] * len(wake_hours),
        "date": [start + dt.timedelta(days=i) for i in range(len(wake_hours))],
        "wake_time_hour": list(wake_hours),
    })


class TestCircularDeviation:
    @pytest.mark.parametrize("actual,baseline,expected", [
        (7.5, 7.0, 0.5),
        (7.0, 7.5, -0.5),
        (0.166667, 23.833333, 0.333333),   # 00:10 against 23:50 - twenty minutes
        (23.833333, 0.166667, -0.333333),
        (7.0, 7.0, 0.0),
    ])
    def test_measures_the_short_way_round_the_clock(self, actual, baseline, expected):
        got = wake_proxy.circular_deviation_hours(
            pd.Series([actual]), pd.Series([baseline])
        ).iloc[0]
        assert got == pytest.approx(expected, abs=1e-4)

    def test_never_exceeds_half_a_day(self):
        a = pd.Series(np.linspace(0, 23.99, 200))
        b = pd.Series([7.0] * 200)
        dev = wake_proxy.circular_deviation_hours(a, b)
        assert dev.between(-12, 12).all()


class TestBaseline:
    def test_uses_only_earlier_nights(self):
        """A night must not contribute to the baseline it is judged against."""
        base = nights([7.0] * 10)
        shocked = base.copy()
        shocked.loc[9, "wake_time_hour"] = 15.0        # only the final night moves

        b1 = wake_proxy.habitual_wake_time(base, day_type="none").iloc[9]
        b2 = wake_proxy.habitual_wake_time(shocked, day_type="none").iloc[9]
        assert b1 == pytest.approx(b2)

    def test_is_undefined_until_enough_history_exists(self):
        out = wake_proxy.habitual_wake_time(nights([7.0] * 6), day_type="none", min_nights=3)
        assert np.isnan(out.iloc[0]) and np.isnan(out.iloc[2])
        assert np.isfinite(out.iloc[3])

    def test_does_not_pool_across_participants(self):
        df = pd.concat([nights([7.0] * 6, participant="a"),
                        nights([11.0] * 6, participant="b")], ignore_index=True)
        out = wake_proxy.habitual_wake_time(df, day_type="none")
        df = df.assign(baseline=out)
        assert df[df.participant_id == "a"]["baseline"].dropna().between(6.9, 7.1).all()
        assert df[df.participant_id == "b"]["baseline"].dropna().between(10.9, 11.1).all()

    def test_weekend_bucketing_learns_a_separate_weekend_habit(self):
        # Weekdays 07:00, weekends 10:00, over four weeks.
        hours = []
        for i in range(28):
            dow = (dt.date(2021, 6, 7) + dt.timedelta(days=i)).weekday()
            hours.append(10.0 if dow >= 5 else 7.0)
        df = nights(hours)
        pooled = wake_proxy.habitual_wake_time(df, day_type="none")
        split = wake_proxy.habitual_wake_time(df, day_type="weekend")
        weekend_rows = [i for i in range(28)
                        if (dt.date(2021, 6, 7) + dt.timedelta(days=i)).weekday() >= 5]
        late = weekend_rows[-1]
        assert split.iloc[late] == pytest.approx(10.0, abs=0.2)
        assert pooled.iloc[late] < 9.0        # dragged down by the weekdays

    def test_thin_buckets_stay_unlabelled_by_default(self):
        # Per-weekday bucketing over two weeks leaves ~2 same-weekday nights,
        # below min_nights. Those nights get no baseline rather than a borrowed
        # one - see the fallback hazard test below.
        df = nights([7.0] * 14)
        assert wake_proxy.habitual_wake_time(df, day_type="dow", min_nights=3).isna().all()

    def test_the_pooled_fallback_reintroduces_weekday_contamination(self):
        """Why `fallback_to_pooled` defaults to off.

        Early weekend nights have too little same-bucket history. Borrowing the
        pooled baseline judges a 10:00 weekend wake against a weekday habit of
        07:00 and calls it three hours of oversleeping - exactly the error the
        bucketing exists to prevent.
        """
        hours = []
        for i in range(28):
            dow = (dt.date(2021, 6, 7) + dt.timedelta(days=i)).weekday()
            hours.append(10.0 if dow >= 5 else 7.0)
        df = nights(hours)
        is_weekend = pd.to_datetime(df["date"]).dt.dayofweek.ge(5).values

        borrowed = wake_proxy.wake_success(df, day_type="weekend", fallback_to_pooled=True)
        strict = wake_proxy.wake_success(df, day_type="weekend", fallback_to_pooled=False)

        assert borrowed.loc[is_weekend, "wake_success"].dropna().mean() < 0.7
        assert strict.loc[is_weekend, "wake_success"].dropna().mean() == 1.0
        # The cost of correctness: fewer labelled nights.
        assert strict["wake_success"].notna().sum() < borrowed["wake_success"].notna().sum()


class TestLabel:
    def test_waking_late_is_a_miss(self):
        df = nights([7.0] * 8 + [9.0])
        out = wake_proxy.wake_success(df, tolerance_min=30, day_type="none")
        assert out["wake_success"].iloc[-1] == 0.0

    def test_waking_early_is_not_a_miss(self):
        """Oversleeping is the construct; waking early is a different thing."""
        df = nights([7.0] * 8 + [5.0])
        out = wake_proxy.wake_success(df, tolerance_min=30, day_type="none", one_sided=True)
        assert out["wake_success"].iloc[-1] == 1.0

    def test_symmetric_mode_does_count_early_waking(self):
        df = nights([7.0] * 8 + [5.0])
        out = wake_proxy.wake_success(df, tolerance_min=30, day_type="none", one_sided=False)
        assert out["wake_success"].iloc[-1] == 0.0

    def test_inside_the_tolerance_is_a_success(self):
        df = nights([7.0] * 8 + [7.4])          # 24 minutes late
        out = wake_proxy.wake_success(df, tolerance_min=30, day_type="none")
        assert out["wake_success"].iloc[-1] == 1.0

    def test_the_tolerance_is_where_it_says_it_is(self):
        df = nights([7.0] * 8 + [7.6])          # 36 minutes late
        assert wake_proxy.wake_success(df, tolerance_min=30, day_type="none")["wake_success"].iloc[-1] == 0.0
        assert wake_proxy.wake_success(df, tolerance_min=45, day_type="none")["wake_success"].iloc[-1] == 1.0

    def test_nights_without_a_baseline_are_unlabelled_not_failures(self):
        out = wake_proxy.wake_success(nights([7.0] * 6), day_type="none", min_nights=3)
        assert np.isnan(out["wake_success"].iloc[0])
        assert out["wake_success"].notna().any()

    def test_weekend_lie_ins_are_not_failures_by_default(self):
        """The failure mode that would turn this into a weekday detector."""
        hours = []
        for i in range(28):
            dow = (dt.date(2021, 6, 7) + dt.timedelta(days=i)).weekday()
            hours.append(10.0 if dow >= 5 else 7.0)
        df = nights(hours)

        pooled = wake_proxy.wake_success(df, day_type="none")
        aware = wake_proxy.wake_success(df, day_type="weekend")
        is_weekend = pd.to_datetime(df["date"]).dt.dayofweek.ge(5).values

        pooled_weekend = pooled.loc[is_weekend, "wake_success"].dropna()
        aware_weekend = aware.loc[is_weekend, "wake_success"].dropna()
        assert pooled_weekend.mean() < 0.5      # pooled: lie-ins read as misses
        assert aware_weekend.mean() > 0.9       # day-aware: they do not

    def test_a_perfectly_regular_sleeper_almost_never_misses(self):
        out = wake_proxy.wake_success(nights([7.0] * 30), day_type="none")
        assert out["wake_success"].dropna().mean() == 1.0

    def test_output_keeps_the_audit_trail(self):
        out = wake_proxy.wake_success(nights([7.0] * 10), day_type="none")
        for col in ("habitual_wake_hour", "wake_deviation_hours", "wake_success"):
            assert col in out.columns


class TestSensitivity:
    def test_reports_every_combination(self):
        grid = wake_proxy.sensitivity(
            nights([7.0, 7.5, 6.5, 8.0, 7.2, 7.8, 6.9, 7.1] * 4),
            tolerances=(15.0, 30.0),
        )
        assert len(grid) == 2 * len(wake_proxy.DAY_TYPES) * 2
        assert grid["positive_rate"].between(0, 1).all()

    def test_a_wider_tolerance_never_lowers_the_positive_rate(self):
        df = nights(list(np.random.default_rng(0).normal(7.0, 0.6, 60)))
        grid = wake_proxy.sensitivity(df, day_types=("none",), one_sided=(True,))
        rates = grid.sort_values("tolerance_min")["positive_rate"].tolist()
        assert rates == sorted(rates)

    def test_agreement_compares_the_labels_not_just_their_rates(self):
        df = nights(list(np.random.default_rng(1).normal(7.0, 0.8, 60)))
        out = wake_proxy.agreement(df, [
            {"name": "tight", "tolerance_min": 15.0, "day_type": "none"},
            {"name": "loose", "tolerance_min": 60.0, "day_type": "none"},
        ])
        assert len(out) == 1
        assert 0.0 <= out.iloc[0]["agreement"] <= 1.0


class TestConstructValidity:
    def test_detects_a_real_association(self):
        df = nights([7.0] * 20 + [10.0] * 10)
        labelled = wake_proxy.wake_success(df, day_type="none")
        # Self-report that genuinely tracks the label.
        labelled["sleep_quality"] = np.where(labelled["wake_success"] == 1, 4.0, 2.0)
        result = wake_proxy.construct_validity(labelled, "sleep_quality")
        assert result["usable"]
        assert result["difference"] > 0
        assert result["direction_as_expected"]

    def test_detects_the_absence_of_one(self):
        df = nights(list(np.random.default_rng(2).normal(7.0, 1.0, 80)))
        labelled = wake_proxy.wake_success(df, day_type="none")
        rng = np.random.default_rng(3)
        labelled["noise"] = rng.normal(0, 1, len(labelled))
        result = wake_proxy.construct_validity(labelled, "noise")
        assert abs(result["standardised_difference"]) < 0.5

    def test_reports_unusable_rather_than_inventing_a_number(self):
        df = nights([7.0] * 20)
        labelled = wake_proxy.wake_success(df, day_type="none")
        labelled["sleep_quality"] = 3.0
        assert wake_proxy.construct_validity(labelled, "sleep_quality")["usable"] is False
