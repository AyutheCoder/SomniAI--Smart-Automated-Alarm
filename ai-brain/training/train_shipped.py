"""Train the models the app ships, on real data, through the paper's pipeline.

    SOMNIAI_DATA_DIR=<dir holding lifesnaps.zip> python training/train_shipped.py

Prompt 5.2. Until now the AI Brain served forests trained on the synthetic panel
(`training/model_training.py`). This replaces them with forests trained on the
LifeSnaps cohort, built exactly as the paper's study builds its real-data models
(`evaluation/run_study.py`, step "real data"):

* the cohort from `datasets.cache.lifesnaps_cached`, labelled by
  `datasets.wake_proxy.wake_success` (wake-time regularity: not late against the
  person's own habit), unchanged;
* the features the cohort populates (`train_real.available_features`) minus
  `stress_level`, as the study does, checked by `train_real.assert_no_leakage`;
* the forest (`train_real.FOREST`), the grouped split and the repeated
  evaluation over eight seeds (`train_real.repeated_evaluation`,
  `repeated_classification`), unchanged.

So the held-out metrics in the model card are the paper's, recomputed, not new
claims. The wake-time regularity classifier is the study's *calibrated* one
(its "real data: calibration" step: the same forest without class weights,
expected calibration error 0.0148), not the class-balanced one behind the
paper's AUC headline: the app shows its probability as a number, and the
balanced weighting pulls probabilities down (a mean of 0.59 against 75% of
nights regular). Fixed in prompt 5.3; 5.2 shipped the balanced one. Nothing in the research pipeline is changed or monkeypatched; this file
only calls it. The shipped forests are then fitted on every usable night, with
the same settings.

**LifeSnaps only.** PMData is CC BY-NC 4.0 (non-commercial); LifeSnaps is
CC BY 4.0. Shipping a model trained on PMData could carry the non-commercial
term into the app, so the shipped models use LifeSnaps alone (the tester's
decision, 2026-11-15). PMData stays where it was: in the paper's replication.

Writes `models/real/` (the two forests, compressed, and `model_card.json`) and
`MODEL_CARD.md` next to this service.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from datasets import schema  # noqa: E402
from evaluation import statistics  # noqa: E402
from feature_spec import FEATURE_NAMES  # noqa: E402
from training import train_real  # noqa: E402

OUT_DIR = os.path.join(HERE, "models", "real")
CARD_MD = os.path.join(HERE, "MODEL_CARD.md")
SEEDS = tuple(range(8))
LABEL = "wake_success"
CARD_VERSION = 1

LIFESNAPS = {
    "name": "LifeSnaps",
    "citation": "Yfantidou et al., LifeSnaps, a 4-month multi-modal dataset capturing unobtrusive snapshots "
                "of our lives in the wild. Scientific Data 9:663, 2022.",
    "source": "https://zenodo.org/records/7229547",
    "licence": "CC BY 4.0",
    "device": "Fitbit Sense",
}
PMDATA_NOT_USED = (
    "PMData (CC BY-NC 4.0, non-commercial) is not in the shipped models, so the app carries no "
    "non-commercial term. The paper's replication on PMData is unchanged."
)


def load_lifesnaps(data_dir: str) -> pd.DataFrame:
    """The cohort and its label, as the study builds them."""
    from datasets import cache, wake_proxy
    return wake_proxy.wake_success(cache.lifesnaps_cached(os.path.join(data_dir, "lifesnaps.zip")))


def shipped_features(df: pd.DataFrame) -> list[str]:
    """The study's real-data features: what the cohort populates, minus stress_level."""
    feats = [c for c in train_real.available_features(df) if c != "stress_level"]
    train_real.assert_no_leakage(feats)
    return feats


WHY_NOT_USED = {
    "age": "LifeSnaps gives age only as a band (under or over 30), not a number",
    "stress_level": "LifeSnaps has it for only 53% of nights; the study leaves it out rather than lose half the "
                    "participants (docs/sleep-duration-results.md)",
}


