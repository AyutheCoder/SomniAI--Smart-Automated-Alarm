"""Calibration and refusal quality for the wake planner.

Under the infeasibility-first framing this is the paper's central claim, so what
is and is not being measured needs stating precisely.

**What cannot be measured here.** The planner's output is counterfactual: "if you
slept at 22:30 you would reach 85% reliability." Nobody in LifeSnaps or PMData
was following its advice, so the counterfactual is unobservable. No amount of
retrospective data settles whether that promise would have held.

**What can.** Two things, both necessary for the promise to be trustworthy:

1. *Calibration of the reliability estimate.* The promise is the model's
   predicted probability. On held-out participants, among nights the model rates
   at 0.8-0.9, do ~85% actually go well? If not, every number the planner states
   is wrong before any counterfactual reasoning begins.

2. *Refusal quality.* Whether the planner declines exactly when a target is out
   of reach. Ground truth is the held-out participant's own achieved rate: if
   someone wakes regularly on 65% of nights, a 90% target is not available to
   them and refusing is correct.

Calibration is necessary, not sufficient. Say so in the paper.
"""

from __future__ import annotations

import os
import sys
from contextlib import contextmanager

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import wake_plan  # noqa: E402
from feature_spec import FEATURE_DEFAULTS  # noqa: E402

DEFAULT_BINS = 10
# Targets a user might plausibly ask for.
TARGET_GRID = (0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.95)


# ---------------------------------------------------------------------------
# Calibration
# ---------------------------------------------------------------------------


def calibration_table(y_true, y_prob, n_bins: int = DEFAULT_BINS) -> pd.DataFrame:
    """Reliability diagram: predicted probability against observed frequency."""
    y_true = np.asarray(y_true, dtype=float)
    y_prob = np.asarray(y_prob, dtype=float)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    idx = np.clip(np.digitize(y_prob, edges[1:-1], right=False), 0, n_bins - 1)

    rows = []
    for b in range(n_bins):
        sel = idx == b
        if not sel.any():
            continue
        rows.append({
            "bin_low": round(float(edges[b]), 3),
            "bin_high": round(float(edges[b + 1]), 3),
            "n": int(sel.sum()),
            "mean_predicted": round(float(y_prob[sel].mean()), 4),
            "observed_rate": round(float(y_true[sel].mean()), 4),
            "gap": round(float(y_prob[sel].mean() - y_true[sel].mean()), 4),
        })
    return pd.DataFrame(rows)


def calibration_error(y_true, y_prob, n_bins: int = DEFAULT_BINS) -> dict:
    """Expected and maximum calibration error, plus Brier score.

    ECE weights each bin's gap by how many nights fall in it, so a large gap in
    a nearly-empty bin does not dominate. Brier is reported alongside because
    ECE alone is insensitive to a model that is calibrated but uninformative -
    always predicting the base rate is perfectly calibrated and useless.
    """
    table = calibration_table(y_true, y_prob, n_bins)
    if table.empty:
        return {"ece": float("nan"), "mce": float("nan"), "brier": float("nan"), "n": 0}
    total = table["n"].sum()
    weights = table["n"] / total
    y_true = np.asarray(y_true, dtype=float)
    y_prob = np.asarray(y_prob, dtype=float)
    return {
        "n": int(total),
        "ece": round(float((weights * table["gap"].abs()).sum()), 4),
        "mce": round(float(table["gap"].abs().max()), 4),
        "brier": round(float(np.mean((y_prob - y_true) ** 2)), 4),
        "base_rate": round(float(y_true.mean()), 4),
        "mean_prediction": round(float(y_prob.mean()), 4),
    }


# ---------------------------------------------------------------------------
# Driving the real planner with a model trained on real data
# ---------------------------------------------------------------------------


def _vector(row: dict, features: list[str]) -> list[float]:
    return [float(row.get(k, FEATURE_DEFAULTS.get(k, 0.0))) for k in features]


@contextmanager
def planner_using(model, features: list[str], sleep_hours: float = 7.5):
    """Run `wake_plan` against a given classifier instead of the shipped models.

    The service's own `predict` module loads forests trained on the synthetic
    panel. Evaluating the planner on real data means substituting a model
    trained on real data, which is what this does for the duration of the block.
    """
    positive = list(model.classes_).index(1)

    # Frames rather than bare lists, so sklearn sees the feature names it was
    # fitted with instead of warning on every call.
    def prob(f):
        X = pd.DataFrame([_vector(f or {}, features)], columns=features)
        return {"wakeSuccessProbability": float(model.predict_proba(X)[0][positive])}

    def batch(rows):
        X = pd.DataFrame([_vector(r or {}, features) for r in rows], columns=features)
        return [float(p) for p in model.predict_proba(X)[:, positive]]

    originals = (wake_plan.predict_wake_success,
                 wake_plan.predict_wake_success_batch,
                 wake_plan.predict_sleep)
    wake_plan.predict_wake_success = prob
    wake_plan.predict_wake_success_batch = batch
    wake_plan.predict_sleep = lambda f: {"predictedSleepDuration": sleep_hours}
    try:
        yield
    finally:
        (wake_plan.predict_wake_success,
         wake_plan.predict_wake_success_batch,
         wake_plan.predict_sleep) = originals


