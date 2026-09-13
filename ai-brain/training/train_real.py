"""Train the sleep-duration model on real wearable data.

Mirrors `training/model_training.py` exactly - same forest, same
`GroupShuffleSplit`, same seed - so any difference in the numbers comes from the
data rather than from the setup.

Two things this module is careful about, because both would silently inflate the
result:

*Grouped splits.* A participant contributes ~50 nights. Splitting rows at random
would put a person's Monday in train and their Tuesday in test, and the model
would score well by recognising the person rather than by learning anything.
Splits are by `participant_id`, so every test participant is unseen.

*Outcome columns are never features.* `time_in_bed_hours`, `sleep_efficiency`,
`wake_time_hour` and `minutes_to_fall_asleep` are all measured at the same
moment as the target - sleep duration is very nearly time-in-bed times
efficiency. Including any of them would produce a near-perfect model that has
learned arithmetic. `assert_no_leakage` refuses to build a feature matrix that
contains one.
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    f1_score,
    mean_absolute_error,
    r2_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupShuffleSplit

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datasets import schema  # noqa: E402

SEED = 42
TEST_FRACTION = 0.2
TARGET = "sleep_duration_hours"

# Identical to model_training.py, so the comparison isolates the data.
FOREST = dict(n_estimators=200, max_depth=12, min_samples_leaf=8,
              random_state=SEED, n_jobs=-1)

# Anything measured at the same time as the target. See the module docstring.
FORBIDDEN_FEATURES = set(schema.OUTCOME_COLUMNS) | {
    "habitual_wake_hour", "wake_deviation_hours", "wake_success",
}


class LeakageError(ValueError):
    """A feature list contains something measured alongside the target."""


def assert_no_leakage(features: list[str], target: str = TARGET) -> None:
    bad = sorted(set(features) & (FORBIDDEN_FEATURES | {target}))
    if bad:
        raise LeakageError(
            f"{bad} are measured with the target and cannot be predictors"
        )


def available_features(df: pd.DataFrame, min_coverage: float = 0.5) -> list[str]:
    """Model inputs this frame actually populates, in schema order."""
    out = []
    for col in schema.FEATURE_COLUMNS:
        if col in df.columns and df[col].notna().mean() >= min_coverage:
            out.append(col)
    return out


def grouped_split(df: pd.DataFrame, test_size: float = TEST_FRACTION,
                  seed: int = SEED) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split by participant, never by row."""
    splitter = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
    train_idx, test_idx = next(splitter.split(df, groups=df["participant_id"]))
    return df.iloc[train_idx].copy(), df.iloc[test_idx].copy()


def _baselines(train_y: pd.Series, test_y: pd.Series,
               test_groups: pd.Series) -> dict:
    """Reference points the model has to beat to be worth anything."""
    mean_pred = np.full(len(test_y), train_y.mean())
    median_pred = np.full(len(test_y), train_y.median())

    # An oracle, not a baseline: it uses each *test* participant's own mean,
    # which a grouped split makes unavailable at prediction time. Reported
    # because it separates between-person from within-person variance - if the
    # model beats the global mean but not this, it has learned who people are
    # rather than what changes night to night.
    person_mean = test_y.groupby(test_groups).transform("mean")
    return {
        "baseline_train_mean_mae": float(mean_absolute_error(test_y, mean_pred)),
        "baseline_train_median_mae": float(mean_absolute_error(test_y, median_pred)),
        "oracle_person_mean_mae": float(mean_absolute_error(test_y, person_mean)),
    }


def train_sleep_duration(
    df: pd.DataFrame,
    features: list[str] | None = None,
    seed: int = SEED,
    test_size: float = TEST_FRACTION,
) -> dict:
    """Fit and evaluate on one grouped split. Returns metrics and the model."""
    features = features or available_features(df)
    assert_no_leakage(features)

    work = df.dropna(subset=features + [TARGET]).reset_index(drop=True)
    if work["participant_id"].nunique() < 5:
        raise ValueError("need at least 5 participants for a grouped split")

    train, test = grouped_split(work, test_size=test_size, seed=seed)
    X_tr, y_tr = train[features], train[TARGET]
    X_te, y_te = test[features], test[TARGET]

    model = RandomForestRegressor(**{**FOREST, "random_state": seed}).fit(X_tr, y_tr)
    pred = model.predict(X_te)

    metrics = {
        "n_rows": int(len(work)),
        "n_train": int(len(train)),
        "n_test": int(len(test)),
        "participants_train": int(train["participant_id"].nunique()),
        "participants_test": int(test["participant_id"].nunique()),
        "features": features,
        "mae": float(mean_absolute_error(y_te, pred)),
        "rmse": float(np.sqrt(np.mean((y_te - pred) ** 2))),
        "r2": float(r2_score(y_te, pred)),
        **_baselines(y_tr, y_te, test["participant_id"]),
        "importances": {
            f: round(float(i), 4)
            for f, i in sorted(zip(features, model.feature_importances_),
                               key=lambda kv: -kv[1])
        },
    }
    metrics["beats_mean_baseline"] = metrics["mae"] < metrics["baseline_train_mean_mae"]
    metrics["improvement_vs_mean"] = round(
        1.0 - metrics["mae"] / metrics["baseline_train_mean_mae"], 4
    )
    return {"metrics": metrics, "model": model}


