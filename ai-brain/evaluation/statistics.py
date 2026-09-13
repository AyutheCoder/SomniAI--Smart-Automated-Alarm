"""Uncertainty for every number the paper reports.

Three things are easy to get wrong with this data, and all three inflate
confidence rather than deflate it:

*Nights are not independent.* A participant contributes ~50 of them. Resampling
rows treats those as 50 independent observations and shrinks every interval by
roughly the square root of the nights per person. Everything here resamples
**participants**.

*A single split is not a result.* Step 8 saw R-squared range from -0.08 to +0.40
across grouped splits of the same data. Reporting whichever split ran last is
reporting noise. `across_splits` returns the distribution.

*Calibration error has uncertainty too.* ECE is a statistic like any other, and
an ECE of 0.0148 means little without knowing whether its interval spans 0.05.

The mixed-effects models serve a second purpose beyond coefficients: the
intraclass correlation quantifies how much of the outcome is explained by which
participant this is rather than by anything about the night. That is the formal
version of the observation in sleep-duration-results.md that an oracle using
each person's own mean beat the model.
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from evaluation.planner_eval import calibration_error  # noqa: E402

DEFAULT_BOOTSTRAP = 2000
ALPHA = 0.05

# Optimiser for MixedLM. Not lbfgs: on this data it reports convergence while
# sitting on the boundary with a between-participant variance of exactly zero,
# which would say no variance is attributable to the participant. Powell finds
# ~1.08 on the same fit, and an independent one-way ANOVA decomposition agrees
# the variance is real. A reported ICC of zero here is almost always the
# optimiser, not the data - hence `boundary_solution` on every result.
_METHOD = "powell"
_BOUNDARY_TOL = 1e-8


# ---------------------------------------------------------------------------
# Cluster bootstrap
# ---------------------------------------------------------------------------


def cluster_bootstrap(
    df: pd.DataFrame,
    statistic,
    group_col: str = "participant_id",
    n_boot: int = DEFAULT_BOOTSTRAP,
    seed: int = 0,
) -> dict:
    """Bootstrap `statistic` by resampling whole participants.

    Each replicate draws participants with replacement and takes all of their
    nights, preserving the within-person correlation that makes a row-level
    bootstrap wrong here.
    """
    rng = np.random.default_rng(seed)
    groups = df[group_col].unique()
    by_group = {g: sub for g, sub in df.groupby(group_col)}

    point = statistic(df)
    draws = []
    for _ in range(n_boot):
        picked = rng.choice(groups, size=len(groups), replace=True)
        sample = pd.concat([by_group[g] for g in picked], ignore_index=True)
        try:
            value = statistic(sample)
        except Exception:
            continue
        if value is not None and np.isfinite(value):
            draws.append(float(value))

    if len(draws) < 100:
        return {"estimate": point, "ci_low": float("nan"), "ci_high": float("nan"),
                "n_boot": len(draws), "n_participants": len(groups),
                "usable": False}

    lo, hi = np.percentile(draws, [100 * ALPHA / 2, 100 * (1 - ALPHA / 2)])
    return {
        "estimate": round(float(point), 4),
        "ci_low": round(float(lo), 4),
        "ci_high": round(float(hi), 4),
        "bootstrap_sd": round(float(np.std(draws, ddof=1)), 4),
        "n_boot": len(draws),
        "n_participants": int(len(groups)),
        "usable": True,
    }


def calibration_with_uncertainty(
    df: pd.DataFrame,
    truth_col: str = "y_true",
    prob_col: str = "y_prob",
    group_col: str = "participant_id",
    n_boot: int = 1000,
) -> pd.DataFrame:
    """ECE and Brier with participant-level bootstrap intervals."""
    rows = []
    for name, fn in (
        ("ece", lambda d: calibration_error(d[truth_col], d[prob_col])["ece"]),
        ("brier", lambda d: calibration_error(d[truth_col], d[prob_col])["brier"]),
        ("base_rate", lambda d: float(d[truth_col].mean())),
        ("mean_prediction", lambda d: float(d[prob_col].mean())),
    ):
        rows.append({"metric": name,
                     **cluster_bootstrap(df, fn, group_col=group_col, n_boot=n_boot)})
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Repeated splits
# ---------------------------------------------------------------------------


def across_splits(values, name: str = "metric") -> dict:
    """Summarise a metric over repeated grouped splits.

    The interval is over splits, not over nights: it answers "how much does this
    number move if the participants had been divided differently", which is the
    question a reader should be asking of a 13-participant test set.
    """
    arr = np.asarray([v for v in values if np.isfinite(v)], dtype=float)
    if len(arr) < 2:
        return {"metric": name, "n_splits": int(len(arr)), "usable": False}
    mean = float(arr.mean())
    sd = float(arr.std(ddof=1))
    se = sd / np.sqrt(len(arr))
    return {
        "metric": name,
        "n_splits": int(len(arr)),
        "mean": round(mean, 4),
        "sd": round(sd, 4),
        "ci_low": round(mean - 1.96 * se, 4),
        "ci_high": round(mean + 1.96 * se, 4),
        "min": round(float(arr.min()), 4),
        "max": round(float(arr.max()), 4),
        "usable": True,
    }


# ---------------------------------------------------------------------------
# Mixed-effects models
# ---------------------------------------------------------------------------


def _standardise(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Z-score predictors so coefficients are comparable effect sizes."""
    out = df.copy()
    for c in cols:
        sd = out[c].std()
        out[c] = (out[c] - out[c].mean()) / sd if sd and np.isfinite(sd) else 0.0
    return out


