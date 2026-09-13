"""Tests for the LifeSnaps loader, against a synthetic fixture.

LifeSnaps splits what this project needs across two files - covariates in a CSV,
sleep timing only in a BSON dump - so the join is the thing most likely to go
quietly wrong, and most of these tests are about it.
"""

from __future__ import annotations

import os

import pytest

from datasets import lifesnaps, schema

from .bson_fixtures import encode_stream, sleep_document

P1 = "621e2e8e67b776a24055b564"
P2 = "621e2e8e67b776a24055b999"


def write_fixture(tmp_path, *, nights: int = 6, extra_docs=None,
                  daily_rows=None, stress_score: float = 80.0):
    bson_path = str(tmp_path / "fitbit.bson")
    csv_path = str(tmp_path / "daily.csv")

    docs = []
    for pid in (P1, P2):
        for i in range(nights):
            day, nxt = f"2021-06-{i + 1:02d}", f"2021-06-{i + 2:02d}"
            docs.append(sleep_document(
                pid, nxt, f"{day}T23:30:00.000", f"{nxt}T07:00:00.000",
                minutes_asleep=420, time_in_bed=450))
    docs += (extra_docs or [])
    open(bson_path, "wb").write(encode_stream(docs))

    header = ("id,date,age,resting_hr,steps,stress_score,"
              "very_active_minutes,moderately_active_minutes\n")
    if daily_rows is None:
        daily_rows = []
        for pid in (P1, P2):
            for i in range(nights):
                nxt = f"2021-06-{i + 2:02d}"
                daily_rows.append(f"{pid},{nxt},>=30,58,9000,{stress_score},20,10")
    open(csv_path, "w").write(header + "\n".join(daily_rows) + "\n")
    return csv_path, bson_path


@pytest.fixture
def files(tmp_path):
    return write_fixture(tmp_path)


class TestStructure:
    def test_emits_the_canonical_schema(self, files):
        df = lifesnaps.load(daily_csv=files[0], bson_path=files[1])
        assert list(df.columns) == schema.ALL_COLUMNS
        assert (df["dataset"] == "lifesnaps").all()

    def test_one_row_per_participant_night(self, files):
        df = lifesnaps.load(daily_csv=files[0], bson_path=files[1])
        assert len(df) == 12
        assert df["participant_id"].nunique() == 2
        assert not df.duplicated(subset=["participant_id", "date"]).any()

    def test_namespaces_participant_ids(self, files):
        df = lifesnaps.load(daily_csv=files[0], bson_path=files[1])
        assert df["participant_id"].iloc[0].startswith("lifesnaps:")

    def test_requires_either_a_zip_or_both_loose_files(self, files):
        with pytest.raises(ValueError):
            lifesnaps.load(daily_csv=files[0])


class TestTheJoin:
    def test_sleep_drives_the_row_set(self, tmp_path):
        # Covariate days with no sleep record are not person-nights.
        csv_path, bson_path = write_fixture(tmp_path, nights=3)
        rows = open(csv_path).read().rstrip("\n").split("\n")
        rows.append(f"{P1},2021-06-20,>=30,58,9000,80,20,10")   # a day with no sleep
        open(csv_path, "w").write("\n".join(rows) + "\n")
        df = lifesnaps.load(daily_csv=csv_path, bson_path=bson_path)
        assert len(df) == 6
        assert "2021-06-20" not in df["date"].astype(str).tolist()

    def test_a_night_with_no_covariates_survives_with_nulls(self, tmp_path):
        csv_path, bson_path = write_fixture(tmp_path, nights=3, daily_rows=[])
        df = lifesnaps.load(daily_csv=csv_path, bson_path=bson_path)
        assert len(df) == 6
        assert df["bedtime_hour"].notna().all()
        assert df["resting_hr"].isna().all()

    def test_does_not_cross_participants(self, tmp_path):
        csv_path, bson_path = write_fixture(tmp_path, nights=3, daily_rows=[
            f"{P1},2021-06-02,>=30,58,9000,80,20,10",
        ])
        df = lifesnaps.load(daily_csv=csv_path, bson_path=bson_path)
        matched = df[df["resting_hr"].notna()]
        assert len(matched) == 1
        assert matched.iloc[0]["participant_id"] == f"lifesnaps:{P1}"


