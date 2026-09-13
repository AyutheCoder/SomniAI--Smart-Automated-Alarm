# Statistical analysis

Step 12: an interval on every number the paper reports, and mixed-effects models
that respect repeated nights within a participant.

**Headline: the signal survives proper uncertainty. R² excludes zero
[0.075, 0.297] and AUC excludes chance [0.610, 0.710], so "weak but real" is now
supported rather than asserted. But calibration is less precise than it looked —
ECE 0.0148 carries an interval reaching 0.057, four times the point estimate.**

Code: `ai-brain/evaluation/statistics.py`. Tests: `tests/test_statistics.py`.

---

## Why the usual machinery does not apply

A participant contributes ~50 nights. Treating those as 50 independent
observations shrinks every interval by roughly the square root of the nights per
person, so all uncertainty here comes from resampling **participants**, never
rows. `test_resamples_participants_not_rows` asserts a clustered interval is at
least twice the naive one.

## Calibration, with uncertainty

Participant-level bootstrap over 46 held-out participants, 800 replicates.

| Metric | Estimate | 95% CI |
| --- | --- | --- |
| **ECE** | **0.0148** | **0.0139 – 0.0571** |
| Brier | 0.1727 | 0.1490 – 0.2003 |
| Base rate | 0.7453 | 0.6959 – 0.7882 |
| Mean prediction | 0.7524 | 0.7284 – 0.7743 |

The ECE interval is wide and right-skewed: its upper bound is nearly four times
the point estimate. Calibration is still good — even 0.057 is respectable — but
reporting "ECE 0.0148" alone claims a precision the data does not support. The
base-rate and mean-prediction intervals overlap almost entirely, which is what
good average calibration looks like.

## Across splits, not within one

Eight grouped splits. The interval answers "how much does this move if the
participants had been divided differently", which is the right question of a
13-participant test set.

| Metric | Mean | SD | 95% CI | Range |
| --- | --- | --- | --- | --- |
| MAE (h) | 1.016 | 0.091 | 0.953 – 1.079 | 0.921 – 1.170 |
| R² | 0.186 | 0.160 | **0.075 – 0.297** | −0.077 – 0.395 |
| ROC AUC | 0.660 | 0.072 | **0.610 – 0.710** | 0.518 – 0.733 |
| Balanced accuracy | 0.615 | 0.049 | 0.581 – 0.649 | 0.541 – 0.678 |
| Accuracy | 0.716 | 0.058 | 0.676 – 0.757 | 0.623 – 0.787 |

**Both intervals exclude their null.** R² stays above zero and AUC above 0.500,
so the models genuinely beat chance — a claim earlier steps could only assert
from point estimates that swung from −0.077 to +0.395 across splits.

## How much is just "which person is this?"

Unconditional intraclass correlation, no predictors:

| Outcome | ICC | Between-person var | Within-person var |
| --- | --- | --- | --- |
| Sleep duration | **0.336** | 1.077 | 2.124 |
| Wake regularity | **0.060** | 0.011 | 0.179 |

**The two outcomes have completely different structure, and the paper should say
so.** A third of sleep-duration variance is a stable person-level trait, which is
the formal version of step 8's finding that an oracle using each participant's
own mean beat the model. Wake regularity is almost entirely night-to-night —
only 6% attributable to the person.

That asymmetry is informative rather than inconvenient: it suggests wake
regularity is the more appropriate target for a system that intervenes on
*nights*, because there is something night-level to influence. Sleep duration is
substantially fixed by who someone is.

## Mixed-effects: sleep duration

Random intercept per participant, standardised predictors, n = 3,376 nights
across 63 participants. Conditional ICC 0.207.

| Term | Coefficient | 95% CI | Excludes zero |
| --- | --- | --- | --- |
| Intercept | 6.523 | 6.333 – 6.713 | yes |
| **bedtime_hour** | **−0.295** | −0.354 – −0.236 | **yes** |
| **resting_hr** | **−0.211** | −0.328 – −0.093 | **yes** |
| **steps** | **−0.122** | −0.213 – −0.030 | **yes** |
| sleep_debt_hours | −0.059 | −0.120 – 0.002 | no |
| exercise_minutes | 0.037 | −0.050 – 0.124 | no |
| sleep_consistency | −0.005 | −0.064 – 0.054 | no |

Per standard deviation later bedtime, about 18 minutes less sleep. Three of six
predictors carry intervals excluding zero; the habit features do not.

`chronotype_code` was **dropped**, not fitted. It is derived from each
participant's median bedtime, so it has exactly one value per person and is
perfectly collinear with the random intercept.

## Clustered logistic: wake regularity

GEE, exchangeable working correlation, cluster-robust standard errors.
n = 3,132 nights, 62 participants, within-cluster correlation 0.060 — matching
the ICC above from an entirely different estimator.

| Term | Odds ratio | 95% CI | Excludes 1 |
| --- | --- | --- | --- |
| Intercept | 3.133 | 2.603 – 3.771 | yes |
| **bedtime_hour** | **0.677** | 0.496 – 0.925 | **yes** |
| **resting_hr** | **0.802** | 0.670 – 0.960 | **yes** |
| steps | 1.201 | 0.966 – 1.494 | no |
| chronotype_code | 1.127 | 0.861 – 1.476 | no |
| sleep_consistency | 1.081 | 0.980 – 1.194 | no |
| sleep_debt_hours | 1.054 | 0.908 – 1.225 | no |
| exercise_minutes | 0.866 | 0.702 – 1.068 | no |

The same two predictors survive in both models, by different estimators on
different outcomes. Each standard deviation later bedtime multiplies the odds of
waking on schedule by 0.68.

## A methodological trap worth recording

The first run of these models reported **ICC = 0.000** for both outcomes, with a
singular random-effects covariance and an intercept interval spanning ±6.5
million. It would have read as "no variance is attributable to the participant",
contradicting everything step 8 established.

It was the optimiser. `lbfgs` reported successful convergence while sitting on
the boundary at zero. On identical data, `powell` and `cg` both find a
between-person variance of ≈1.08, and an independent one-way ANOVA decomposition
gives 0.589 — different estimators, same conclusion that the variance is real.

Every model now runs under `powell` and returns a `boundary_solution` flag, with
a test pinning the choice. **A reported ICC of zero in this codebase is far more
likely to be an optimiser artifact than a finding**, and the comment at the
constant says so.

## What now carries an interval

| Claim | Interval | Null excluded |
| --- | --- | --- |
| Sleep-duration model beats the mean | R² 0.075 – 0.297 | yes |
| Wake-regularity model beats chance | AUC 0.610 – 0.710 | yes |
| Stated reliability is calibrated | ECE 0.014 – 0.057 | n/a |
| Later bedtime shortens sleep | −0.354 – −0.236 SD | yes |
| Later bedtime worsens regularity | OR 0.496 – 0.925 | yes |
| Habit features predict either outcome | all cross the null | **no** |
