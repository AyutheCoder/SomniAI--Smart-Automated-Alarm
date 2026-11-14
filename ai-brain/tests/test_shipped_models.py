"""The models the service ships (prompt 5.2): trained on real data, honest about it.

These run without the datasets: they check the committed models and card. The
training itself (training/train_shipped.py) is checked on a small frame shaped
like the real one, and its full run is recorded in MODEL_CARD.md.
"""

from __future__ import annotations

import json
import os
import shutil

import numpy as np
import pandas as pd
import pytest

import predict
import recommend
from datasets import schema
from feature_spec import FEATURE_NAMES
from training import train_real, train_shipped

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARD = os.path.join(HERE, "models", "real", "model_card.json")


@pytest.fixture(scope="module")
def card() -> dict:
    with open(CARD, encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture()
def fresh(monkeypatch):
    """predict with nothing loaded, so a test can load from where it likes."""
    monkeypatch.setattr(predict, "_models", {})
    monkeypatch.setattr(predict, "_card", {})
    return predict


# --- what was shipped ------------------------------------------------------

def test_trained_on_lifesnaps_only_and_credited(card):
    assert card["trainedOn"]["name"] == "LifeSnaps"
    assert card["trainedOn"]["licence"] == "CC BY 4.0"
    assert "Scientific Data 9:663" in card["trainedOn"]["citation"]
    assert card["trainedOn"]["participants"] == 69
    assert card["trainedOn"]["nights"] == 3551
    assert "PMData" in card["notUsed"] and "non-commercial" in card["notUsed"]


def test_its_evaluation_is_the_papers(card):
    """Same cohort, features, forest and splits as evaluation/run_study.py: the paper's numbers."""
    sd = card["models"]["sleep_duration"]["evaluation"]
    wr = card["models"]["wake_regularity"]["evaluation"]
    assert sd["mae"]["mean"] == pytest.approx(1.016, abs=0.001)
    assert sd["r2"]["mean"] == pytest.approx(0.186, abs=0.001)
    assert (sd["r2"]["ci_low"], sd["r2"]["ci_high"]) == pytest.approx((0.075, 0.297), abs=0.001)
    assert wr["roc_auc"]["mean"] == pytest.approx(0.660, abs=0.001)
    assert (wr["roc_auc"]["ci_low"], wr["roc_auc"]["ci_high"]) == pytest.approx((0.610, 0.710), abs=0.001)
    assert wr["balanced_accuracy"]["mean"] == pytest.approx(0.615, abs=0.001)
    assert sd["mae"]["n_splits"] == wr["roc_auc"]["n_splits"] == 8


def test_inputs_are_real_features_and_nothing_measured_with_the_target(card):
    feats = card["features"]
    assert feats == ["chronotype_code", "bedtime_hour", "exercise_minutes", "resting_hr", "steps",
                     "sleep_consistency", "sleep_debt_hours"]
    assert set(feats) <= set(FEATURE_NAMES)
    train_real.assert_no_leakage(feats)
    assert "stress_level" not in feats
    assert set(card["featureMedians"]) == set(feats)
    not_used = {x["feature"]: x["why"] for x in card["inputsNotUsed"]}
    assert set(not_used) == set(FEATURE_NAMES) - set(feats)
    assert not_used["screen_minutes_before_bed"] == "no public wearable dataset records it"
    assert "53%" in not_used["stress_level"]
    assert "band" in not_used["age"]


def test_the_synthetic_consistency_model_is_gone(card):
    assert set(card["models"]) == {"sleep_duration", "wake_regularity"}
    assert "wakeup_consistency" in card["noLongerPredicted"]


def test_recommend_words_its_advice_by_the_shipped_models_thresholds(card):
    assert recommend.OVERSLEEP_ALERT == card["thresholds"]["offScheduleAlert"]
    assert recommend.WAKE_RELIABLE == card["thresholds"]["regularHigh"]


def test_the_markdown_card_is_generated_from_the_json(card):
    with open(os.path.join(HERE, "MODEL_CARD.md"), encoding="utf-8") as fh:
        assert fh.read() == train_shipped.card_markdown(card)


# --- serving ---------------------------------------------------------------

def test_predictions_come_from_the_shipped_models(fresh):
    fresh.load_models()
    assert fresh.models_loaded()
    assert fresh.get_meta()["trainedOn"]["name"] == "LifeSnaps"
    s = fresh.predict_sleep({"bedtime_hour": 23.5, "sleep_consistency": 72, "resting_hr": 60})
    assert 3.0 < s["predictedSleepDuration"] < 11.0
    assert 0.0 <= s["confidence"] <= 1.0
    w = fresh.predict_wake_success({"bedtime_hour": 23.5})
    assert 0.0 <= w["wakeSuccessProbability"] <= 1.0
    assert w["oversleepProbability"] == pytest.approx(1.0 - w["wakeSuccessProbability"], abs=0.0011)


def test_an_input_not_sent_takes_the_training_median(fresh, card):
    medians = card["featureMedians"]
    assert fresh.predict_sleep({}) == {**fresh.predict_sleep(dict(medians)), "wakeupConsistency": None}
    assert fresh.predict_wake_success({}) == fresh.predict_wake_success(dict(medians))
    # Junk is treated as not sent, never as a number.
    assert fresh.predict_wake_success({"resting_hr": "fast", "steps": float("nan")}) == fresh.predict_wake_success({})


def test_inputs_no_dataset_recorded_cannot_move_a_prediction(fresh):
    base = {"bedtime_hour": 23.5, "sleep_consistency": 70}
    loud = {**base, "screen_minutes_before_bed": 180, "caffeine_mg": 400, "ambient_noise_db": 70, "room_temp_c": 30,
            "snooze_count": 6, "alarm_response_ms": 30000, "stress_level": 100, "age": 70}
    assert fresh.predict_wake_success(loud) == fresh.predict_wake_success(base)
    assert fresh.predict_sleep(loud)["predictedSleepDuration"] == fresh.predict_sleep(base)["predictedSleepDuration"]


def test_inputs_it_was_trained_on_do_move_it(fresh):
    early = fresh.predict_sleep({"bedtime_hour": 22.0})["predictedSleepDuration"]
    late = fresh.predict_sleep({"bedtime_hour": 26.0})["predictedSleepDuration"]
    assert early != late


def test_consistency_is_the_measured_one_passed_back(fresh):
    assert fresh.predict_sleep({"sleep_consistency": 71.26})["wakeupConsistency"] == 71.3
    assert fresh.predict_sleep({"sleep_consistency": 140})["wakeupConsistency"] == 100.0
    assert fresh.predict_sleep({})["wakeupConsistency"] is None


def test_the_planners_batch_scores_like_single_calls(fresh):
    rows = [{"bedtime_hour": h} for h in (22.0, 23.0, 24.0, 25.0)]
    batch = fresh.predict_wake_success_batch(rows)
    single = [fresh.predict_wake_success(r)["wakeSuccessProbability"] for r in rows]
    assert [round(b, 3) for b in batch] == single
    assert fresh.predict_wake_success_batch([]) == []


def test_without_the_models_nothing_is_predicted_and_nothing_synthetic_is_trained(fresh, tmp_path):
    with pytest.raises(predict.ModelsUnavailable, match="no model card"):
        fresh.load_models(str(tmp_path))
    assert not fresh.models_loaded()
    assert list(tmp_path.iterdir()) == [], "nothing was trained in its place"


def test_a_missing_model_file_or_another_sklearn_is_refused(fresh, tmp_path, card):
    real = os.path.dirname(CARD)
    shutil.copy(CARD, tmp_path / "model_card.json")
    with pytest.raises(predict.ModelsUnavailable, match="is missing"):
        fresh.load_models(str(tmp_path))
    other = {**card, "sklearnVersion": "1.6.1"}
    (tmp_path / "model_card.json").write_text(json.dumps(other), encoding="utf-8")
    for f in ("sleep_duration.joblib", "wake_regularity.joblib"):
        shutil.copy(os.path.join(real, f), tmp_path / f)
    with pytest.raises(predict.ModelsUnavailable, match="scikit-learn 1.6.1"):
        fresh.load_models(str(tmp_path))
    assert not fresh.models_loaded()


def test_the_service_answers_503_without_models():
    pytest.importorskip("fastapi")
    import asyncio

    import main
    response = asyncio.run(main.models_unavailable(None, predict.ModelsUnavailable("no model card")))
    assert response.status_code == 503
    assert json.loads(response.body) == {"error": "models unavailable", "detail": "no model card"}


# --- the trainer, on a frame shaped like the real one -----------------------

def _frame(n_people=12, nights=20, seed=0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for p in range(n_people):
        for d in range(nights):
            rows.append({
                "participant_id": f"p{p}", "date": f"2021-06-{d + 1:02d}", "dataset": "lifesnaps",
                "chronotype_code": p % 3, "bedtime_hour": 23 + rng.normal(0, 0.7), "exercise_minutes": rng.integers(0, 90),
                "resting_hr": 60 + p, "steps": rng.integers(2000, 15000), "sleep_consistency": 50 + rng.normal(0, 10),
                "sleep_debt_hours": rng.normal(1, 1), "stress_level": 40 if d % 2 else np.nan,
                "sleep_duration_hours": 7 + rng.normal(0, 1), "time_in_bed_hours": 8.0,
                "wake_time_hour": 7.5 + rng.normal(0, 0.5), "age_band": "<30" if p % 2 else ">=30",
                "wake_success": float(rng.random() < 0.75),
            })
    return pd.DataFrame(rows)


def test_the_trainer_uses_the_studys_features_and_refuses_leakage():
    df = _frame()
    feats = train_shipped.shipped_features(df)
    assert "stress_level" not in feats, "half covered here; the study drops it whatever its coverage"
    assert not set(feats) & set(schema.OUTCOME_COLUMNS)
    with pytest.raises(train_real.LeakageError):
        train_real.assert_no_leakage(feats + ["time_in_bed_hours"])


def test_thresholds_are_the_top_quartile_each_way():
    p = np.linspace(0.0, 1.0, 101)
    t = train_shipped.thresholds(p)
    assert t["offScheduleAlert"] == pytest.approx(0.75)
    assert t["regularHigh"] == pytest.approx(0.75)
    skewed = train_shipped.thresholds(np.full(100, 0.6))
    assert (skewed["offScheduleAlert"], skewed["regularHigh"]) == (0.4, 0.6)


def test_the_cohort_limit_is_counted_not_described():
    text = train_shipped._cohort_limit(_frame())
    assert text.startswith("12 people with a Fitbit Sense (6 under 30, 6 aged 30 or over), June 2021 to June 2021")


def test_the_final_fit_is_the_studys_forest_on_every_usable_night():
    df = _frame()
    feats = train_shipped.shipped_features(df)
    fitted = train_shipped.fit_final(df, feats)
    assert fitted["regressor"].get_params()["n_estimators"] == train_real.FOREST["n_estimators"]
    assert fitted["regressor"].get_params()["max_depth"] == train_real.FOREST["max_depth"]
    assert fitted["classifier"].get_params()["class_weight"] == "balanced"
    assert len(fitted["regRows"]) == len(df.dropna(subset=feats + [train_real.TARGET]))
