"""Tests for the statistical analysis.

Two failure modes here would make every interval in the paper too narrow, and
both are silent:

  * bootstrapping rows rather than participants, which treats 50 correlated
    nights as 50 independent observations;
  * a mixed model that converges to the boundary and reports no between-person
    variance when there is plenty.

The second is not hypothetical - it happened with lbfgs on this data.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from evaluation import statistics


def clustered(n_groups=20, n_per=30, between_sd=1.0, within_sd=1.0, seed=0):
    """A cohort with a known split of between- and within-person variance."""
    rng = np.random.default_rng(seed)
    rows = []
    for g in range(n_groups):
        offset = rng.normal(0, between_sd)
        for _ in range(n_per):
            rows.append({
                "participant_id": f"p{g:02d}",
                "x": rng.normal(0, 1),
                "person_constant": float(g),        # never varies within a person
                "y": offset + rng.normal(0, within_sd),
            })
    return pd.DataFrame(rows)


class TestClusterBootstrap:
    def test_resamples_participants_not_rows(self):
        """The interval must reflect the number of people, not the number of nights.

        A row-level bootstrap over 600 correlated rows would give a far tighter
        interval than 20 independent participants justify.
        """
        df = clustered(n_groups=20, n_per=30, between_sd=1.0, within_sd=0.2)
        out = statistics.cluster_bootstrap(df, lambda d: float(d["y"].mean()),
                                           n_boot=400)
        naive_se = df["y"].std() / np.sqrt(len(df))
        clustered_se = out["bootstrap_sd"]
        assert clustered_se > naive_se * 2, "interval is too narrow to be clustered"

    def test_interval_covers_the_point_estimate(self):
        df = clustered()
        out = statistics.cluster_bootstrap(df, lambda d: float(d["y"].mean()),
                                           n_boot=400)
        assert out["ci_low"] <= out["estimate"] <= out["ci_high"]

    def test_more_participants_narrows_the_interval(self):
        narrow = statistics.cluster_bootstrap(
            clustered(n_groups=60), lambda d: float(d["y"].mean()), n_boot=300)
        wide = statistics.cluster_bootstrap(
            clustered(n_groups=8), lambda d: float(d["y"].mean()), n_boot=300)
        assert (narrow["ci_high"] - narrow["ci_low"]) < (wide["ci_high"] - wide["ci_low"])

    def test_reports_unusable_rather_than_a_fake_interval(self):
        df = clustered(n_groups=2, n_per=2)
        out = statistics.cluster_bootstrap(df, lambda d: float("nan"), n_boot=50)
        assert out["usable"] is False

    def test_calibration_intervals_are_produced_for_each_metric(self):
        rng = np.random.default_rng(1)
        df = pd.DataFrame({
            "participant_id": np.repeat([f"p{i}" for i in range(15)], 40),
            "y_prob": rng.uniform(0.2, 0.9, 600),
        })
        df["y_true"] = (rng.uniform(0, 1, 600) < df["y_prob"]).astype(int)
        out = statistics.calibration_with_uncertainty(df, n_boot=200)
        assert set(out["metric"]) == {"ece", "brier", "base_rate", "mean_prediction"}
        assert out["usable"].all()
        assert (out["ci_low"] <= out["estimate"]).all()
        assert (out["estimate"] <= out["ci_high"]).all()


class TestAcrossSplits:
    def test_reports_spread_not_just_the_mean(self):
        out = statistics.across_splits([0.1, 0.2, 0.3, 0.4], "r2")
        assert out["mean"] == pytest.approx(0.25)
        assert out["min"] == 0.1 and out["max"] == 0.4
        assert out["ci_low"] < out["mean"] < out["ci_high"]

    def test_a_single_split_is_not_a_result(self):
        assert statistics.across_splits([0.3], "r2")["usable"] is False

    def test_ignores_non_finite_values(self):
        out = statistics.across_splits([0.2, float("nan"), 0.4], "r2")
        assert out["n_splits"] == 2


class TestMixedModels:
    def test_recovers_a_known_intraclass_correlation(self):
        # between 1.0, within 1.0 -> ICC about 0.5
        df = clustered(n_groups=40, n_per=25, between_sd=1.0, within_sd=1.0)
        out = statistics.unconditional_icc(df, "y")
        assert 0.35 < out["icc"] < 0.65
        assert out["boundary_solution"] is False

    def test_detects_genuinely_absent_between_person_variance(self):
        df = clustered(n_groups=30, n_per=20, between_sd=0.0, within_sd=1.0)
        out = statistics.unconditional_icc(df, "y")
        assert out["icc"] < 0.1

    def test_the_optimiser_does_not_collapse_to_the_boundary(self):
        """lbfgs reported ICC 0.000 on real data where powell finds 0.336.

        A boundary solution is indistinguishable from "no between-person
        variance" unless something checks, so this pins the choice.
        """
        df = clustered(n_groups=40, n_per=25, between_sd=1.2, within_sd=1.0)
        out = statistics.unconditional_icc(df, "y")
        assert out["var_between_participants"] > 0.1
        assert out["boundary_solution"] is False

    def test_person_constant_predictors_are_identified(self):
        df = clustered()
        found = statistics.person_constant(df, ["x", "person_constant"])
        assert found == ["person_constant"]

    def test_person_constant_predictors_are_dropped_not_fitted(self):
        """Fitting one alongside a random intercept makes the model singular."""
        df = clustered()
        out = statistics.mixed_linear(df, "y", ["x", "person_constant"])
        assert out["dropped_person_constant"] == ["person_constant"]
        assert "person_constant" not in set(out["coefficients"]["term"])

    def test_refuses_when_every_predictor_is_person_constant(self):
        with pytest.raises(ValueError):
            statistics.mixed_linear(clustered(), "y", ["person_constant"])

    def test_recovers_a_real_fixed_effect(self):
        df = clustered(n_groups=30, n_per=30)
        df["y"] = df["y"] + 2.0 * df["x"]
        coefs = statistics.mixed_linear(df, "y", ["x"])["coefficients"]
        row = coefs.set_index("term").loc["x"]
        assert row["coef"] > 1.0
        assert row["excludes_zero"]

    def test_finds_no_effect_where_there_is_none(self):
        df = clustered(n_groups=30, n_per=30)
        coefs = statistics.mixed_linear(df, "y", ["x"])["coefficients"]
        assert not coefs.set_index("term").loc["x", "excludes_zero"]

    def test_clustered_logistic_returns_odds_ratios_with_intervals(self):
        rng = np.random.default_rng(3)
        df = clustered(n_groups=25, n_per=30)
        df["binary"] = (rng.uniform(0, 1, len(df)) < 0.3 + 0.4 * (df["x"] > 0)).astype(int)
        out = statistics.clustered_logistic(df, "binary", ["x"])
        row = out["coefficients"].set_index("term").loc["x"]
        assert row["odds_ratio"] > 1.0
        assert row["ci_low"] <= row["odds_ratio"] <= row["ci_high"]
        assert out["n_groups"] == 25