def person_constant(df: pd.DataFrame, predictors: list[str],
                    group_col: str = "participant_id") -> list[str]:
    """Predictors that never vary within a participant.

    These cannot appear in a random-intercept model: they are perfectly
    collinear with the random intercept itself, so the fit goes singular and
    their coefficients come back with absurd intervals. `chronotype_code` is one
    - it is derived from each participant's median bedtime, so by construction
    it has a single value per person.
    """
    constant = []
    for col in predictors:
        within = df.groupby(group_col)[col].std(ddof=0)
        if float(within.fillna(0).max()) < 1e-9:
            constant.append(col)
    return constant


def unconditional_icc(df: pd.DataFrame, outcome: str,
                      group_col: str = "participant_id") -> dict:
    """Share of raw outcome variance sitting between participants.

    Fitted with no predictors, which is what makes it interpretable: it answers
    "how much of this outcome is explained by knowing only whose night it is",
    and is the formal counterpart to the person-mean oracle in step 8.
    """
    from statsmodels.regression.mixed_linear_model import MixedLM

    work = df.dropna(subset=[outcome, group_col]).copy()
    fit = MixedLM.from_formula(outcome + " ~ 1", groups=work[group_col],
                               data=work).fit(reml=True, method=_METHOD)
    between = float(fit.cov_re.iloc[0, 0])
    within = float(fit.scale)
    total = between + within
    return {
        "outcome": outcome,
        "n_obs": int(len(work)),
        "n_groups": int(work[group_col].nunique()),
        "icc": round(between / total, 4) if total > 0 else float("nan"),
        "var_between_participants": round(between, 4),
        "var_within_participant": round(within, 4),
        "boundary_solution": bool(between <= _BOUNDARY_TOL),
    }


def mixed_linear(
    df: pd.DataFrame,
    outcome: str,
    predictors: list[str],
    group_col: str = "participant_id",
) -> dict:
    """Random-intercept model for a continuous outcome.

    Person-constant predictors are dropped and reported rather than silently
    fitted: including one makes the random-effects covariance singular and
    produces coefficients with intervals spanning millions.

    Returns standardised coefficients with intervals, plus the conditional
    intraclass correlation - between-person variance that survives after the
    time-varying predictors have had their say.
    """
    from statsmodels.regression.mixed_linear_model import MixedLM

    dropped = person_constant(df, predictors, group_col)
    usable = [p for p in predictors if p not in dropped]
    if not usable:
        raise ValueError("every predictor is constant within participant")

    work = df.dropna(subset=[outcome] + usable + [group_col]).copy()
    work = _standardise(work, usable)
    formula = outcome + " ~ " + " + ".join(usable)
    fit = MixedLM.from_formula(formula, groups=work[group_col], data=work).fit(
        reml=True, method=_METHOD)
    predictors = usable

    ci = fit.conf_int()
    coefs = []
    for term in fit.params.index:
        if term == "Group Var":
            continue
        lo, hi = float(ci.loc[term, 0]), float(ci.loc[term, 1])
        coefs.append({
            "term": term,
            "coef": round(float(fit.params[term]), 4),
            "ci_low": round(lo, 4),
            "ci_high": round(hi, 4),
            "excludes_zero": bool(lo > 0 or hi < 0),
        })

    between = float(fit.cov_re.iloc[0, 0])
    within = float(fit.scale)
    icc = between / (between + within) if (between + within) > 0 else float("nan")
    return {
        "n_obs": int(len(work)),
        "n_groups": int(work[group_col].nunique()),
        "conditional_icc": round(icc, 4),
        "var_between_participants": round(between, 4),
        "var_within_participant": round(within, 4),
        "dropped_person_constant": dropped,
        "boundary_solution": bool(between <= _BOUNDARY_TOL),
        "coefficients": pd.DataFrame(coefs),
    }


def clustered_logistic(
    df: pd.DataFrame,
    outcome: str,
    predictors: list[str],
    group_col: str = "participant_id",
) -> dict:
    """Population-averaged logistic model with cluster-robust standard errors.

    GEE with an exchangeable working correlation rather than a mixed logistic:
    it is robust to getting the correlation structure wrong, which matters more
    here than the extra machinery a random-effects logistic would buy.
    Coefficients are odds ratios per standard deviation of the predictor.
    """
    import statsmodels.api as sm
    from statsmodels.genmod.generalized_estimating_equations import GEE

    work = df.dropna(subset=[outcome] + predictors + [group_col]).copy()
    work[outcome] = work[outcome].astype(int)
    work = _standardise(work, predictors)
    formula = outcome + " ~ " + " + ".join(predictors)
    fit = GEE.from_formula(
        formula, groups=work[group_col], data=work,
        family=sm.families.Binomial(),
        cov_struct=sm.cov_struct.Exchangeable(),
    ).fit()

    ci = fit.conf_int()
    rows = []
    for term in fit.params.index:
        lo, hi = float(ci.loc[term, 0]), float(ci.loc[term, 1])
        rows.append({
            "term": term,
            "odds_ratio": round(float(np.exp(fit.params[term])), 4),
            "ci_low": round(float(np.exp(lo)), 4),
            "ci_high": round(float(np.exp(hi)), 4),
            "excludes_one": bool(lo > 0 or hi < 0),
        })
    return {
        "n_obs": int(len(work)),
        "n_groups": int(work[group_col].nunique()),
        "within_cluster_correlation": round(float(fit.cov_struct.dep_params), 4),
        "coefficients": pd.DataFrame(rows),
    }
