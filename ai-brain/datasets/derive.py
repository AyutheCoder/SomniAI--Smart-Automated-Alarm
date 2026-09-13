"""Derivations shared by every dataset loader.

These are the judgement calls flagged as "derivable, with assumptions" in
`docs/feature-mapping-lifesnaps-pmdata.md`. Each one is a defensible choice
rather than a measurement, so each is a named function with the assumption in
its docstring and a parameter where the choice is arbitrary - the paper has to
report sensitivity to these, which is only possible if they are tunable.
"""

from __future__ import annotations

import datetime as _dt

import numpy as np
import pandas as pd

# Trailing window for habit features, in nights.
DEFAULT_WINDOW = 7
# Assumed nightly sleep need when computing debt. See `sleep_debt_hours`.
DEFAULT_SLEEP_NEED_H = 8.0
# Bedtime SD (hours) at which consistency is scored 0.
CONSISTENCY_SD_FLOOR_H = 3.0


def night_anchored_hour(when: _dt.datetime | pd.Timestamp) -> float:
    """Clock time as a float hour on the 20..26 night axis.

    `feature_spec` encodes bedtime on a scale where 24..26 means 00:00..02:00 of
    the following morning, so that "later" is always a larger number and a night
    spanning midnight does not wrap. 23:30 -> 23.5, 00:09 -> 24.15, 02:00 -> 26.0.

    Times from roughly midday onward are read as the same evening; times before
    are read as after midnight. The split is at 12:00, which misclassifies a
    genuine late-morning bedtime - rare enough in these cohorts to accept, and
    visible because such rows land at the extremes.
    """
    hour = when.hour + when.minute / 60.0 + when.second / 3600.0
    return hour + 24.0 if hour < 12.0 else hour


def wake_hour(when: _dt.datetime | pd.Timestamp) -> float:
    """Wake time as a plain float hour (0..24). Mornings do not need anchoring."""
    return when.hour + when.minute / 60.0 + when.second / 3600.0


def chronotype_code(median_bedtime: float) -> float:
    """Lark (0) / intermediate (1) / owl (2) from habitual bedtime.

    A *behavioural* stand-in for the Morningness-Eveningness Questionnaire,
    which neither dataset administers. Cut points sit at 23:00 and 00:30 on the
    night-anchored axis. This is not what MEQ measures - it captures when
    someone actually sleeps, not their self-reported preference - and the paper
    must say so.
    """
    if not np.isfinite(median_bedtime):
        return float("nan")
    if median_bedtime < 23.0:
        return 0.0
    if median_bedtime <= 24.5:
        return 1.0
    return 2.0


def _trailing(series: pd.Series, window: int, fn, min_nights: int = 2) -> pd.Series:
    """Apply `fn` to the `window` nights strictly *before* each row.

    The shift matters. These features describe the habit a person brings to
    tonight, and tonight's own value is not knowable when the plan is made -
    including it would leak the target into the predictors.

    NaNs are dropped inside each window rather than left for `fn`. Pandas passes
    the raw window through untouched, so `np.std` over a window containing a
    single gap would return NaN and quietly erase the feature for that row -
    and wearable data is full of gaps.
    """
    def apply(values):
        present = values[np.isfinite(values)]
        return fn(present) if len(present) >= min_nights else np.nan

    return series.shift(1).rolling(window=window, min_periods=1).apply(apply, raw=True)


def sleep_consistency(
    bedtimes: pd.Series, window: int = DEFAULT_WINDOW
) -> pd.Series:
    """0..100 regularity of bedtime over the preceding `window` nights.

    Standard deviation of night-anchored bedtime, mapped linearly onto 0..100:
    perfectly regular scores 100, and an SD of `CONSISTENCY_SD_FLOOR_H` or more
    scores 0. The linear map and the floor are both arbitrary; report
    sensitivity to them.
    """
    sd = _trailing(bedtimes, window, lambda a: float(np.std(a, ddof=1)))
    scaled = 100.0 * (1.0 - sd / CONSISTENCY_SD_FLOOR_H)
    return scaled.clip(lower=0.0, upper=100.0)


def sleep_debt_hours(
    durations: pd.Series,
    window: int = DEFAULT_WINDOW,
    need_hours: float = DEFAULT_SLEEP_NEED_H,
) -> pd.Series:
    """Accumulated shortfall against `need_hours` over the preceding nights.

    Positive means under-slept. `need_hours` is the unavoidable assumption: a
    per-person mean would be circular (debt measured against your own habit is
    always near zero), so a fixed population figure is used and exposed as a
    parameter. `feature_spec` bounds this at -2..4 h, so it is clipped to match.
    """
    total = _trailing(durations, window, lambda a: float(np.sum(need_hours - a)))
    return total.clip(lower=-2.0, upper=4.0)


def add_habit_features(
    df: pd.DataFrame,
    window: int = DEFAULT_WINDOW,
    need_hours: float = DEFAULT_SLEEP_NEED_H,
) -> pd.DataFrame:
    """Attach chronotype, sleep consistency and sleep debt per participant.

    Requires `participant_id`, `date`, `bedtime_hour`, `sleep_duration_hours`.
    Rows are sorted by date within participant first, because the trailing
    windows are meaningless on unordered input.
    """
    out = df.sort_values(["participant_id", "date"]).reset_index(drop=True)
    grouped = out.groupby("participant_id", sort=False)

    out["sleep_consistency"] = grouped["bedtime_hour"].transform(
        lambda s: sleep_consistency(s, window=window)
    )
    out["sleep_debt_hours"] = grouped["sleep_duration_hours"].transform(
        lambda s: sleep_debt_hours(s, window=window, need_hours=need_hours)
    )
    medians = grouped["bedtime_hour"].median()
    out["chronotype_code"] = out["participant_id"].map(
        {pid: chronotype_code(m) for pid, m in medians.items()}
    )
    return out
