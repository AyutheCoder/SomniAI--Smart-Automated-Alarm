"""Tests for the PMData loader, against a synthetic fixture.

A fixture rather than the real download, so the suite runs anywhere. Counts
against the real 1.4 GB release are asserted separately in
`test_real_datasets.py`, which skips when the data is absent.
"""

from __future__ import annotations

import json
import os

import pytest

from datasets import pmdata, schema


def write_participant(root: str, pid: str, *, nights: int = 6,
                      with_wellness: bool = True, extra_sleep=None) -> None:
    base = os.path.join(root, pid)
    fitbit, pmsys = os.path.join(base, "fitbit"), os.path.join(base, "pmsys")
    os.makedirs(fitbit, exist_ok=True)
    os.makedirs(pmsys, exist_ok=True)

    sleep, steps, very, moderate, rhr, wellness = [], [], [], [], [], []
    for i in range(nights):
        day = f"2019-11-{i + 1:02d}"
        nxt = f"2019-11-{i + 2:02d}"
        sleep.append({
            "logId": 1000 + i, "dateOfSleep": nxt,
            "startTime": f"{day}T23:30:00.000", "endTime": f"{nxt}T07:00:00.000",
            "minutesAsleep": 420, "minutesAwake": 30, "timeInBed": 450,
            "minutesToFallAsleep": 5, "efficiency": 93, "mainSleep": True,
        })
        # steps.json is minute-level in the real release; two rows per day here.
        steps += [{"dateTime": f"{nxt} 08:00:00", "value": "3000"},
                  {"dateTime": f"{nxt} 18:00:00", "value": "4000"}]
        very.append({"dateTime": f"{nxt} 00:00:00", "value": "20"})
        moderate.append({"dateTime": f"{nxt} 00:00:00", "value": "10"})
        rhr.append({"dateTime": f"{nxt} 00:00:00",
                    "value": {"date": nxt, "value": 55.0 + i, "error": 6.0}})
        if with_wellness:
            wellness.append(f"{nxt}T08:00:00.000Z,2,3,5,7,3,2,[1],{(i % 5) + 1}")

    for extra in (extra_sleep or []):
        sleep.append(extra)

    json.dump(sleep, open(os.path.join(fitbit, "sleep.json"), "w"))
    json.dump(steps, open(os.path.join(fitbit, "steps.json"), "w"))
    json.dump(very, open(os.path.join(fitbit, "very_active_minutes.json"), "w"))
    json.dump(moderate, open(os.path.join(fitbit, "moderately_active_minutes.json"), "w"))
    json.dump(rhr, open(os.path.join(fitbit, "resting_heart_rate.json"), "w"))
    if with_wellness:
        header = ("effective_time_frame,fatigue,mood,readiness,sleep_duration_h,"
                  "sleep_quality,soreness,soreness_area,stress")
        open(os.path.join(pmsys, "wellness.csv"), "w").write(
            header + "\n" + "\n".join(wellness) + "\n")


@pytest.fixture
def root(tmp_path):
    r = str(tmp_path / "pmdata")
    write_participant(r, "p01")
    write_participant(r, "p02")
    return r


class TestStructure:
    def test_emits_the_canonical_schema(self, root):
        df = pmdata.load(root)
        assert list(df.columns) == schema.ALL_COLUMNS
        assert (df["dataset"] == "pmdata").all()

    def test_one_row_per_participant_night(self, root):
        df = pmdata.load(root)
        assert len(df) == 12
        assert df["participant_id"].nunique() == 2
        assert not df.duplicated(subset=["participant_id", "date"]).any()

    def test_namespaces_participant_ids(self, root):
        # Ids collide across datasets otherwise - both use p01-style names.
        assert set(pmdata.load(root)["participant_id"]) == {"pmdata:p01", "pmdata:p02"}

    def test_finds_participant_directories(self, root):
        assert pmdata.participant_dirs(root) == ["p01", "p02"]

    def test_missing_root_is_empty_not_an_error(self, tmp_path):
        assert pmdata.load(str(tmp_path / "nope")).empty