def inputs_not_used(feats: list[str]) -> list[dict]:
    """Each input the app has that the shipped models don't use, and why."""
    out = []
    for f in FEATURE_NAMES:
        if f in feats:
            continue
        why = WHY_NOT_USED.get(f) or ("no public wearable dataset records it" if f in schema.UNAVAILABLE_EVERYWHERE
                                      else "the cohort doesn't populate it")
        out.append({"feature": f, "why": why})
    return out


def between_and_within(residuals: pd.Series, people: pd.Series, within_var: pd.Series | None = None) -> dict:
    """How much people differ from the population model, and how much nights differ within a person.

    Method of moments on held-out residuals: the variance of each person's mean
    residual includes sampling noise (within-variance / nights), which is taken
    off, leaving the between-person variance. `within_var`, if given, is the
    model-implied per-night variance (p(1-p) for a probability); otherwise the
    pooled within-person variance of the residuals is used.
    """
    frame = pd.DataFrame({"e": residuals.to_numpy(), "person": people.to_numpy()})
    if within_var is not None:
        frame["v"] = within_var.to_numpy()
    by = frame.groupby("person")
    n = by["e"].count()
    means = by["e"].mean()
    if within_var is None:
        centred = frame["e"] - by["e"].transform("mean")
        dof = float((n - 1).clip(lower=0).sum())
        sigma2 = float((centred ** 2).sum() / dof)
        noise = (sigma2 / n).mean()
    else:
        sigma2 = float(frame["v"].mean())
        noise = (by["v"].mean() / n).mean()
    tau2 = max(float(means.var(ddof=1) - noise), 1e-6)
    return {"within_var": sigma2, "between_var": tau2, "people": int(len(n))}


def personalisation_priors(df: pd.DataFrame, feats: list[str], seeds=SEEDS) -> dict:
    """What a person's own nights are weighed against (prompt 5.3), from held-out people.

    Sleep duration: a person's offset from the population model is taken as
    normal with sd `betweenSd`; a night scatters around the person's level with
    sd `withinSd`. Their own nights count as much as the population once there
    are `nightsForHalfWeight` = within/between variance of them.

    Wake-time regularity: a person's rate of regular nights is taken as Beta
    around the population model's, with `priorStrength` pseudo-nights; their
    nights count as much once there are that many.

    Averaged over the same participant splits as the metrics, so each figure
    describes people the model never saw.
    """
    sleep, reg = [], []
    reg_rows = df.dropna(subset=feats + [train_real.TARGET]).reset_index(drop=True)
    cls_rows = df.dropna(subset=feats + [LABEL]).reset_index(drop=True)
    for seed in seeds:
        model = train_real.train_sleep_duration(df, features=feats, seed=seed)["model"]
        _, test = train_real.grouped_split(reg_rows, seed=seed)
        sleep.append(between_and_within(test[train_real.TARGET] - model.predict(test[feats]), test["participant_id"]))
        ctrain, ctest = train_real.grouped_split(cls_rows, seed=seed)
        clf = calibrated_classifier(seed).fit(ctrain[feats], ctrain[LABEL].astype(int))
        p = pd.Series(clf.predict_proba(ctest[feats])[:, list(clf.classes_).index(1)], index=ctest.index)
        stats = between_and_within(ctest[LABEL].astype(float) - p, ctest["participant_id"], within_var=p * (1 - p))
        stats["mean_p"] = float(p.mean())
        reg.append(stats)
    within = float(np.mean([x["within_var"] for x in sleep]))
    between = float(np.mean([x["between_var"] for x in sleep]))
    mean_p = float(np.mean([x["mean_p"] for x in reg]))
    between_p = float(np.mean([x["between_var"] for x in reg]))
    strength = max(mean_p * (1 - mean_p) / between_p - 1.0, 1.0)
    return {
        "sleep_duration": {
            "withinSd": round(within ** 0.5, 4),
            "betweenSd": round(between ** 0.5, 4),
            "nightsForHalfWeight": round(within / between, 2),
        },
        "wake_regularity": {
            "betweenSd": round(between_p ** 0.5, 4),
            "meanProbability": round(mean_p, 4),
            "priorStrength": round(strength, 2),
        },
        "minimumNights": 7,
        "from": f"held-out participants over {len(seeds)} splits: the variance of each person's mean residual, less its "
                "sampling noise, is the between-person variance",
    }


