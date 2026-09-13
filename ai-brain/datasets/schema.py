"""Canonical output schema for every real-world dataset loader.

Each loader emits one row per person-night with the same columns, so downstream
training code never has to know which dataset it is looking at. Features that a
dataset cannot supply are present but all-NaN rather than absent - dropping the
column would silently change the model's input width between datasets.

The availability tables below encode the findings in
`docs/feature-mapping-lifesnaps-pmdata.md`. They are the machine-readable
version of that document, and the loaders' own tests assert against them.
"""

from __future__ import annotations

import pandas as pd

# The 15 model inputs, in `feature_spec.FEATURE_NAMES` order.
FEATURE_COLUMNS: list[str] = [
    "age",
    "chronotype_code",
    "bedtime_hour",
    "screen_minutes_before_bed",
    "caffeine_mg",
    "exercise_minutes",
    "stress_level",
    "ambient_noise_db",
    "room_temp_c",
    "resting_hr",
    "steps",
    "snooze_count",
    "alarm_response_ms",
    "sleep_consistency",
    "sleep_debt_hours",
]

# Measured outcomes. `sleep_duration_hours` is the sleep-duration model's target;
# `wake_time_hour` anchors the wake-success proxy built in the next step.
OUTCOME_COLUMNS: list[str] = [
    "sleep_duration_hours",
    "time_in_bed_hours",
    "sleep_efficiency",
    "minutes_to_fall_asleep",
    "wake_time_hour",
]

ID_COLUMNS: list[str] = ["participant_id", "date", "dataset"]

# Cohort descriptors: not model inputs, but needed for the participants table in
# any write-up. `age_band` exists because LifeSnaps de-identifies age to "<30" /
# ">=30" rather than releasing a number - see EXPECTED_MISSING below.
#
# The `self_report_*` columns are never model inputs. They exist to validate the
# constructed wake-success proxy against something the participant said
# independently - the only real evidence that the label tracks anything.
AUXILIARY_COLUMNS: list[str] = [
    "age_band", "gender",
    "self_report_sleep_quality", "self_report_readiness", "self_report_tired",
]

ALL_COLUMNS: list[str] = ID_COLUMNS + FEATURE_COLUMNS + OUTCOME_COLUMNS + AUXILIARY_COLUMNS

# Features no wearable dataset records, because no consumer device instruments
# the alarm itself. Kept explicit so the gap is visible in code, not just prose.
UNAVAILABLE_EVERYWHERE: set[str] = {
    "screen_minutes_before_bed",
    "caffeine_mg",
    "ambient_noise_db",
    "room_temp_c",
    "snooze_count",
    "alarm_response_ms",
}

# What each dataset can actually populate.
EXPECTED_AVAILABLE: dict[str, set[str]] = {
    "pmdata": {
        "chronotype_code", "bedtime_hour", "exercise_minutes", "stress_level",
        "resting_hr", "steps", "sleep_consistency", "sleep_debt_hours",
    },
    "lifesnaps": {
        "chronotype_code", "bedtime_hour", "exercise_minutes",
        "stress_level", "resting_hr", "steps", "sleep_consistency",
        "sleep_debt_hours",
    },
}

# Neither dataset yields a usable numeric age. PMData ships no demographics file
# at all; LifeSnaps de-identifies age to a binary band ("<30" / ">=30"), which
# cannot honestly stand in for feature_spec's continuous 16..70 input. The band
# is preserved in `age_band` for the cohort description instead of being
# imputed to a midpoint that was never measured.
EXPECTED_MISSING: dict[str, set[str]] = {
    "pmdata": UNAVAILABLE_EVERYWHERE | {"age"},
    "lifesnaps": UNAVAILABLE_EVERYWHERE | {"age"},
}


def empty_frame() -> pd.DataFrame:
    """An empty frame carrying the full schema, for loaders to build onto."""
    return pd.DataFrame({c: pd.Series(dtype="object") for c in ALL_COLUMNS})


def conform(df: pd.DataFrame, dataset: str) -> pd.DataFrame:
    """Add any missing schema columns as NaN and order them canonically."""
    out = df.copy()
    out["dataset"] = dataset
    for col in ALL_COLUMNS:
        if col not in out.columns:
            out[col] = float("nan")
    return out[ALL_COLUMNS]


def completeness(df: pd.DataFrame) -> pd.DataFrame:
    """Per-column non-null counts and coverage.

    LifeSnaps in particular is sparse - sleep on ~48% of person-days, resting HR
    ~60%, stress ~25% - so any sample-size claim has to be made against this
    rather than against `len(df)`.
    """
    rows = []
    for col in FEATURE_COLUMNS + OUTCOME_COLUMNS:
        n = int(df[col].notna().sum()) if col in df.columns else 0
        rows.append({
            "column": col,
            "non_null": n,
            "coverage_pct": round(100.0 * n / len(df), 1) if len(df) else 0.0,
        })
    return pd.DataFrame(rows)


def complete_case_count(df: pd.DataFrame, columns: list[str] | None = None) -> int:
    """Rows with every requested column present.

    Defaults to the features a dataset can actually supply, since counting
    complete cases over structurally-absent columns would always return zero.
    """
    if columns is None:
        dataset = df["dataset"].iloc[0] if len(df) else ""
        columns = sorted(EXPECTED_AVAILABLE.get(dataset, set(FEATURE_COLUMNS)))
    present = [c for c in columns if c in df.columns]
    return int(df[present].notna().all(axis=1).sum()) if present else 0
