"""Load LifeSnaps into the canonical person-night schema.

LifeSnaps (Zenodo 7229547) is 71 participants over ~4 months of Fitbit Sense
wear. Its data is split awkwardly for this project:

  * `csv_rais_anonymized/daily_fitbit_sema_df_unprocessed.csv` has demographics,
    resting HR, steps, activity minutes and Fitbit's stress score - but **no
    sleep timing at all**.
  * `mongo_rais_anonymized/fitbit.bson` has the sleep records, including the
    `startTime` the whole inverse planner is built around.

So both must be read and joined on (participant, date). The BSON is 9.7 GB, of
which ~4,141 documents are sleep, hence the streaming byte-level filter.

Coverage is uneven and that is expected: sleep appears on roughly half the
person-days, resting HR on ~60%, stress on ~25%. Call `schema.completeness()`
on the result before making any claim about sample size.
"""

from __future__ import annotations

import os
import zipfile
from typing import BinaryIO

import pandas as pd

from . import bson_stream, derive, schema

DATASET = "lifesnaps"

DAILY_CSV_MEMBER = "rais_anonymized/csv_rais_anonymized/daily_fitbit_sema_df_unprocessed.csv"
FITBIT_BSON_MEMBER = "rais_anonymized/mongo_rais_anonymized/fitbit.bson"

# Fitbit's Stress Management Score runs 1..100 where *higher means less
# stressed* - the opposite of feature_spec's stress_level. Inverted on load;
# forgetting this would flip the sign of every stress effect in the paper.
_STRESS_IS_INVERTED = True


def _sleep_frame(stream: BinaryIO, main_sleep_only: bool = True) -> pd.DataFrame:
    """Stream sleep documents out of fitbit.bson."""
    rows = []
    for doc in bson_stream.iter_documents(stream, where=lambda raw: b"dateOfSleep" in raw):
        if doc.get("type") != "sleep":
            continue
        data = doc.get("data") or {}
        try:
            if main_sleep_only and not data.get("mainSleep", False):
                continue
            start = pd.to_datetime(data["startTime"])
            end = pd.to_datetime(data["endTime"])
            rows.append({
                "participant_id": f"{DATASET}:{doc.get('id')}",
                "date": pd.to_datetime(data["dateOfSleep"]).date(),
                "bedtime_hour": derive.night_anchored_hour(start),
                "wake_time_hour": derive.wake_hour(end),
                "sleep_duration_hours": float(data["minutesAsleep"]) / 60.0,
                "time_in_bed_hours": float(data["timeInBed"]) / 60.0,
                "sleep_efficiency": float(data.get("efficiency", float("nan"))),
                "minutes_to_fall_asleep": float(data.get("minutesToFallAsleep", float("nan"))),
            })
        except (KeyError, TypeError, ValueError):
            continue
    if not rows:
        return pd.DataFrame(columns=["participant_id", "date"])
    df = pd.DataFrame(rows).sort_values("sleep_duration_hours", ascending=False)
    return df.drop_duplicates(subset=["participant_id", "date"], keep="first")


def _daily_frame(source) -> pd.DataFrame:
    """Covariates from the curated daily CSV."""
    df = pd.read_csv(source, low_memory=False)
    out = pd.DataFrame({
        "participant_id": DATASET + ":" + df["id"].astype(str),
        "date": pd.to_datetime(df["date"], errors="coerce").dt.date,
    })
    for src, dst in (("resting_hr", "resting_hr"), ("steps", "steps")):
        out[dst] = pd.to_numeric(df.get(src), errors="coerce")

    # LifeSnaps releases age de-identified as "<30" / ">=30", not as a number.
    # feature_spec wants a continuous 16..70 value, and picking a midpoint would
    # invent precision that was never collected - so the model input stays empty
    # and the band is carried separately for the cohort table.
    out["age"] = float("nan")
    out["age_band"] = df.get("age")
    out["gender"] = df.get("gender")

    # SEMA mood label, carried only to validate the wake-success proxy.
    out["self_report_tired"] = pd.to_numeric(df.get("TIRED"), errors="coerce")

    very = pd.to_numeric(df.get("very_active_minutes"), errors="coerce")
    moderate = pd.to_numeric(df.get("moderately_active_minutes"), errors="coerce")
    out["exercise_minutes"] = very.fillna(0) + moderate.fillna(0)
    out.loc[very.isna() & moderate.isna(), "exercise_minutes"] = float("nan")

    stress = pd.to_numeric(df.get("stress_score"), errors="coerce")
    out["stress_level"] = (100.0 - stress) if _STRESS_IS_INVERTED else stress

    return (out.dropna(subset=["date"])
              .sort_values("participant_id")
              .drop_duplicates(subset=["participant_id", "date"], keep="first"))


def load(
    zip_path: str | None = None,
    daily_csv: str | None = None,
    bson_path: str | None = None,
    main_sleep_only: bool = True,
    window: int = derive.DEFAULT_WINDOW,
    need_hours: float = derive.DEFAULT_SLEEP_NEED_H,
) -> pd.DataFrame:
    """Load LifeSnaps, either straight from the release zip or from loose files.

    Reading from the zip avoids materialising 9.7 GB of BSON on disk.
    """
    if zip_path:
        with zipfile.ZipFile(zip_path) as zf:
            with zf.open(DAILY_CSV_MEMBER) as fh:
                daily = _daily_frame(fh)
            with zf.open(FITBIT_BSON_MEMBER) as fh:
                sleep = _sleep_frame(fh, main_sleep_only=main_sleep_only)
    else:
        if not (daily_csv and bson_path):
            raise ValueError("provide zip_path, or both daily_csv and bson_path")
        daily = _daily_frame(daily_csv)
        with open(bson_path, "rb") as fh:
            sleep = _sleep_frame(fh, main_sleep_only=main_sleep_only)

    if sleep.empty:
        return schema.conform(schema.empty_frame(), DATASET)

    # Left join on sleep: a night with no sleep record is not a person-night for
    # our purposes, however many covariates that day happens to carry.
    df = sleep.merge(daily, on=["participant_id", "date"], how="left")
    df = derive.add_habit_features(df, window=window, need_hours=need_hours)
    return schema.conform(df, DATASET)


def default_zip_path() -> str | None:
    """Look for the release zip in the usual places; None if absent."""
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for candidate in (
        os.path.join(here, "data", "raw", "lifesnaps.zip"),
        os.path.join(here, "..", "data", "lifesnaps.zip"),
    ):
        if os.path.exists(candidate):
            return os.path.abspath(candidate)
    return None
