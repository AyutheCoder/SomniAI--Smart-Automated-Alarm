"""Model loading + sleep/wake inference for the AI Brain.

Models are loaded once at import. If the artifacts are missing (e.g. a fresh
checkout), the training script is invoked automatically so the service is
self-sufficient on first boot.
"""

from __future__ import annotations

import json
import os
from threading import Lock

import joblib
import numpy as np

from feature_spec import FEATURE_DEFAULTS, FEATURE_NAMES, build_feature_vector

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(HERE, "models")

_MODEL_FILES = {
    "sleep_duration": "sleep_duration_model.joblib",
    "wakeup_consistency": "wakeup_consistency_model.joblib",
    "wake_success": "wake_success_model.joblib",
}

_lock = Lock()
_models: dict[str, object] = {}
_meta: dict = {}


def _artifacts_present() -> bool:
    return all(
        os.path.exists(os.path.join(MODELS_DIR, fname))
        for fname in _MODEL_FILES.values()
    )


def _train_if_missing() -> None:
    if _artifacts_present():
        return
    # Imported lazily so serving doesn't depend on training-only modules.
    from training.model_training import main as train_main

    train_main()


def load_models() -> None:
    """Load (training first if needed) all models into the module cache."""
    with _lock:
        if _models:
            return
        _train_if_missing()
        for key, fname in _MODEL_FILES.items():
            _models[key] = joblib.load(os.path.join(MODELS_DIR, fname))
        meta_path = os.path.join(MODELS_DIR, "feature_meta.json")
        if os.path.exists(meta_path):
            with open(meta_path, encoding="utf-8") as fh:
                _meta.update(json.load(fh))


def models_loaded() -> bool:
    return bool(_models)


def get_meta() -> dict:
    return dict(_meta)


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _regressor_confidence(model, x_row: np.ndarray, scale: float) -> float:
    """Confidence from the spread of per-tree predictions (tighter == surer)."""
    try:
        preds = np.array([tree.predict(x_row)[0] for tree in model.estimators_])
        std = float(preds.std())
        return round(_clamp(1.0 - std / scale), 3)
    except Exception:
        return 0.5


def predict_sleep(features: dict | None) -> dict:
    """features -> {predictedSleepDuration, wakeupConsistency, confidence}."""
    load_models()
    x_row = np.array([build_feature_vector(features)], dtype=float)

    reg_sleep = _models["sleep_duration"]
    reg_cons = _models["wakeup_consistency"]

    duration = float(reg_sleep.predict(x_row)[0])
    consistency = float(reg_cons.predict(x_row)[0])
    conf = round(
        (
            _regressor_confidence(reg_sleep, x_row, scale=2.0)
            + _regressor_confidence(reg_cons, x_row, scale=25.0)
        )
        / 2.0,
        3,
    )

    return {
        "predictedSleepDuration": round(duration, 2),
        "wakeupConsistency": round(consistency, 1),
        "confidence": conf,
    }


def predict_wake_success_batch(rows: list[dict | None]) -> list[float]:
    """Wake-success probability for many candidate feature vectors at once.

    The planner scores dozens of hypothetical nights per request. Sending them
    through `predict_wake_success` one at a time costs a separate forest
    traversal each; scoring the whole matrix in one call turns a ~3s request
    into a few tens of milliseconds, which is the difference between fitting
    inside the caller's timeout and not.
    """
    load_models()
    if not rows:
        return []
    x = np.array([build_feature_vector(r) for r in rows], dtype=float)
    clf = _models["wake_success"]
    proba = clf.predict_proba(x)
    classes = list(getattr(clf, "classes_", [0, 1]))
    idx = classes.index(1) if 1 in classes else len(classes) - 1
    return [float(p[idx]) for p in proba]


def predict_wake_success(features: dict | None) -> dict:
    """features -> {wakeSuccessProbability, oversleepProbability, confidence}."""
    load_models()
    x_row = np.array([build_feature_vector(features)], dtype=float)

    clf = _models["wake_success"]
    proba = clf.predict_proba(x_row)[0]
    # Class order is [0, 1]; guard against a degenerate single-class model.
    classes = list(getattr(clf, "classes_", [0, 1]))
    idx = classes.index(1) if 1 in classes else len(classes) - 1
    wake_success = float(proba[idx])

    return {
        "wakeSuccessProbability": round(wake_success, 3),
        "oversleepProbability": round(1.0 - wake_success, 3),
        "confidence": round(float(max(proba)), 3),
    }


__all__ = [
    "FEATURE_DEFAULTS",
    "FEATURE_NAMES",
    "get_meta",
    "load_models",
    "models_loaded",
    "predict_sleep",
    "predict_wake_success",
    "predict_wake_success_batch",
]