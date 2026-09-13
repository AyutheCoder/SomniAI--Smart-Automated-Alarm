"""Tests for the shared dataset derivations.

Each of these is a judgement call rather than a measurement, so the tests pin
the choice and the sensitivity parameter, and the docstrings say which
assumption is being fixed. The leakage test is the important one.
"""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from datasets import derive


def at(hh: int, mm: int = 0) -> dt.datetime:
    return dt.datetime(2021, 6, 1, hh, mm)


class TestNightAnchoredHour:
    @pytest.mark.parametrize("when,expected", [
        (at(23, 30), 23.5),
        (at(22, 0), 22.0),
        (at(0, 9), 24.15),
        (at(2, 0), 26.0),
        (at(20, 0), 20.0),
        (at(1, 30), 25.5),
    ])
    def test_maps_clock_time_onto_the_night_axis(self, when, expected):
        assert derive.night_anchored_hour(when) == pytest.approx(expected, abs=1e-6)

    def test_keeps_later_bedtimes_strictly_larger_across_midnight(self):
        # The whole point of the encoding: no wrap, so a sweep is monotone.
        seq = [at(21, 0), at(23, 0), at(23, 59), at(0, 30), at(1, 45)]
        hours = [derive.night_anchored_hour(t) for t in seq]
        assert hours == sorted(hours)

    def test_morning_wake_times_are_not_anchored(self):
        assert derive.wake_hour(at(7, 15)) == pytest.approx(7.25)


class TestChronotype:
    @pytest.mark.parametrize("bedtime,code", [
        (22.0, 0.0),    # lark
        (22.99, 0.0),
        (23.0, 1.0),    # intermediate
        (24.5, 1.0),
        (24.51, 2.0),   # owl
        (25.5, 2.0),
    ])
    def test_cut_points(self, bedtime, code):
        assert derive.chronotype_code(bedtime) == code

    def test_is_nan_without_a_habitual_bedtime(self):
        assert np.isnan(derive.chronotype_code(float("nan")))


class TestSleepConsistency:
    def test_perfect_regularity_scores_100(self):
        s = pd.Series([23.0] * 10)
        assert derive.sleep_consistency(s).dropna().iloc[-1] == pytest.approx(100.0)

    def test_wild_variation_floors_at_zero(self):
        s = pd.Series([20.0, 26.0] * 6)
        assert derive.sleep_consistency(s).dropna().iloc[-1] == pytest.approx(0.0)

    def test_more_variable_bedtimes_score_lower(self):
        steady = derive.sleep_consistency(pd.Series([23.0, 23.2, 23.1, 23.0, 23.3, 23.1])).iloc[-1]
        erratic = derive.sleep_consistency(pd.Series([21.0, 25.0, 22.0, 26.0, 20.5, 24.0])).iloc[-1]
        assert steady > erratic

    def test_needs_at_least_two_prior_nights(self):
        out = derive.sleep_consistency(pd.Series([23.0, 23.5, 24.0, 23.2]))
        assert np.isnan(out.iloc[0])   # nothing before it
        assert np.isnan(out.iloc[1])   # only one prior night
        assert np.isfinite(out.iloc[2])

    def test_window_size_changes_the_answer(self):
        # Recent nights steady, older nights erratic: a short window should see
        # only the steady stretch.
        s = pd.Series([20.0, 26.0, 21.0, 25.0, 23.0, 23.0, 23.0, 23.0])
        short = derive.sleep_consistency(s, window=3).iloc[-1]
        long = derive.sleep_consistency(s, window=7).iloc[-1]
        assert short > long


class TestSleepDebt:
    def test_under_sleeping_accumulates_positive_debt(self):
        out = derive.sleep_debt_hours(pd.Series([6.0] * 5), window=7, need_hours=8.0)
        assert out.iloc[-1] > 0

    def test_over_sleeping_goes_negative(self):
        out = derive.sleep_debt_hours(pd.Series([9.0] * 5), window=7, need_hours=8.0)
        assert out.iloc[-1] < 0

    def test_clipped_to_the_schema_range(self):
        starved = derive.sleep_debt_hours(pd.Series([1.0] * 10), window=7).dropna()
        rested = derive.sleep_debt_hours(pd.Series([12.0] * 10), window=7).dropna()
        assert starved.max() <= 4.0
        assert rested.min() >= -2.0

    def test_assumed_need_is_a_tunable_parameter(self):
        s = pd.Series([7.0] * 6)
        assert derive.sleep_debt_hours(s, need_hours=9.0).iloc[-1] > \
               derive.sleep_debt_hours(s, need_hours=7.0).iloc[-1]


class TestNoLeakage:
    """The habit features describe what a person brings *to* tonight.

    If tonight's own bedtime or duration entered its own trailing window, the
    target would leak into the predictors and every reported metric would be
    optimistic. This is the single most damaging silent bug available here.
    """

    def test_consistency_ignores_the_current_night(self):
        base = pd.Series([23.0, 23.0, 23.0, 23.0, 23.0])
        shocked = base.copy()
        shocked.iloc[-1] = 4.0          # absurd value in the final row only
        assert derive.sleep_consistency(base).iloc[-1] == \
               pytest.approx(derive.sleep_consistency(shocked).iloc[-1])

    def test_debt_ignores_the_current_night(self):
        base = pd.Series([8.0, 8.0, 8.0, 8.0, 8.0])
        shocked = base.copy()
        shocked.iloc[-1] = 0.0
        assert derive.sleep_debt_hours(base).iloc[-1] == \
               pytest.approx(derive.sleep_debt_hours(shocked).iloc[-1])


class TestAddHabitFeatures:
    def frame(self):
        return pd.DataFrame({
            "participant_id": ["a"] * 5 + ["b"] * 5,
            "date": [dt.date(2021, 6, d) for d in range(1, 6)] * 2,
            "bedtime_hour": [23.0, 23.1, 22.9, 23.2, 23.0] + [25.0, 25.2, 24.8, 25.1, 25.0],
            "sleep_duration_hours": [7.0] * 5 + [6.0] * 5,
        })

    def test_assigns_chronotype_per_participant(self):
        out = derive.add_habit_features(self.frame())
        assert out.loc[out.participant_id == "a", "chronotype_code"].unique().tolist() == [1.0]
        assert out.loc[out.participant_id == "b", "chronotype_code"].unique().tolist() == [2.0]

    def test_does_not_bleed_history_between_participants(self):
        out = derive.add_habit_features(self.frame())
        first_b = out[out.participant_id == "b"].iloc[0]
        assert np.isnan(first_b["sleep_consistency"])
        assert np.isnan(first_b["sleep_debt_hours"])

    def test_sorts_by_date_within_participant(self):
        shuffled = self.frame().sample(frac=1, random_state=0)
        out = derive.add_habit_features(shuffled)
        for _, grp in out.groupby("participant_id"):
            assert grp["date"].tolist() == sorted(grp["date"].tolist())