class TestFields:
    def test_encodes_bedtime_on_the_night_axis(self, files):
        df = lifesnaps.load(daily_csv=files[0], bson_path=files[1])
        assert df["bedtime_hour"].unique().tolist() == [23.5]

    def test_inverts_fitbit_stress_score(self, tmp_path):
        """Fitbit's score is 1..100 where *higher means less stressed*.

        feature_spec's stress_level runs the other way. Getting this backwards
        would silently flip the sign of every stress effect in the paper.
        """
        os.makedirs(tmp_path / "calm", exist_ok=True)
        os.makedirs(tmp_path / "tense", exist_ok=True)
        calm = write_fixture(tmp_path / "calm", stress_score=90.0)
        tense = write_fixture(tmp_path / "tense", stress_score=10.0)

        calm_level = lifesnaps.load(daily_csv=calm[0], bson_path=calm[1])["stress_level"].iloc[0]
        tense_level = lifesnaps.load(daily_csv=tense[0], bson_path=tense[1])["stress_level"].iloc[0]
        assert calm_level == pytest.approx(10.0)
        assert tense_level == pytest.approx(90.0)
        assert tense_level > calm_level

    def test_exercise_is_vigorous_plus_moderate(self, files):
        df = lifesnaps.load(daily_csv=files[0], bson_path=files[1])
        assert df["exercise_minutes"].unique().tolist() == [30.0]

    def test_ignores_naps(self, tmp_path):
        # Dated clear of the main-sleep nights, so the mainSleep filter is what
        # removes it rather than the one-row-per-night rule.
        nap = sleep_document(P1, "2021-06-20", "2021-06-20T14:00:00.000",
                             "2021-06-20T15:00:00.000", minutes_asleep=55,
                             time_in_bed=60, main_sleep=False)
        csv_path, bson_path = write_fixture(tmp_path, nights=3, extra_docs=[nap])
        assert len(lifesnaps.load(daily_csv=csv_path, bson_path=bson_path)) == 6
        assert len(lifesnaps.load(daily_csv=csv_path, bson_path=bson_path,
                                  main_sleep_only=False)) == 7

    def test_skips_non_sleep_documents(self, tmp_path):
        csv_path, bson_path = write_fixture(tmp_path, nights=2)
        # Prepend heart-rate documents like the real dump contains.
        noise = encode_stream([{"id": P1, "type": "heart_rate",
                                "data": {"bpm": 60, "dateOfSleep": "decoy"}}])
        body = open(bson_path, "rb").read()
        open(bson_path, "wb").write(noise + body)
        assert len(lifesnaps.load(daily_csv=csv_path, bson_path=bson_path)) == 4


class TestAvailability:
    def test_structurally_absent_features_are_present_but_empty(self, files):
        df = lifesnaps.load(daily_csv=files[0], bson_path=files[1])
        for col in schema.EXPECTED_MISSING["lifesnaps"]:
            assert col in df.columns, col
            assert df[col].isna().all(), col

    def test_expected_features_are_populated(self, files):
        df = lifesnaps.load(daily_csv=files[0], bson_path=files[1])
        for col in schema.EXPECTED_AVAILABLE["lifesnaps"]:
            assert df[col].notna().any(), col

    def test_age_is_a_band_so_the_numeric_input_stays_empty(self, files):
        # The release de-identifies age to "<30"/">=30". Imputing a midpoint
        # would fabricate precision, so the band is kept separately instead.
        df = lifesnaps.load(daily_csv=files[0], bson_path=files[1])
        assert df["age"].isna().all()
        assert df["age_band"].notna().any()