def repeated_evaluation(
    df: pd.DataFrame,
    features: list[str] | None = None,
    seeds: tuple[int, ...] = (0, 1, 2, 3, 4),
) -> pd.DataFrame:
    """Re-split several times.

    With 69 participants a single 20% split puts ~14 people in test, so one
    number is a coin toss. The spread across seeds is the honest result.
    """
    rows = []
    for seed in seeds:
        m = train_sleep_duration(df, features=features, seed=seed)["metrics"]
        rows.append({k: m[k] for k in
                     ("mae", "rmse", "r2", "baseline_train_mean_mae",
                      "oracle_person_mean_mae", "n_test", "participants_test")}
                    | {"seed": seed})
    return pd.DataFrame(rows)


def train_wake_regularity(
    df: pd.DataFrame,
    features: list[str] | None = None,
    seed: int = SEED,
    test_size: float = TEST_FRACTION,
    label_column: str = "wake_success",
) -> dict:
    """Classify whether a night's wake lands near the participant's habit.

    The target is the constructed proxy from `datasets.wake_proxy`, renamed in
    step 7 from "wake success" to wake-time *regularity* after it showed no
    association with self-reported wellbeing.

    Note what is not a predictor: `sleep_duration_hours`. Combined with
    `bedtime_hour` it reconstructs wake time, and therefore the label. It sits in
    `FORBIDDEN_FEATURES` and `assert_no_leakage` rejects it.
    """
    features = features or available_features(df)
    assert_no_leakage(features, target=label_column)

    work = df.dropna(subset=features + [label_column]).reset_index(drop=True)
    if work["participant_id"].nunique() < 5:
        raise ValueError("need at least 5 participants for a grouped split")
    if work[label_column].nunique() < 2:
        raise ValueError("label is degenerate - only one class present")

    train, test = grouped_split(work, test_size=test_size, seed=seed)
    X_tr, y_tr = train[features], train[label_column].astype(int)
    X_te, y_te = test[features], test[label_column].astype(int)
    if y_tr.nunique() < 2 or y_te.nunique() < 2:
        raise ValueError("a split left one side single-class")

    model = RandomForestClassifier(
        **{**FOREST, "random_state": seed, "class_weight": "balanced"}
    ).fit(X_tr, y_tr)
    pred = model.predict(X_te)
    proba = model.predict_proba(X_te)[:, list(model.classes_).index(1)]

    majority = int(y_tr.mode().iloc[0])
    majority_pred = np.full(len(y_te), majority)
    # Oracle: each test participant's own most common outcome. Unavailable under
    # a grouped split, so a diagnostic rather than a competitor - it separates
    # "which person is this" from "what was different about this night".
    person_majority = y_te.groupby(test["participant_id"]).transform(
        lambda s: s.mode().iloc[0]
    )

    metrics = {
        "n_rows": int(len(work)),
        "n_train": int(len(train)),
        "n_test": int(len(test)),
        "participants_train": int(train["participant_id"].nunique()),
        "participants_test": int(test["participant_id"].nunique()),
        "features": features,
        "positive_rate_train": round(float(y_tr.mean()), 4),
        "positive_rate_test": round(float(y_te.mean()), 4),
        "accuracy": float(accuracy_score(y_te, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_te, pred)),
        "f1": float(f1_score(y_te, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_te, proba)),
        "baseline_majority_accuracy": float(accuracy_score(y_te, majority_pred)),
        "baseline_majority_balanced_accuracy":
            float(balanced_accuracy_score(y_te, majority_pred)),
        "oracle_person_majority_accuracy":
            float(accuracy_score(y_te, person_majority)),
        "importances": {
            f: round(float(i), 4)
            for f, i in sorted(zip(features, model.feature_importances_),
                               key=lambda kv: -kv[1])
        },
    }
    metrics["beats_majority"] = metrics["accuracy"] > metrics["baseline_majority_accuracy"]
    # AUC is the honest headline on an imbalanced label: 0.5 is chance whatever
    # the class balance, whereas accuracy flatters a majority-class predictor.
    metrics["auc_above_chance"] = metrics["roc_auc"] - 0.5
    return {"metrics": metrics, "model": model}


def repeated_classification(
    df: pd.DataFrame,
    features: list[str] | None = None,
    seeds: tuple[int, ...] = (0, 1, 2, 3, 4),
    label_column: str = "wake_success",
) -> pd.DataFrame:
    """Re-split several times; the spread is the result."""
    rows = []
    for seed in seeds:
        try:
            m = train_wake_regularity(df, features=features, seed=seed,
                                      label_column=label_column)["metrics"]
        except ValueError:
            continue
        rows.append({k: m[k] for k in
                     ("accuracy", "balanced_accuracy", "roc_auc", "f1",
                      "baseline_majority_accuracy", "oracle_person_majority_accuracy",
                      "positive_rate_test", "participants_test")} | {"seed": seed})
    return pd.DataFrame(rows)


def synthetic_reference(features: list[str], seed: int = SEED) -> dict:
    """The same model and features, trained on the synthetic panel.

    The published synthetic metrics used all 15 inputs, so comparing them
    directly against a real-data model with 8 would confuse "synthetic versus
    real" with "more features versus fewer". This retrains the synthetic panel
    on the same feature subset to isolate the first question.
    """
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "data", "enhanced_sleep_dataset.csv")
    if not os.path.exists(path):
        return {"available": False}

    df = pd.read_csv(path)
    if "sleep_duration" in df.columns and TARGET not in df.columns:
        df = df.rename(columns={"sleep_duration": TARGET})
    group_col = "person_id" if "person_id" in df.columns else None
    if group_col is None or TARGET not in df.columns:
        return {"available": False}

    df = df.rename(columns={group_col: "participant_id"})
    usable = [f for f in features if f in df.columns]
    out = train_sleep_duration(df[["participant_id", TARGET] + usable],
                               features=usable, seed=seed)
    return {"available": True, **out["metrics"]}