def calibrated_classifier(seed: int) -> RandomForestClassifier:
    """The study's calibrated regularity classifier: the forest without class weights (run_study.py, calibration)."""
    return RandomForestClassifier(**{**train_real.FOREST, "random_state": seed})


def calibrated_splits(df: pd.DataFrame, feats: list[str], seeds=SEEDS):
    """(held-out frame, its probabilities, the train frame) per grouped split, as run_study.py makes them."""
    work = df.dropna(subset=feats + [LABEL]).reset_index(drop=True)
    for seed in seeds:
        train, test = train_real.grouped_split(work, seed=seed)
        model = calibrated_classifier(seed).fit(train[feats], train[LABEL].astype(int))
        yield test, model.predict_proba(test[feats])[:, list(model.classes_).index(1)], train


def held_out_probabilities(df: pd.DataFrame, feats: list[str], seeds=SEEDS) -> np.ndarray:
    """The shipped classifier's probabilities on held-out participants, over the same splits as the metrics."""
    return np.concatenate([p for _, p, _ in calibrated_splits(df, feats, seeds)])


def thresholds(probabilities: np.ndarray) -> dict:
    """The app's two wording thresholds, as recommend.py set them before: the top quartile each way.

    `offScheduleAlert` is the 75th percentile of P(off schedule); `regularHigh` the
    75th percentile of P(regular). From held-out predictions, so they describe the
    scores the shipped model produces for people it hasn't seen.
    """
    p = np.asarray(probabilities, dtype=float)
    return {
        "offScheduleAlert": round(float(np.quantile(1.0 - p, 0.75)), 3),
        "regularHigh": round(float(np.quantile(p, 0.75)), 3),
        "from": "75th percentiles of held-out predictions over the evaluation splits",
    }


def _cohort_limit(df: pd.DataFrame) -> str:
    """Who the models learned from, counted from the data rather than described."""
    people = df.groupby("participant_id").agg(age=("age_band", "first"))
    bands = people["age"].value_counts()
    unknown = int(people["age"].isna().sum())
    dates = pd.to_datetime(df["date"])
    return (f"{len(people)} people with a {LIFESNAPS['device']} ({int(bands.get('<30', 0))} under 30, "
            f"{int(bands.get('>=30', 0))} aged 30 or over" + (f", {unknown} not given" if unknown else "")
            + f"), {dates.min():%B %Y} to {dates.max():%B %Y}: it may not describe you.")


def _label_text() -> str:
    from datasets import wake_proxy
    return (f"a night counts as regular unless the wake was more than {wake_proxy.DEFAULT_TOLERANCE_MIN:.0f} minutes later "
            f"than the person's own habit (the median of their last {wake_proxy.DEFAULT_WINDOW} nights of the same kind, "
            "weekday or weekend; datasets/wake_proxy.py). It says nothing about how the morning went")


def _summary(frame: pd.DataFrame, column: str) -> dict:
    return statistics.across_splits(frame[column], column)


def evaluate_calibrated(df: pd.DataFrame, feats: list[str], seeds=SEEDS) -> dict:
    """The shipped classifier on held-out people: discrimination over the splits, calibration as the paper measures it."""
    from sklearn.metrics import accuracy_score, balanced_accuracy_score, roc_auc_score

    from evaluation import planner_eval
    rows = []
    for test, p, train in calibrated_splits(df, feats, seeds):
        y = test[LABEL].astype(int)
        pred = (p >= 0.5).astype(int)
        majority = int(train[LABEL].astype(int).mode().iloc[0])
        rows.append({"roc_auc": roc_auc_score(y, p), "balanced_accuracy": balanced_accuracy_score(y, pred),
                     "accuracy": accuracy_score(y, pred), "majority": accuracy_score(y, np.full(len(y), majority)),
                     "positive": float(y.mean())})
    frame = pd.DataFrame(rows)
    # Calibration over the study's own five splits (run_study.py), so it is the paper's figure.
    ys, ps = [], []
    for test, p, _ in calibrated_splits(df, feats, range(5)):
        ys.append(test[LABEL].astype(int).to_numpy())
        ps.append(p)
    calibration = planner_eval.calibration_error(np.concatenate(ys), np.concatenate(ps))
    return {
        "roc_auc": _summary(frame, "roc_auc"),
        "balanced_accuracy": _summary(frame, "balanced_accuracy"),
        "accuracy": _summary(frame, "accuracy"),
        "majorityBaselineAccuracy": round(float(frame["majority"].mean()), 4),
        "positiveRateTest": round(float(frame["positive"].mean()), 4),
        "calibration": calibration,
    }


