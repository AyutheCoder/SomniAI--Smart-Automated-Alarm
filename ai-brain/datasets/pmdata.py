"""Load PMData into the canonical person-night schema.

PMData (datasets.simula.no/pmdata) is 16 participants over 5 months of Fitbit
Versa 2 wear, plus a daily self-report app. It needs no BSON work: sleep timing
sits in plain JSON, and it carries a genuine daily self-reported stress score,
which LifeSnaps does not.

Layout per participant `pNN/`:
    fitbit/sleep.json                    one record per sleep episode
    fitbit/sleep_score.csv               per-episode Fitbit score + resting HR
    fitbit/steps.json                    minute-level, aggregated here to daily
    fitbit/{very,moderately}_active_minutes.json    daily totals
    fitbit/resting_heart_rate.json       daily, value nested one level deep
    pmsys/wellness.csv                   daily self-report incl. stress 1..5
"""

from __future__ import annotations

import json
import os

import pandas as pd

from . import derive, schema

DATASET = "pmdata"
# wellness.csv scores stress 1..5; feature_spec wants 0..100.
_STRESS_MIN, _STRESS_MAX = 1.0, 5.0


def _read_json(path: str):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _daily_value_series(path: str, name: str) -> pd.DataFrame:
    """Fitbit daily export: [{"dateTime": "...", "value": "72"}, ...]."""
    recs = _read_json(path)
    rows = []
    for r in recs:
        try:
            rows.append({
                "date": pd.to_datetime(r["dateTime"]).date(),
                name: float(r["value"]),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return pd.DataFrame(rows) if rows else pd.DataFrame(columns=["date", name])


def _resting_hr(path: str) -> pd.DataFrame:
    """Same shape, but `value` is a dict: {"date": .., "value": .., "error": ..}."""
    rows = []
    for r in _read_json(path):
        try:
            v = r["value"]
            hr = float(v["value"] if isinstance(v, dict) else v)
            # Fitbit emits 0.0 on days it could not compute a resting HR.
            if hr <= 0:
                continue
            rows.append({"date": pd.to_datetime(r["dateTime"]).date(), "resting_hr": hr})
        except (KeyError, TypeError, ValueError):
            continue
    return pd.DataFrame(rows) if rows else pd.DataFrame(columns=["date", "resting_hr"])


def _daily_steps(path: str) -> pd.DataFrame:
    """steps.json is minute-level; sum to a daily total."""
    recs = _read_json(path)
    if not recs:
        return pd.DataFrame(columns=["date", "steps"])
    df = pd.DataFrame(recs)
    df["date"] = pd.to_datetime(df["dateTime"]).dt.date
    df["steps"] = pd.to_numeric(df["value"], errors="coerce")
    return df.groupby("date", as_index=False)["steps"].sum()


def _wellness(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        return pd.DataFrame(columns=["date", "stress_level"])
    df = pd.read_csv(path)
    if "effective_time_frame" not in df.columns:
        return pd.DataFrame(columns=["date", "stress_level"])
    out = pd.DataFrame({"date": pd.to_datetime(df["effective_time_frame"]).dt.date})
    stress = pd.to_numeric(df.get("stress"), errors="coerce")
    # PMSys serves a 1..5 Likert item, but a handful of rows carry 0 (4 of 1,747
    # in the release). A 1..5 scale has no zero, so these are non-responses, not
    # a sixth level - blank them rather than letting them rescale to -25.
    stress = stress.where(stress.between(_STRESS_MIN, _STRESS_MAX))
    # 1..5 self-report -> 0..100, so it shares a scale with feature_spec.
    out["stress_level"] = (stress - _STRESS_MIN) / (_STRESS_MAX - _STRESS_MIN) * 100.0

    # Carried for validating the wake-success proxy, never as model inputs.
    # Same 0-means-unanswered convention as stress.
    quality = pd.to_numeric(df.get("sleep_quality"), errors="coerce")
    out["self_report_sleep_quality"] = quality.where(quality.between(1, 5))
    readiness = pd.to_numeric(df.get("readiness"), errors="coerce")
    out["self_report_readiness"] = readiness.where(readiness.between(1, 10))

    return out.dropna(subset=["date"]).drop_duplicates(subset=["date"], keep="first")


def _sleep_records(path: str, main_sleep_only: bool) -> pd.DataFrame:
    rows = []
    for r in _read_json(path):
        try:
            if main_sleep_only and not r.get("mainSleep", False):
                continue
            start = pd.to_datetime(r["startTime"])
            end = pd.to_datetime(r["endTime"])
            rows.append({
                "date": pd.to_datetime(r["dateOfSleep"]).date(),
                "bedtime_hour": derive.night_anchored_hour(start),
                "wake_time_hour": derive.wake_hour(end),
                "sleep_duration_hours": float(r["minutesAsleep"]) / 60.0,
                "time_in_bed_hours": float(r["timeInBed"]) / 60.0,
                "sleep_efficiency": float(r.get("efficiency", float("nan"))),
                "minutes_to_fall_asleep": float(r.get("minutesToFallAsleep", float("nan"))),
            })
        except (KeyError, TypeError, ValueError):
            continue
    if not rows:
        return pd.DataFrame(columns=["date"])
    # One night can carry several episodes even among mainSleep; keep the longest.
    df = pd.DataFrame(rows).sort_values("sleep_duration_hours", ascending=False)
    return df.drop_duplicates(subset=["date"], keep="first")


def participant_dirs(root: str) -> list[str]:
    """`pNN` directories, in order."""
    if not os.path.isdir(root):
        return []
    return sorted(
        d for d in os.listdir(root)
        if os.path.isdir(os.path.join(root, d)) and d.startswith("p") and d[1:].isdigit()
    )


def load_participant(root: str, pid: str, main_sleep_only: bool = True) -> pd.DataFrame:
    base = os.path.join(root, pid)
    fitbit, pmsys = os.path.join(base, "fitbit"), os.path.join(base, "pmsys")

    sleep = _sleep_records(os.path.join(fitbit, "sleep.json"), main_sleep_only)
    if sleep.empty:
        return pd.DataFrame(columns=schema.ALL_COLUMNS)

    df = sleep
    for frame in (
        _daily_steps(os.path.join(fitbit, "steps.json")),
        _resting_hr(os.path.join(fitbit, "resting_heart_rate.json")),
        _daily_value_series(os.path.join(fitbit, "very_active_minutes.json"), "very_active"),
        _daily_value_series(os.path.join(fitbit, "moderately_active_minutes.json"), "moderately_active"),
        _wellness(os.path.join(pmsys, "wellness.csv")),
    ):
        if not frame.empty:
            df = df.merge(frame, on="date", how="left")

    for col in ("very_active", "moderately_active"):
        if col not in df.columns:
            df[col] = float("nan")
    # Fitbit's own activity classification; deliberately excludes "lightly active",
    # which is mostly incidental movement rather than exercise.
    df["exercise_minutes"] = df["very_active"].fillna(0) + df["moderately_active"].fillna(0)
    df.loc[df["very_active"].isna() & df["moderately_active"].isna(), "exercise_minutes"] = float("nan")

    df["participant_id"] = f"{DATASET}:{pid}"
    return df.drop(columns=["very_active", "moderately_active"], errors="ignore")


def load(
    root: str,
    main_sleep_only: bool = True,
    window: int = derive.DEFAULT_WINDOW,
    need_hours: float = derive.DEFAULT_SLEEP_NEED_H,
) -> pd.DataFrame:
    """Load every participant under `root` into the canonical schema.

    `root` is the directory holding `p01/`, `p02/`, ...
    """
    frames = [
        load_participant(root, pid, main_sleep_only=main_sleep_only)
        for pid in participant_dirs(root)
    ]
    frames = [f for f in frames if not f.empty]
    if not frames:
        return schema.conform(schema.empty_frame(), DATASET)

    df = pd.concat(frames, ignore_index=True)
    df = derive.add_habit_features(df, window=window, need_hours=need_hours)
    return schema.conform(df, DATASET)
