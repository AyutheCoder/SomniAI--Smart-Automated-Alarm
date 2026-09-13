"""Integration tests against the real downloads.

Skipped when the data is absent, so the suite still runs on a fresh checkout.
Point `SOMNIAI_DATA_DIR` at a directory containing `pmdata/` (the extracted
participant folders) and/or `lifesnaps.zip`.

These assert the counts established in `docs/feature-mapping-lifesnaps-pmdata.md`.
If a loader silently drops participants or nights, that document becomes wrong
and so does every sample size in the paper - which is exactly the failure these
exist to catch.
"""

from __future__ import annotations

import json
import os
import zipfile

import pytest

from datasets import bson_stream, lifesnaps, pmdata, schema, wake_proxy
from training import train_real

DATA_DIR = os.environ.get("SOMNIAI_DATA_DIR", "")
PMDATA_ROOT = os.path.join(DATA_DIR, "pmdata") if DATA_DIR else ""
LIFESNAPS_ZIP = os.path.join(DATA_DIR, "lifesnaps.zip") if DATA_DIR else ""

pmdata_available = bool(PMDATA_ROOT) and os.path.isdir(PMDATA_ROOT)
lifesnaps_available = bool(LIFESNAPS_ZIP) and os.path.exists(LIFESNAPS_ZIP)

needs_pmdata = pytest.mark.skipif(not pmdata_available, reason="PMData not present")
needs_lifesnaps = pytest.mark.skipif(not lifesnaps_available, reason="LifeSnaps not present")


@pytest.fixture(scope="module")
def pm():
    return pmdata.load(PMDATA_ROOT)


@pytest.fixture(scope="module")
def ls():
    return lifesnaps.load(zip_path=LIFESNAPS_ZIP)


@needs_pmdata
class TestPMData:
    def test_all_sixteen_participants_load(self, pm):
        assert pm["participant_id"].nunique() == 16

    def test_night_count_matches_the_source(self, pm):
        """Every mainSleep episode should survive, minus same-night duplicates."""
        raw_main = 0
        seen = set()
        for pid in pmdata.participant_dirs(PMDATA_ROOT):
            path = os.path.join(PMDATA_ROOT, pid, "fitbit", "sleep.json")
            for r in json.load(open(path, encoding="utf-8")):
                if r.get("mainSleep"):
                    raw_main += 1
                    seen.add((pid, r["dateOfSleep"]))
        assert raw_main == 1942, "source file changed; update the mapping doc"
        # The loader keeps one row per participant-night.
        assert len(pm) == len(seen)

    def test_no_duplicate_person_nights(self, pm):
        assert not pm.duplicated(subset=["participant_id", "date"]).any()

    def test_the_features_pmdata_should_have(self, pm):
        for col in schema.EXPECTED_AVAILABLE["pmdata"]:
            assert pm[col].notna().any(), col

    def test_the_features_pmdata_cannot_have(self, pm):
        for col in schema.EXPECTED_MISSING["pmdata"]:
            assert pm[col].isna().all(), col

    def test_values_land_inside_the_schema_ranges(self, pm):
        assert pm["bedtime_hour"].dropna().between(12, 36).all()
        assert pm["wake_time_hour"].dropna().between(0, 24).all()
        assert pm["stress_level"].dropna().between(0, 100).all()
        assert pm["sleep_consistency"].dropna().between(0, 100).all()
        assert pm["sleep_debt_hours"].dropna().between(-2, 4).all()
        assert pm["sleep_duration_hours"].dropna().between(0, 24).all()

    def test_habit_features_are_actually_derivable_here(self, pm):
        # The whole reason PMData replaced MMASH: enough nights per person.
        assert pm["sleep_consistency"].notna().sum() > 1000
        assert pm["sleep_debt_hours"].notna().sum() > 1000


@needs_lifesnaps
class TestLifeSnaps:
    def test_participant_count(self, ls):
        """69, not the 71 in the CSV - two participants contributed no sleep."""
        assert ls["participant_id"].nunique() == 69

    def test_sleep_records_are_not_silently_dropped(self):
        """4,141 sleep documents exist and every one must be seen.

        They collapse to 3,551 person-nights because ~590 nights carry more than
        one episode, which the one-row-per-night rule folds together. The raw
        count is asserted separately so a parser regression cannot hide behind
        the deduplication.
        """
        raw = 0
        with zipfile.ZipFile(LIFESNAPS_ZIP) as zf:
            with zf.open(lifesnaps.FITBIT_BSON_MEMBER) as fh:
                for doc in bson_stream.iter_documents(fh, where=lambda r: b"dateOfSleep" in r):
                    if doc.get("type") == "sleep":
                        raw += 1
        assert raw == 4141, "source changed; update the mapping doc"

    def test_person_nights_after_folding_multi_episode_nights(self, ls):
        assert len(ls) == 3551

    def test_age_is_a_band_not_a_number(self, ls):
        """LifeSnaps de-identifies age to "<30"/">=30", so the model input is empty."""
        assert ls["age"].isna().all()
        assert set(ls["age_band"].dropna().unique()) <= {"<30", ">=30"}

    def test_no_duplicate_person_nights(self, ls):
        assert not ls.duplicated(subset=["participant_id", "date"]).any()

    def test_the_features_lifesnaps_should_have(self, ls):
        for col in schema.EXPECTED_AVAILABLE["lifesnaps"]:
            assert ls[col].notna().any(), col

    def test_the_features_lifesnaps_cannot_have(self, ls):
        for col in schema.EXPECTED_MISSING["lifesnaps"]:
            assert ls[col].isna().all(), col

    def test_values_land_inside_the_schema_ranges(self, ls):
        assert ls["bedtime_hour"].dropna().between(12, 36).all()
        assert ls["stress_level"].dropna().between(0, 100).all()
        assert ls["sleep_consistency"].dropna().between(0, 100).all()

    def test_covariate_coverage_is_reported_not_assumed(self, ls):
        """Missingness is heavy and must be visible, not discovered later."""
        report = schema.completeness(ls).set_index("column")
        # Sleep timing comes from the BSON, so it is complete by construction.
        assert report.loc["bedtime_hour", "coverage_pct"] == 100.0
        # These come from the sparse daily CSV.
        assert 0 < report.loc["resting_hr", "coverage_pct"] < 100
        assert 0 < report.loc["stress_level", "coverage_pct"] < 100