def evaluate(df: pd.DataFrame, feats: list[str], seeds=SEEDS) -> dict:
    """The paper's repeated evaluation, summarised as the paper reports it."""
    reg = train_real.repeated_evaluation(df, features=feats, seeds=seeds)
    cls = train_real.repeated_classification(df, features=feats, seeds=seeds)
    return {
        "sleep_duration": {
            "mae": _summary(reg, "mae"),
            "rmse": _summary(reg, "rmse"),
            "r2": _summary(reg, "r2"),
            "baselineMeanMae": round(float(reg["baseline_train_mean_mae"].mean()), 4),
            "oraclePersonMeanMae": round(float(reg["oracle_person_mean_mae"].mean()), 4),
        },
        "wake_regularity": {
            **evaluate_calibrated(df, feats, seeds),
            # The paper's headline AUC, for its class-balanced variant (train_real.train_wake_regularity).
            "balancedVariantRocAuc": _summary(cls, "roc_auc"),
        },
    }


def fit_final(df: pd.DataFrame, feats: list[str]) -> dict:
    """The shipped forests: the study's settings, fitted on every usable night."""
    reg_rows = df.dropna(subset=feats + [train_real.TARGET])
    cls_rows = df.dropna(subset=feats + [LABEL])
    regressor = RandomForestRegressor(**train_real.FOREST).fit(reg_rows[feats], reg_rows[train_real.TARGET])
    classifier = calibrated_classifier(train_real.SEED).fit(cls_rows[feats], cls_rows[LABEL].astype(int))
    return {
        "regressor": regressor,
        "classifier": classifier,
        "regRows": reg_rows,
        "clsRows": cls_rows,
    }


def card(df: pd.DataFrame, feats: list[str], metrics: dict, fitted: dict, probs: np.ndarray, now: dt.datetime,
         priors: dict | None = None) -> dict:
    reg_rows, cls_rows = fitted["regRows"], fitted["clsRows"]
    medians = {f: round(float(reg_rows[f].median()), 4) for f in feats}

    def importances(model) -> dict:
        return {f: round(float(i), 4) for f, i in sorted(zip(feats, model.feature_importances_), key=lambda kv: -kv[1])}

    return {
        "cardVersion": CARD_VERSION,
        "trainedAt": now.isoformat(timespec="seconds"),
        "sklearnVersion": sklearn.__version__,
        "seed": train_real.SEED,
        "trainedOn": {**LIFESNAPS, "participants": int(df["participant_id"].nunique()), "nights": int(len(df))},
        "notUsed": PMDATA_NOT_USED,
        "pipeline": "training/train_shipped.py through datasets/ and training/train_real.py, as evaluation/run_study.py",
        "features": feats,
        "featureMedians": medians,
        "missingInputs": "An input the app doesn't send takes the training nights' median, so it neither helps nor hurts.",
        "inputsNotUsed": inputs_not_used(feats),
        "models": {
            "sleep_duration": {
                "file": "sleep_duration.joblib",
                "predicts": "Hours asleep tonight",
                "target": train_real.TARGET,
                "trainingNights": int(len(reg_rows)),
                "trainingParticipants": int(reg_rows["participant_id"].nunique()),
                "evaluation": metrics["sleep_duration"],
                "importances": importances(fitted["regressor"]),
            },
            "wake_regularity": {
                "file": "wake_regularity.joblib",
                "predicts": "Chance of waking close to your usual time (wake-time regularity)",
                "label": _label_text(),
                "trainingNights": int(len(cls_rows)),
                "trainingParticipants": int(cls_rows["participant_id"].nunique()),
                "evaluation": metrics["wake_regularity"],
                "importances": importances(fitted["classifier"]),
            },
        },
        "noLongerPredicted": {
            "wakeup_consistency": "No real-data target exists for it, so the synthetic model is gone; the app shows "
                                  "your measured sleep consistency instead.",
        },
        "thresholds": thresholds(probs),
        "personalisation": priors,
        "evaluationMethod": f"Grouped by participant: {len(SEEDS)} splits, 20% of people held out each time, never seen "
                            "in training. Means with a 95% interval over the splits.",
        "limits": [
            "Weak in absolute terms: modestly better than chance at regularity, and duration explains under a fifth of "
            "the variance.",
            _cohort_limit(df),
            "Nothing it predicts was ever about alarms: no public dataset records an alarm, a snooze or a wake check.",
            "Screen time, caffeine, room noise and temperature can't move these predictions: no dataset recorded them.",
        ],
    }