class TestFields:
    def test_encodes_bedtime_on_the_night_axis(self, root):
        assert pmdata.load(root)["bedtime_hour"].unique().tolist() == [23.5]

    def test_reads_wake_time_as_a_plain_hour(self, root):
        assert pmdata.load(root)["wake_time_hour"].unique().tolist() == [7.0]

    def test_converts_sleep_minutes_to_hours(self, root):
        df = pmdata.load(root)
        assert df["sleep_duration_hours"].unique().tolist() == [7.0]
        assert df["time_in_bed_hours"].unique().tolist() == [7.5]

    def test_sums_minute_level_steps_to_a_daily_total(self, root):
        assert pmdata.load(root)["steps"].unique().tolist() == [7000.0]

    def test_unwraps_the_nested_resting_heart_rate(self, root):
        assert pmdata.load(root)["resting_hr"].min() == pytest.approx(55.0)

    def test_exercise_is_vigorous_plus_moderate_only(self, root):
        # Lightly-active minutes are incidental movement, not exercise.
        assert pmdata.load(root)["exercise_minutes"].unique().tolist() == [30.0]

    def test_rescales_self_reported_stress_to_the_schema_range(self, root):
        stress = pmdata.load(root)["stress_level"].dropna()
        assert stress.min() == pytest.approx(0.0)     # raw 1
        assert stress.max() == pytest.approx(100.0)   # raw 5
        assert stress.between(0, 100).all()


class TestEdgeCases:
    def test_ignores_naps(self, tmp_path):
        # Dated clear of the main-sleep nights, so the mainSleep filter is what
        # removes it rather than the one-row-per-night rule.
        nap = {"logId": 99, "dateOfSleep": "2019-11-20",
               "startTime": "2019-11-20T14:00:00.000", "endTime": "2019-11-20T15:00:00.000",
               "minutesAsleep": 55, "timeInBed": 60, "minutesToFallAsleep": 2,
               "efficiency": 90, "mainSleep": False}
        r = str(tmp_path / "pm")
        write_participant(r, "p01", nights=4, extra_sleep=[nap])
        assert len(pmdata.load(r)) == 4
        assert len(pmdata.load(r, main_sleep_only=False)) == 5

    def test_keeps_the_longest_episode_when_a_night_has_several(self, tmp_path):
        dup = {"logId": 98, "dateOfSleep": "2019-11-02",
               "startTime": "2019-11-01T22:00:00.000", "endTime": "2019-11-02T01:00:00.000",
               "minutesAsleep": 120, "timeInBed": 180, "minutesToFallAsleep": 5,
               "efficiency": 70, "mainSleep": True}
        r = str(tmp_path / "pm")
        write_participant(r, "p01", nights=3, extra_sleep=[dup])
        df = pmdata.load(r)
        assert len(df) == 3
        assert df.loc[df["date"].astype(str) == "2019-11-02", "sleep_duration_hours"].iloc[0] == 7.0

    def test_drops_zero_resting_heart_rate(self, tmp_path):
        # Fitbit writes 0.0 on days it could not compute one; it is not a reading.
        r = str(tmp_path / "pm")
        write_participant(r, "p01", nights=3)
        path = os.path.join(r, "p01", "fitbit", "resting_heart_rate.json")
        recs = json.load(open(path))
        recs[0]["value"]["value"] = 0.0
        json.dump(recs, open(path, "w"))
        assert pmdata.load(r)["resting_hr"].notna().sum() == 2

    def test_survives_a_participant_with_no_self_report(self, tmp_path):
        r = str(tmp_path / "pm")
        write_participant(r, "p01", nights=4, with_wellness=False)
        df = pmdata.load(r)
        assert len(df) == 4
        assert df["stress_level"].isna().all()


class TestAvailability:
    def test_structurally_absent_features_are_present_but_empty(self, root):
        df = pmdata.load(root)
        for col in schema.EXPECTED_MISSING["pmdata"]:
            assert col in df.columns, col
            assert df[col].isna().all(), col

    def test_expected_features_are_populated(self, root):
        df = pmdata.load(root)
        for col in schema.EXPECTED_AVAILABLE["pmdata"]:
            assert df[col].notna().any(), col

    def test_reports_completeness_per_column(self, root):
        report = schema.completeness(pmdata.load(root))
        row = report.set_index("column").loc["bedtime_hour"]
        assert row["non_null"] == 12
        assert row["coverage_pct"] == 100.0
        assert report.set_index("column").loc["caffeine_mg", "non_null"] == 0

    def test_counts_complete_cases_over_available_features_only(self, root):
        df = pmdata.load(root)
        # Never all 15 - six are structurally absent - but non-zero over the
        # features PMData can actually supply.
        assert schema.complete_case_count(df, schema.FEATURE_COLUMNS) == 0
        assert schema.complete_case_count(df) > 0
