# Sleep-duration model: synthetic versus real

Retraining the sleep-duration model on real wearable data, against the synthetic
panel it was developed on.

**Headline: the synthetic panel overstates predictability by a wide margin. On
real data the model explains far less variance, and on the second cohort it does
not beat predicting the mean. This is the paper's most important empirical
result and it should be reported as a finding, not buried.**

Code: `ai-brain/training/train_real.py`. Tests: `tests/test_train_real.py`.

---

## Setup

Identical to `training/model_training.py` — `RandomForestRegressor(n_estimators=200,
max_depth=12, min_samples_leaf=8)`, `GroupShuffleSplit` at 20%, seed 42 — so
differences come from the data, not the method.

**The synthetic reference was retrained on the same 7 features.** The published
synthetic figures (MAE 0.41 h) used all 15 inputs, and real data supplies only 7.
Comparing those directly would confound "synthetic versus real" with "more
features versus fewer". The numbers below isolate the first question.

Features: `chronotype_code`, `bedtime_hour`, `exercise_minutes`, `resting_hr`,
`steps`, `sleep_consistency`, `sleep_debt_hours`. `stress_level` is excluded from
the headline run — at 53% coverage it costs half the participants, and including
it changes MAE by less than its cost in sample size.

**Splits are by participant.** A person contributes ~50 nights; splitting rows
at random would let the model recognise the person rather than learn anything.
`tests/test_train_real.py` asserts disjointness across 15 seeds.

**Outcome columns can never be features.** `time_in_bed_hours`,
`sleep_efficiency` and `wake_time_hour` are measured at the same moment as the
target — duration is nearly time-in-bed times efficiency. `assert_no_leakage`
raises rather than allowing it.

## Results

| | MAE (h) | Baseline MAE | R² | Improvement |
| --- | --- | --- | --- | --- |
| **Synthetic panel** (6,878 nights, 340 people) | **0.403** | 0.741 | **+0.702** | **+45.6%** |
| **LifeSnaps** (3,376 nights, 63 people) | **1.016** | 1.191 | **+0.186** | +15.0% |
| **PMData** (1,881 nights, 16 people) | **1.072** | 1.106 | **−0.090** | +3% |

LifeSnaps figures are means over 8 grouped splits.

### The spread matters as much as the mean

With ~13 test participants per split, one number is close to a coin toss:

| seed | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MAE | 0.999 | 0.930 | 1.027 | 1.032 | 0.921 | 1.170 | 0.933 | 1.117 |
| R² | +0.248 | +0.357 | +0.163 | +0.086 | +0.395 | **−0.077** | +0.262 | +0.054 |

R² ranges from −0.08 to +0.40 (sd 0.160). **Any single-split R² for this model is
not a result**, and the paper must report the distribution.

### The model does not beat knowing who the person is

An oracle predicting each test participant's own mean duration scores MAE 1.005
on average, against the model's 1.016. The model beats it in **3 of 8 splits**.

The oracle is not a fair competitor — under grouped splits a test participant's
mean is unavailable at prediction time, which is the point. It is a diagnostic,
and what it says is that **most predictable variance in sleep duration is
between people, not between nights within a person.** The features move the
needle ~15% over a global mean, and less than personal identity would.

## Why the synthetic panel was optimistic

`training/dataset_builder.py` generates nights from explicit functional
relationships between the features and duration. A forest recovers those
relationships, which is why R² reaches 0.70. Real sleep duration is driven by
things no wrist wearable records — obligations, children, illness, noise,
whether tomorrow is a workday — so the same features explain about a quarter as
much.

The simulator is carefully built and its documentation is honest about being a
simulation. The problem is only that its metrics were the ones on record, and
they are not indicative.

## What this means for the paper

**Report it as a finding.** "Physiologically-structured synthetic sleep data
overstates model performance by roughly 4× in R², validated on two independent
real cohorts" is a genuinely useful contribution — training sleep models on
simulated panels is common, and this is evidence about what that costs.

**It constrains what the planner can claim.** The inverse planner inverts this
model. If the model explains 19% of variance, recommendations rest on a weak
signal, and the paper must not imply otherwise. Two honest framings:

- Report planner behaviour *conditional on* model quality, with the model's
  limits stated up front.
- Treat frequent infeasibility verdicts as correct behaviour rather than a
  shortcoming: a planner built on a weak model *should* often say "not at this
  reliability, use a backup alarm."

**PMData's negative R² needs saying plainly.** On the 16-participant cohort the
model is worse than the mean. Small cohort, wide error bars — but it is the
replication attempt, and it did not replicate.

## Open question for the next step

Sleep duration may simply be the harder target. Wake-time regularity — the
retargeted label from step 7 — is a different question and may carry more signal
from these features. Step 9 will answer it, and the answer determines whether
the planner has anything solid to invert.