def _fmt(s: dict, digits: int = 3) -> str:
    if not s.get("usable"):
        return "n/a"
    return f"{s['mean']:.{digits}f} (95% interval {s['ci_low']:.{digits}f} to {s['ci_high']:.{digits}f}; splits {s['min']:.{digits}f} to {s['max']:.{digits}f})"


def card_markdown(c: dict) -> str:
    sd = c["models"]["sleep_duration"]
    wr = c["models"]["wake_regularity"]
    lines = [
        "# Model card: the AI Brain's shipped models",
        "",
        "Generated by `training/train_shipped.py` (prompt 5.2); do not edit by hand. The same facts are in",
        "`models/real/model_card.json`, which the service serves and the app shows.",
        "",
        "## Trained on",
        "",
        f"- **{c['trainedOn']['name']}**: {c['trainedOn']['participants']} participants, {c['trainedOn']['nights']} nights, "
        f"{c['trainedOn']['device']}. {c['trainedOn']['citation']} {c['trainedOn']['source']}, {c['trainedOn']['licence']}.",
        f"- {c['notUsed']}",
        f"- Pipeline: {c['pipeline']}. Seed {c['seed']}, scikit-learn {c['sklearnVersion']}, trained {c['trainedAt']}.",
        "",
        "Until prompt 5.2 the service shipped forests trained on a synthetic panel (6,878 simulated nights from 340",
        "simulated people). Their metrics (wake AUC 0.785 on simulated people) said nothing about real people and are",
        "no longer shown anywhere.",
        "",
        "## Inputs",
        "",
        "Used: " + ", ".join(f"`{f}`" for f in c["features"]) + ".",
        "",
        c["missingInputs"] + " Medians: " + ", ".join(f"`{f}` {v}" for f, v in c["featureMedians"].items()) + ".",
        "",
        "Not used, though the app has them:",
        "",
    ] + [f"- `{x['feature']}`: {x['why']}." for x in c["inputsNotUsed"]] + [
        "",
        "## How well they do, on people they never saw",
        "",
        c["evaluationMethod"],
        "",
        f"**Sleep duration** ({sd['trainingNights']} nights, {sd['trainingParticipants']} people):",
        "",
        f"- MAE {_fmt(sd['evaluation']['mae'])} hours; predicting everyone's average gives {sd['evaluation']['baselineMeanMae']:.3f}.",
        f"- R² {_fmt(sd['evaluation']['r2'])}.",
        "",
        f"**Wake-time regularity** ({wr['trainingNights']} nights, {wr['trainingParticipants']} people). {wr['label'][0].upper() + wr['label'][1:]}.",
        "",
        f"- AUC {_fmt(wr['evaluation']['roc_auc'])}; 0.5 is chance.",
        f"- Balanced accuracy {_fmt(wr['evaluation']['balanced_accuracy'])}; 0.5 is chance.",
        f"- Accuracy {_fmt(wr['evaluation']['accuracy'])}, against {wr['evaluation']['majorityBaselineAccuracy']:.3f} for always "
        f"guessing the commoner outcome ({wr['evaluation']['positiveRateTest']:.0%} of held-out nights were regular).",
        f"- Calibrated: expected calibration error {wr['evaluation']['calibration']['ece']:.4f}, Brier "
        f"{wr['evaluation']['calibration']['brier']:.4f}, over {wr['evaluation']['calibration']['n']} held-out nights; its "
        f"probabilities average {wr['evaluation']['calibration']['mean_prediction']:.3f} where "
        f"{wr['evaluation']['calibration']['base_rate']:.3f} of those nights were regular.",
        "",
        "This is the paper's calibrated classifier (no class weights), because the app shows its probability. The paper's "
        f"headline AUC, {_fmt(wr['evaluation']['balancedVariantRocAuc'])}, is for a class-balanced variant that ranks the "
        "same but pulls probabilities down; it was shipped in 5.2 and replaced in 5.3.",
        "",
        "These are the paper's numbers: the same cohort, features, forests and splits.",
        "",
        "## Thresholds the app words its advice by",
        "",
        f"Off-schedule warning above {c['thresholds']['offScheduleAlert']}; \"usually close to your usual time\" from "
        f"{c['thresholds']['regularHigh']} ({c['thresholds']['from']}).",
        "",
        "## Personalisation (prompt 5.3)",
        "",
        f"How much people differ from these models, measured on held-out people ({c['personalisation']['from']}):",
        "",
        f"- Sleep duration: a person's own level sits about {c['personalisation']['sleep_duration']['betweenSd']:.2f} h (sd) "
        f"from the model's; nights scatter about {c['personalisation']['sleep_duration']['withinSd']:.2f} h around it. A "
        f"person's own nights weigh as much as the population after {c['personalisation']['sleep_duration']['nightsForHalfWeight']} "
        "of them.",
        f"- Wake-time regularity: a person's rate of regular nights is worth {c['personalisation']['wake_regularity']['priorStrength']} "
        f"nights of evidence from the population (sd {c['personalisation']['wake_regularity']['betweenSd']:.3f} between people).",
        f"- The app personalises only from {c['personalisation']['minimumNights']} of a person's own nights, and only once they "
        "weigh at least as much as the population; before that it shows the population model and says so.",
        "",
        "## No longer predicted",
        "",
    ]
    lines += [f"- `{k}`: {v}" for k, v in c["noLongerPredicted"].items()]
    lines += ["", "## Limits", ""] + [f"- {x}" for x in c["limits"]] + [""]
    return "\n".join(lines)