@needs_pmdata
@needs_lifesnaps
class TestWakeProxy:
    """Pins the validation results in `docs/wake-proxy-validation.md`.

    Bounds are loose: the point is to catch a change in kind, not to freeze
    exact figures. In particular, a large jump in the correlation with
    `sleep_consistency` would mean the label had become a restatement of a model
    input, which is the failure that would make the whole evaluation worthless.
    """

    def test_labels_most_nights(self, ls, pm):
        for df, floor in ((ls, 0.85), (pm, 0.90)):
            labelled = wake_proxy.wake_success(df)["wake_success"]
            assert labelled.notna().mean() > floor

    def test_class_balance_is_usable(self, ls, pm):
        for df in (ls, pm):
            rate = wake_proxy.wake_success(df)["wake_success"].dropna().mean()
            assert 0.55 < rate < 0.85, "degenerate label"

    def test_baseline_choice_barely_moves_the_label(self, ls):
        grid = wake_proxy.sensitivity(ls, tolerances=(30.0,), one_sided=(True,))
        spread = grid["positive_rate"].max() - grid["positive_rate"].min()
        assert spread < 0.06, f"baseline choice swings the label by {spread:.3f}"

    def test_settings_agree_night_by_night(self, ls):
        out = wake_proxy.agreement(ls, [
            {"name": "a", "tolerance_min": 30.0, "day_type": "weekend"},
            {"name": "b", "tolerance_min": 30.0, "day_type": "none"},
        ])
        assert out.iloc[0]["agreement"] > 0.85

    def test_is_not_a_restatement_of_sleep_consistency(self, ls, pm):
        for df in (ls, pm):
            sub = wake_proxy.wake_success(df)[["wake_success", "sleep_consistency"]].dropna()
            assert abs(sub["wake_success"].corr(sub["sleep_consistency"])) < 0.3

    def test_construct_validity_remains_absent(self, pm):
        """Documents the negative result rather than hiding it.

        If this ever starts failing, the label has begun tracking self-report -
        which would be good news, and worth investigating rather than silencing.
        """
        r = wake_proxy.construct_validity(
            wake_proxy.wake_success(pm), "self_report_sleep_quality"
        )
        assert r["usable"]
        assert abs(r["standardised_difference"]) < 0.2

    def test_deviation_still_tracks_objective_sleep_timing(self, pm):
        """The label is not noise - it just is not about wellbeing."""
        sub = wake_proxy.wake_success(pm)[
            ["wake_deviation_hours", "sleep_duration_hours"]].dropna()
        assert sub["wake_deviation_hours"].corr(sub["sleep_duration_hours"]) > 0.2


@needs_lifesnaps
class TestSleepDurationTraining:
    """Pins the results in `docs/sleep-duration-results.md`.

    Loose bounds, because the point is to catch a change in kind. A sudden jump
    to synthetic-level accuracy on real data would almost certainly mean a
    leaked feature rather than a better model.
    """

    def test_split_is_by_participant_on_the_real_cohort(self, ls):
        train, test = train_real.grouped_split(ls)
        assert set(train["participant_id"]).isdisjoint(set(test["participant_id"]))

    def test_beats_the_mean_baseline_but_only_modestly(self, ls):
        feats = [c for c in train_real.available_features(ls) if c != "stress_level"]
        rep = train_real.repeated_evaluation(ls, features=feats, seeds=(0, 1, 2))
        improvement = (1 - rep["mae"] / rep["baseline_train_mean_mae"]).mean()
        assert 0.02 < improvement < 0.40, f"improvement {improvement:.3f} outside expected band"

    def test_real_data_is_much_harder_than_the_synthetic_panel(self, ls):
        """The finding: the simulator overstates predictability."""
        feats = [c for c in train_real.available_features(ls) if c != "stress_level"]
        real = train_real.repeated_evaluation(ls, features=feats, seeds=(0, 1, 2))
        syn = train_real.synthetic_reference(feats)
        if not syn.get("available"):
            pytest.skip("synthetic dataset not present")
        assert real["mae"].mean() > syn["mae"] * 1.8
        assert real["r2"].mean() < syn["r2"] * 0.6

    def test_r2_is_unstable_across_splits(self, ls):
        """Why single-split numbers must not be reported as the result."""
        feats = [c for c in train_real.available_features(ls) if c != "stress_level"]
        rep = train_real.repeated_evaluation(ls, features=feats, seeds=tuple(range(6)))
        assert rep["r2"].std() > 0.05


@needs_pmdata
@needs_lifesnaps
def test_both_datasets_share_one_schema(pm, ls):
    assert list(pm.columns) == list(ls.columns)
    assert set(pm["participant_id"]).isdisjoint(set(ls["participant_id"]))