# ---------------------------------------------------------------------------
# Planners under comparison
# ---------------------------------------------------------------------------


def plan_inverse(row: dict, target: float, features: list[str]) -> dict:
    """The real planner: sweeps bedtime, then combines levers, may refuse."""
    out = wake_plan.plan_wake({
        "features": {k: row.get(k) for k in features if row.get(k) is not None},
        "requiredReliability": target,
    })
    return {
        "promises": bool(out["reachesTarget"]),
        "stated_reliability": float(out["achievedReliability"]),
        "recommended_bedtime": out["recommendedBedtimeHour"],
    }


def plan_always_promise(row: dict, target: float, features: list[str]) -> dict:
    """Emits a bedtime and asserts the target, whatever the evidence.

    The behaviour the paper argues against: most systems output a number
    regardless of whether anything supports it.
    """
    return {
        "promises": True,
        "stated_reliability": float(target),
        "recommended_bedtime": row.get("bedtime_hour"),
    }


def plan_cycle_calculator(row: dict, target: float, features: list[str],
                          cycles: int = 5, onset_min: float = 14.0) -> dict:
    """The familiar "count back 90-minute cycles" rule. No model, never refuses."""
    wake = float(row.get("wake_time_hour", 7.0))
    bedtime = wake - cycles * 1.5 - onset_min / 60.0
    return {
        "promises": True,
        "stated_reliability": float(target),
        "recommended_bedtime": round(bedtime % 24.0 + (24.0 if bedtime % 24.0 < 12 else 0.0), 2),
    }


def plan_forward_only(row: dict, target: float, features: list[str]) -> dict:
    """Scores tonight as it stands and promises if it already clears the target.

    No inversion and no search: this isolates what the bedtime sweep and the
    coordinate ascent actually buy.
    """
    p = wake_plan.predict_wake_success(
        {k: row.get(k) for k in features if row.get(k) is not None}
    )["wakeSuccessProbability"]
    return {
        "promises": bool(p >= target),
        "stated_reliability": float(p),
        "recommended_bedtime": row.get("bedtime_hour"),
    }


PLANNERS = {
    "inverse": plan_inverse,
    "always_promise": plan_always_promise,
    "cycle_calculator": plan_cycle_calculator,
    "forward_only": plan_forward_only,
}


# ---------------------------------------------------------------------------
# Refusal quality
# ---------------------------------------------------------------------------


def achievable_rate(test: pd.DataFrame, label: str = "wake_success") -> pd.Series:
    """Each held-out participant's own achieved rate of regular wakes.

    The ground truth for whether a target was available to them at all. A
    participant who wakes on schedule 65% of the time cannot deliver 90%, so a
    planner promising them 90% is wrong however confident it sounds.
    """
    return test.groupby("participant_id")[label].mean()


def refusal_evaluation(
    test: pd.DataFrame,
    features: list[str],
    planners: dict | None = None,
    targets: tuple[float, ...] = TARGET_GRID,
    label: str = "wake_success",
    max_nights_per_participant: int | None = 20,
) -> pd.DataFrame:
    """Per (planner, target): does it promise only what the participant can deliver?"""
    planners = planners or PLANNERS
    rates = achievable_rate(test, label=label)

    sample = test
    if max_nights_per_participant:
        sample = test.groupby("participant_id", sort=False).head(max_nights_per_participant)

    rows = []
    for name, fn in planners.items():
        for target in targets:
            tp = fp = tn = fn_ = 0
            for _, night in sample.iterrows():
                achievable = rates[night["participant_id"]] >= target
                promised = fn(night.to_dict(), target, features)["promises"]
                if promised and achievable:
                    tp += 1
                elif promised and not achievable:
                    fp += 1                  # promised what could not be delivered
                elif not promised and not achievable:
                    tn += 1                  # correctly declined
                else:
                    fn_ += 1                 # refused something achievable
            total = tp + fp + tn + fn_
            rows.append({
                "planner": name,
                "target": target,
                "n": total,
                "promised": tp + fp,
                "over_promised": fp,
                "correct_refusals": tn,
                "missed_opportunities": fn_,
                "over_promise_rate": round(fp / total, 4) if total else float("nan"),
                "refusal_precision": round(tn / (tn + fn_), 4) if (tn + fn_) else float("nan"),
                "refusal_recall": round(tn / (tn + fp), 4) if (tn + fp) else float("nan"),
                "accuracy": round((tp + tn) / total, 4) if total else float("nan"),
            })
    return pd.DataFrame(rows)
