from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import joblib
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.metrics import accuracy_score, mean_absolute_error, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit

# Allow running as `python training/model_training.py` from the ai-brain root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from feature_spec import FEATURE_NAMES, FEATURE_SPEC  # noqa: E402
from training.dataset_builder import (  # noqa: E402
    TARGET_COLUMNS,
    build_dataset,
    summarize,
)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "data")
MODELS_DIR = os.path.join(ROOT, "models")
DATASET_PATH = os.path.join(DATA_DIR, "enhanced_sleep_dataset.csv")

SEED = 42
TEST_FRACTION = 0.2


REQUIRED_COLUMNS = FEATURE_NAMES + TARGET_COLUMNS


def load_dataset(rebuild: bool = False) -> pd.DataFrame:
    """Return the training frame, rebuilding the CSV only when it can't be used.

    The dataset is a checked-in artifact, so a plain training run reuses it and
    reproduces the same models. It is regenerated when missing, truncated, or
    missing columns the current `FEATURE_SPEC` needs.
    """
    if not rebuild and os.path.exists(DATASET_PATH) and os.path.getsize(DATASET_PATH) > 0:
        try:
            df = pd.read_csv(DATASET_PATH)
        except pd.errors.EmptyDataError:
            df = None
        if df is not None:
            missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
            if not missing and len(df) > 0:
                print(f"Using dataset: {DATASET_PATH} ({len(df)} rows)")
                return df
            reason = f"missing columns {missing}" if missing else "no rows"
            print(f"Rebuilding dataset ({reason})")

    df = build_dataset(seed=SEED)
    os.makedirs(DATA_DIR, exist_ok=True)
    df.to_csv(DATASET_PATH, index=False)
    print(f"Wrote dataset: {DATASET_PATH} ({len(df)} rows)")
    print(summarize(df))
    return df


def main(rebuild: bool = False) -> None:
    os.makedirs(MODELS_DIR, exist_ok=True)

    df = load_dataset(rebuild=rebuild)

    X = df[FEATURE_NAMES].to_numpy(dtype=float)
    y_dur = df["sleep_duration"].to_numpy(dtype=float)
    y_cons = df["wakeup_consistency"].to_numpy(dtype=float)
    y_wake = df["wake_success"].to_numpy(dtype=int)

    # Nights from one simulated sleeper are highly correlated, so a random row
    # split would leak a person across the boundary and inflate the metrics.
    # Split by person where the column is available.
    groups = df["person_id"] if "person_id" in df.columns else df.index
    splitter = GroupShuffleSplit(n_splits=1, test_size=TEST_FRACTION, random_state=SEED)
    train_idx, test_idx = next(splitter.split(X, y_dur, groups=groups))

    X_tr, X_te = X[train_idx], X[test_idx]
    dur_tr, dur_te = y_dur[train_idx], y_dur[test_idx]
    cons_tr, cons_te = y_cons[train_idx], y_cons[test_idx]
    wake_tr, wake_te = y_wake[train_idx], y_wake[test_idx]

    # min_samples_leaf keeps the trees from memorizing individual nights, which
    # the noisier simulated labels invite. It also cuts the serialized forests
    # from ~82 MB to ~26 MB, which the Docker image has to carry.
    forest = dict(n_estimators=200, max_depth=12, min_samples_leaf=8,
                  random_state=SEED, n_jobs=-1)

    reg_sleep = RandomForestRegressor(**forest).fit(X_tr, dur_tr)
    reg_cons = RandomForestRegressor(**forest).fit(X_tr, cons_tr)
    clf_wake = RandomForestClassifier(**forest).fit(X_tr, wake_tr)

    # Baselines make the headline numbers readable: predicting the training mean
    # for the regressors, and the majority class for the classifier. A model that
    # doesn't beat these has learned nothing, whatever its raw accuracy looks like.
    dur_baseline = float(mean_absolute_error(dur_te, [dur_tr.mean()] * len(dur_te)))
    cons_baseline = float(mean_absolute_error(cons_te, [cons_tr.mean()] * len(cons_te)))
    majority = 1 if wake_tr.mean() >= 0.5 else 0
    wake_baseline = float(accuracy_score(wake_te, [majority] * len(wake_te)))

    metrics = {
        "sleep_duration_mae": float(mean_absolute_error(dur_te, reg_sleep.predict(X_te))),
        "sleep_duration_mae_baseline": dur_baseline,
        "wakeup_consistency_mae": float(mean_absolute_error(cons_te, reg_cons.predict(X_te))),
        "wakeup_consistency_mae_baseline": cons_baseline,
        "wake_success_accuracy": float(accuracy_score(wake_te, clf_wake.predict(X_te))),
        "wake_success_accuracy_baseline": wake_baseline,
        "wake_success_auc": float(
            roc_auc_score(wake_te, clf_wake.predict_proba(X_te)[:, 1])
        ),
        "wake_success_positive_rate": float(y_wake.mean()),
    }

    joblib.dump(reg_sleep, os.path.join(MODELS_DIR, "sleep_duration_model.joblib"))
    joblib.dump(reg_cons, os.path.join(MODELS_DIR, "wakeup_consistency_model.joblib"))
    joblib.dump(clf_wake, os.path.join(MODELS_DIR, "wake_success_model.joblib"))

    meta = {
        "feature_names": FEATURE_NAMES,
        "feature_defaults": {name: default for name, default, _ in FEATURE_SPEC},
        "feature_importances": {
            "sleep_duration": dict(
                zip(FEATURE_NAMES, [round(v, 4) for v in reg_sleep.feature_importances_])
            ),
            "wake_success": dict(
                zip(FEATURE_NAMES, [round(v, 4) for v in clf_wake.feature_importances_])
            ),
        },
        "metrics": metrics,
        "n_samples": int(len(df)),
        "n_persons": int(df["person_id"].nunique()) if "person_id" in df.columns else None,
        "split": "GroupShuffleSplit by person_id",
        "sklearn_version": sklearn.__version__,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "seed": SEED,
    }
    with open(os.path.join(MODELS_DIR, "feature_meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)

    print("Trained models -> ", MODELS_DIR)
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train the SomniAI sleep models.")
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="regenerate enhanced_sleep_dataset.csv instead of reusing it",
    )
    main(rebuild=parser.parse_args().rebuild)