def main(data_dir: str | None = None, out_dir: str = OUT_DIR, card_path: str = CARD_MD) -> dict:
    data_dir = data_dir or os.environ.get("SOMNIAI_DATA_DIR", "")
    if not data_dir or not os.path.exists(os.path.join(data_dir, "lifesnaps.zip")):
        raise SystemExit("set SOMNIAI_DATA_DIR to the folder holding lifesnaps.zip (see fetch_datasets.py)")
    df = load_lifesnaps(data_dir)
    feats = shipped_features(df)
    print(f"LifeSnaps: {len(df)} nights, {df.participant_id.nunique()} participants; features {feats}")
    metrics = evaluate(df, feats)
    probs = held_out_probabilities(df, feats)
    priors = personalisation_priors(df, feats)
    fitted = fit_final(df, feats)
    c = card(df, feats, metrics, fitted, probs, dt.datetime.now(dt.timezone.utc), priors)
    os.makedirs(out_dir, exist_ok=True)
    joblib.dump(fitted["regressor"], os.path.join(out_dir, "sleep_duration.joblib"), compress=3)
    joblib.dump(fitted["classifier"], os.path.join(out_dir, "wake_regularity.joblib"), compress=3)
    with open(os.path.join(out_dir, "model_card.json"), "w", encoding="utf-8") as fh:
        json.dump(c, fh, indent=2)
        fh.write("\n")
    with open(card_path, "w", encoding="utf-8") as fh:
        fh.write(card_markdown(c))
    print(json.dumps({k: c["models"][k]["evaluation"] for k in c["models"]}, indent=1))
    print("thresholds", c["thresholds"])
    print("personalisation", c["personalisation"])
    return c


if __name__ == "__main__":
    main()
