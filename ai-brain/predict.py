"""Model loading + sleep/wake inference for the AI Brain.

Since prompt 5.2 the models are trained on real data: the LifeSnaps cohort,
through the paper's pipeline (`training/train_shipped.py`), committed in
`models/real/` with their model card (`model_card.json`, `MODEL_CARD.md`).
They replace forests trained on a synthetic panel.

Each model reads only the inputs it was trained on, in the card's order; an
input the caller doesn't send takes the training nights' median, so it
neither helps nor hurts. Inputs no dataset recorded (screen time, caffeine,
room noise and temperature, snoozes) can't move a prediction.

There is no synthetic fallback: if the models aren't there, nothing is
predicted (`ModelsUnavailable`), the service says so on /health, and the app
uses its own rule-based fallback, labelled as such.
"""

from __future__ import annotations

import json
import os
from threading import Lock

import joblib
import numpy as np
import pandas as pd
import sklearn

from feature_spec import FEATURE_DEFAULTS, FEATURE_NAMES

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(HERE, "models", "real")
CARD_FILE = "model_card.json"


class ModelsUnavailable(RuntimeError):
    """The shipped models or their card are missing or unusable."""


_lock = Lock()
_models: dict[str, object] = {}
_card: dict = {}


def load_models(models_dir: str | None = None) -> None:
    """Load the shipped models and their card, once. Raises ModelsUnavailable."""
    with _lock:
        if _models:
            return
        root = models_dir or MODELS_DIR
        card_path = os.path.join(root, CARD_FILE)
        if not os.path.exists(card_path):
            raise ModelsUnavailable(f"no model card at {card_path}; see training/train_shipped.py")
        with open(card_path, encoding="utf-8") as fh:
            card = json.load(fh)
        trained_with = card.get("sklearnVersion", "")
        # A forest pickled by one scikit-learn minor version isn't promised to load in another.
        if trained_with.split(".")[:2] != sklearn.__version__.split(".")[:2]:
            raise ModelsUnavailable(f"models were trained with scikit-learn {trained_with}; this is {sklearn.__version__}")
        loaded = {}
        for key, spec in card["models"].items():
            path = os.path.join(root, spec["file"])
            if not os.path.exists(path):
                raise ModelsUnavailable(f"{spec['file']} is missing from {root}")
            loaded[key] = joblib.load(path)
        _models.update(loaded)
        _card.clear()
        _card.update(card)


def models_loaded() -> bool:
    return bool(_models)


def get_meta() -> dict:
    """The model card: what the models were trained on and how well they do."""
    return dict(_card)


def _frame(rows: list[dict | None]) -> pd.DataFrame:
    """The models' inputs, in the card's order; anything not sent takes the training median."""
    feats = _card["features"]
    medians = _card["featureMedians"]
    out = []
    for r in rows:
        r = r or {}
        row = []
        for f in feats:
            v = r.get(f)
            try:
                v = float(v)
                ok = np.isfinite(v)
            except (TypeError, ValueError):
                ok = False
            row.append(v if ok else float(medians[f]))
        out.append(row)
    return pd.DataFrame(out, columns=feats)


def _regressor_confidence(model, x: pd.DataFrame, scale: float) -> float:
    """Confidence from the spread of per-tree predictions (tighter == surer)."""
    try:
        preds = np.array([tree.predict(x.to_numpy())[0] for tree in model.estimators_])
        return round(max(0.0, min(1.0, 1.0 - float(preds.std()) / scale)), 3)
    except Exception:
        return 0.5


def _measured_consistency(features: dict | None) -> float | None:
    v = (features or {}).get("sleep_consistency")
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return round(max(0.0, min(100.0, v)), 1) if np.isfinite(v) else None


def predict_sleep(features: dict | None) -> dict:
    """features -> {predictedSleepDuration, wakeupConsistency, confidence}.

    `wakeupConsistency` is no longer a prediction: no real-data target exists
    for it (MODEL_CARD.md), so it is the caller's own measured sleep
    consistency, passed back, or null when none was sent.
    """
    load_models()
    x = _frame([features])
    model = _models["sleep_duration"]
    return {
        "predictedSleepDuration": round(float(model.predict(x)[0]), 2),
        "wakeupConsistency": _measured_consistency(features),
        "confidence": _regressor_confidence(model, x, scale=2.0),
    }


def _regular_index(clf) -> int:
    classes = list(getattr(clf, "classes_", [0, 1]))
    return classes.index(1) if 1 in classes else len(classes) - 1


def predict_wake_success_batch(rows: list[dict | None]) -> list[float]:
    """Wake-time regularity probability for many candidate feature vectors at once.

    The planner scores dozens of hypothetical nights per request; one call over
    the whole matrix keeps that inside the caller's timeout.
    """
    load_models()
    if not rows:
        return []
    clf = _models["wake_regularity"]
    return [float(p[_regular_index(clf)]) for p in clf.predict_proba(_frame(rows))]


def predict_wake_success(features: dict | None) -> dict:
    """features -> {wakeSuccessProbability, oversleepProbability, confidence}.

    The names are the API's from before; what they measure is wake-time
    regularity (MODEL_CARD.md): the chance of waking close to your usual time.
    """
    load_models()
    clf = _models["wake_regularity"]
    proba = clf.predict_proba(_frame([features]))[0]
    regular = float(proba[_regular_index(clf)])
    return {
        "wakeSuccessProbability": round(regular, 3),
        "oversleepProbability": round(1.0 - regular, 3),
        "confidence": round(float(max(proba)), 3),
    }


__all__ = [
    "FEATURE_DEFAULTS",
    "FEATURE_NAMES",
    "ModelsUnavailable",
    "get_meta",
    "load_models",
    "models_loaded",
    "predict_sleep",
    "predict_wake_success",
    "predict_wake_success_batch",
]
