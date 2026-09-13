"""A wake-success proxy label, and the machinery to argue about it.

Neither LifeSnaps nor PMData contains an alarm. Nothing records an intended
wake time, a snooze, or whether anyone had somewhere to be. So the target the
wake-success model is trained on cannot be measured here - it has to be
constructed, and constructing a target is the most attackable thing in the
paper. This module therefore does three things:

  1. builds the label from explicit, named choices rather than a single opinion,
  2. makes every choice a parameter, so sensitivity can be reported instead of
     asserted,
  3. provides construct validation against independent self-report, which is
     the only real evidence that the label tracks anything.

**What the label actually means.** "Woke no more than `tolerance_min` after this
participant's habitual wake time for this kind of day." It is a proxy for *not
oversleeping*, and it is not a measure of whether anyone met an obligation. Say
so in the paper before a reviewer says it for you.

Three design decisions worth defending explicitly:

*One-sided by default.* Oversleeping is waking late. A symmetric window would
score someone who woke forty minutes early as a failure, which is a different
construct - and arguably the opposite one.

*Day-type aware by default.* People wake later at weekends by choice. Against a
pooled baseline, a symmetric or one-sided rule flags most weekend mornings as
failures, and the label degenerates into a weekday detector.

*Baseline from prior nights only.* A baseline including tonight lets the night
shape its own target. The effect is small with 50+ nights, but it is free to
avoid and impossible to detect downstream.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

DEFAULT_TOLERANCE_MIN = 30.0
DEFAULT_WINDOW = 28          # nights of history for the habitual baseline
DEFAULT_MIN_NIGHTS = 3       # below this a bucket falls back to pooled history

# How habitual wake time is bucketed before averaging.
DAY_TYPES = ("none", "weekend", "dow")


def circular_deviation_hours(actual: pd.Series, baseline: pd.Series) -> pd.Series:
    """Signed hours from `baseline` to `actual` on a 24-hour circle.

    Positive means later. Wrapping matters: a 23:50 baseline against a 00:10
    wake is a 20-minute difference, not 23 hours and 40 minutes. Most wakes sit
    mid-morning where this never bites, but both datasets contain wake times
    across the full clock.
    """
    raw = actual - baseline
    return ((raw + 12.0) % 24.0) - 12.0


def _day_bucket(dates: pd.Series, day_type: str) -> pd.Series:
    if day_type == "none":
        return pd.Series(["all"] * len(dates), index=dates.index)
    dow = pd.to_datetime(dates).dt.dayofweek
    if day_type == "weekend":
        return dow.ge(5).map({True: "weekend", False: "weekday"})
    if day_type == "dow":
        return dow.astype(str)
    raise ValueError(f"day_type must be one of {DAY_TYPES}, got {day_type!r}")


def _trailing_median(values: pd.Series, window: int, min_nights: int) -> pd.Series:
    """Median of up to `window` strictly-earlier values."""
    def apply(a):
        present = a[np.isfinite(a)]
        return float(np.median(present)) if len(present) >= min_nights else np.nan

    return values.shift(1).rolling(window=window, min_periods=1).apply(apply, raw=True)


def habitual_wake_time(
    df: pd.DataFrame,
    day_type: str = "weekend",
    window: int = DEFAULT_WINDOW,
    min_nights: int = DEFAULT_MIN_NIGHTS,
    fallback_to_pooled: bool = False,
) -> pd.Series:
    """Each night's expected wake time, from that participant's own history.

    Computed within (participant, day bucket) over the preceding `window`
    nights. Buckets with fewer than `min_nights` prior observations yield NaN,
    and those nights go unlabelled.

    `fallback_to_pooled` fills those gaps from the participant's pooled history
    instead, and **defaults to off because it is actively harmful under day-type
    bucketing**: the pooled baseline is dominated by weekdays, so early weekend
    nights get judged against a weekday wake time and scored as oversleeping -
    reintroducing precisely the contamination the bucketing exists to remove.
    It costs the first few nights of each bucket, which is the cheaper error: an
    unlabelled night is not evidence, a mislabelled one is.
    """
    work = df.sort_values(["participant_id", "date"]).copy()
    work["_bucket"] = _day_bucket(work["date"], day_type)

    bucketed = work.groupby(["participant_id", "_bucket"], sort=False)["wake_time_hour"].transform(
        lambda s: _trailing_median(s, window, min_nights)
    )
    if fallback_to_pooled:
        pooled = work.groupby("participant_id", sort=False)["wake_time_hour"].transform(
            lambda s: _trailing_median(s, window, min_nights)
        )
        bucketed = bucketed.fillna(pooled)
    return bucketed.reindex(df.index)


def wake_success(
    df: pd.DataFrame,
    tolerance_min: float = DEFAULT_TOLERANCE_MIN,
    day_type: str = "weekend",
    one_sided: bool = True,
    window: int = DEFAULT_WINDOW,
    min_nights: int = DEFAULT_MIN_NIGHTS,
    fallback_to_pooled: bool = False,
) -> pd.DataFrame:
    """Attach the proxy label and everything needed to audit it.

    Adds `habitual_wake_hour`, `wake_deviation_hours` (signed, positive = late)
    and `wake_success` (1 / 0 / NaN). Nights without enough history to establish
    a baseline are NaN rather than guessed - they are not evidence either way.
    """
    out = df.sort_values(["participant_id", "date"]).reset_index(drop=True).copy()
    out["habitual_wake_hour"] = habitual_wake_time(
        out, day_type=day_type, window=window, min_nights=min_nights,
        fallback_to_pooled=fallback_to_pooled,
    )
    out["wake_deviation_hours"] = circular_deviation_hours(
        out["wake_time_hour"], out["habitual_wake_hour"]
    )

    tol = tolerance_min / 60.0
    late = out["wake_deviation_hours"] > tol
    missed = late if one_sided else late | (out["wake_deviation_hours"] < -tol)

    label = (~missed).astype(float)
    label[out["habitual_wake_hour"].isna() | out["wake_deviation_hours"].isna()] = np.nan
    out["wake_success"] = label
    return out


def sensitivity(
    df: pd.DataFrame,
    tolerances: tuple[float, ...] = (15.0, 30.0, 45.0, 60.0, 90.0),
    day_types: tuple[str, ...] = DAY_TYPES,
    one_sided: tuple[bool, ...] = (True, False),
) -> pd.DataFrame:
    """Positive rate across the whole grid of choices.

    The point of the paper's sensitivity table. A proxy whose class balance
    swings from 0.2 to 0.9 across defensible settings is not measuring one thing,
    and a reviewer will say so.
    """
    rows = []
    for day_type in day_types:
        for sided in one_sided:
            for tol in tolerances:
                labelled = wake_success(
                    df, tolerance_min=tol, day_type=day_type, one_sided=sided
                )
                y = labelled["wake_success"].dropna()
                rows.append({
                    "day_type": day_type,
                    "one_sided": sided,
                    "tolerance_min": tol,
                    "labelled_nights": int(len(y)),
                    "positive_rate": round(float(y.mean()), 4) if len(y) else float("nan"),
                })
    return pd.DataFrame(rows)


def agreement(df: pd.DataFrame, variants: list[dict]) -> pd.DataFrame:
    """Pairwise agreement between labels built under different settings.

    Positive rates can coincide while the labels disagree night by night, which
    would mean the settings are not interchangeable however similar the
    summaries look. This checks the labels themselves.
    """
    labels = {}
    for spec in variants:
        name = spec.pop("name")
        labels[name] = wake_success(df, **spec)["wake_success"]

    names = list(labels)
    rows = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            both = pd.concat([labels[a], labels[b]], axis=1).dropna()
            rows.append({
                "a": a, "b": b, "n": len(both),
                "agreement": round(float((both.iloc[:, 0] == both.iloc[:, 1]).mean()), 4)
                if len(both) else float("nan"),
            })
    return pd.DataFrame(rows)


def construct_validity(
    df: pd.DataFrame, against: str, higher_is_better: bool = True
) -> dict:
    """Does the label track an independent self-report?

    The only real evidence that this proxy measures anything. PMData carries
    daily `sleep_quality` and `readiness`; if nights labelled successful do not
    differ on those, the label is measuring regularity and nothing else.

    Returns the group means, their difference, and a rank-biserial style effect
    size. Deliberately reports the difference rather than a p-value - with
    thousands of nights, significance is cheap and the size is what matters.
    """
    work = df[["wake_success", against]].dropna()
    if work.empty or work["wake_success"].nunique() < 2:
        return {"n": len(work), "usable": False}

    good = work.loc[work["wake_success"] == 1, against]
    bad = work.loc[work["wake_success"] == 0, against]
    pooled_sd = float(work[against].std())
    diff = float(good.mean() - bad.mean())
    return {
        "n": int(len(work)),
        "usable": True,
        "n_success": int(len(good)),
        "n_failure": int(len(bad)),
        "mean_on_success": round(float(good.mean()), 4),
        "mean_on_failure": round(float(bad.mean()), 4),
        "difference": round(diff, 4),
        "standardised_difference": round(diff / pooled_sd, 4) if pooled_sd else float("nan"),
        "direction_as_expected": (diff > 0) == higher_is_better,
    }
