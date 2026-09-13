"""Matched-subset analysis: the one observational grip on the recommendation.

Step 10 established that the planner's advice cannot be tested directly here —
it promises an outcome conditional on a bedtime nobody in LifeSnaps or PMData
adopted on its instruction. But some nights, by coincidence, a participant slept
at roughly the hour the planner would have recommended. Those nights are a
natural experiment, and comparing them against that participant's other nights
is the closest observational data comes to testing the advice.

Two things make it weak, and both are reported rather than finessed:

*It is not randomised.* Nights that happen to match may differ systematically —
someone sleeps early because tomorrow matters, and tomorrow mattering is also
why they wake on time. Matching on the recommendation does not control for that.

*It is likely underpowered.* A tight tolerance leaves few matched nights; a
loose one stops meaning "followed the advice". The tolerance is a parameter and
the count is reported at each setting, so the reader can see the trade rather
than take a single number on trust.

The comparison is **within participant**. Step 8 found most predictable variance
sits between people rather than between nights, so a pooled comparison would
mostly measure which participants happen to fall in which group.
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import wake_plan  # noqa: E402
from evaluation.planner_eval import planner_using  # noqa: E402

DEFAULT_TOLERANCES = (0.25, 0.5, 0.75, 1.0)   # hours around the recommendation
DEFAULT_TARGET = 0.80


def recommendations(
    test: pd.DataFrame,
    features: list[str],
    target: float = DEFAULT_TARGET,
) -> pd.DataFrame:
    """What the planner would have advised on each held-out night.

    The recommendation does not depend on the bedtime actually kept: the sweep
    replaces `bedtime_hour` across its whole grid, so the advice is a function of
    the night's other features. That independence is what makes the comparison
    meaningful rather than circular.
    """
    rows = []
    for _, night in test.iterrows():
        payload = {k: night.get(k) for k in features if pd.notna(night.get(k))}
        plan = wake_plan.plan_wake({"features": payload, "requiredReliability": target})
        rows.append({
            "participant_id": night["participant_id"],
            "date": night["date"],
            "actual_bedtime": night.get("bedtime_hour"),
            "recommended_bedtime": plan["recommendedBedtimeHour"],
            "planner_promised": bool(plan["reachesTarget"]),
            "wake_success": night.get("wake_success"),
        })
    return pd.DataFrame(rows)


def label_matched(recs: pd.DataFrame, tolerance_hours: float) -> pd.DataFrame:
    """Flag nights slept within `tolerance_hours` of the advice."""
    out = recs.copy()
    gap = (out["actual_bedtime"] - out["recommended_bedtime"]).abs()
    out["gap_hours"] = gap
    # Undefined where the planner refused: there is no advice to have followed.
    out["matched"] = np.where(out["recommended_bedtime"].isna(), np.nan,
                              (gap <= tolerance_hours).astype(float))
    return out


def within_participant_effect(labelled: pd.DataFrame) -> dict:
    """Difference in outcome between matched and unmatched nights, per person.

    Each participant contributes one paired difference, and those differences
    are averaged. A participant whose nights are all matched or all unmatched
    contributes nothing, which is why the usable count is smaller than the
    matched count.
    """
    work = labelled.dropna(subset=["matched", "wake_success"])
    diffs, weights = [], []
    for _, grp in work.groupby("participant_id"):
        matched = grp.loc[grp["matched"] == 1, "wake_success"]
        other = grp.loc[grp["matched"] == 0, "wake_success"]
        if len(matched) == 0 or len(other) == 0:
            continue
        diffs.append(float(matched.mean() - other.mean()))
        weights.append(min(len(matched), len(other)))

    if len(diffs) < 2:
        return {
            "participants_usable": len(diffs),
            "conclusive": False,
            "reason": "fewer than two participants contribute a paired difference",
        }

    diffs = np.asarray(diffs, dtype=float)
    mean = float(diffs.mean())
    sd = float(diffs.std(ddof=1))
    se = sd / np.sqrt(len(diffs))
    # Normal interval: with this few participants it is indicative at best, and
    # the width is the point rather than the centre.
    lo, hi = mean - 1.96 * se, mean + 1.96 * se
    return {
        "participants_usable": len(diffs),
        "matched_nights": int((work["matched"] == 1).sum()),
        "unmatched_nights": int((work["matched"] == 0).sum()),
        "mean_difference": round(mean, 4),
        "ci_low": round(float(lo), 4),
        "ci_high": round(float(hi), 4),
        "crosses_zero": bool(lo <= 0 <= hi),
        "cohens_d": round(mean / sd, 4) if sd > 0 else float("nan"),
        "conclusive": bool(not (lo <= 0 <= hi)),
    }


def study(
    test: pd.DataFrame,
    features: list[str],
    model,
    tolerances: tuple[float, ...] = DEFAULT_TOLERANCES,
    target: float = DEFAULT_TARGET,
) -> pd.DataFrame:
    """Sweep the matching tolerance and report the effect and its power at each."""
    with planner_using(model, features):
        recs = recommendations(test, features, target=target)

    rows = []
    for tol in tolerances:
        labelled = label_matched(recs, tol)
        result = within_participant_effect(labelled)
        rows.append({
            "tolerance_hours": tol,
            "advised_nights": int(recs["recommended_bedtime"].notna().sum()),
            **{k: result.get(k) for k in (
                "matched_nights", "unmatched_nights", "participants_usable",
                "mean_difference", "ci_low", "ci_high", "cohens_d",
                "crosses_zero", "conclusive")},
        })
    return pd.DataFrame(rows)


def participants_needed(observed_d: float, power: float = 0.80,
                        alpha: float = 0.05) -> int:
    """Participants required to detect an effect this size, in a paired design.

    Turns an inconclusive result into a usable number: if the direction seen
    here is real, this is roughly the cohort a deployment study needs to show
    it. Normal approximation - adequate for planning, not for a power section.
    """
    from math import ceil
    if not observed_d or observed_d != observed_d or observed_d == 0:
        return -1
    z_alpha, z_beta = 1.96, 0.84          # two-sided 0.05, power 0.80
    return int(ceil(((z_alpha + z_beta) / abs(observed_d)) ** 2))
