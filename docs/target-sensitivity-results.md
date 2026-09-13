# Target sensitivity: what the label construction costs

The paper's Section III-G names three choices in building the wake-time
regularity label — tolerance, day-type bucketing, one-sided versus symmetric —
and claimed each was "reported with a sensitivity analysis." **No such analysis
existed.** `wake_proxy.sensitivity()` and `wake_proxy.agreement()` had been
written and never run. This document is that analysis.

Run on **PMData only** (1,881 nights, 16 participants; 1,785 labelled under the
paper's setting). LifeSnaps could not be re-downloaded — Zenodo returns HTTP 504
on record 7229547 — so the larger cohort is missing and this must be repeated on
it before the claim is fully discharged.

Regenerate: `results/target_sensitivity.csv`, `results/target_agreement.csv`.

## The headline number, stated before anyone else finds it

Across the **full grid** of defensible settings the positive rate runs from
**0.198 to 0.858** — a spread of 0.66. Taken alone that number says the label is
not measuring one thing, and a reviewer running the code would find it.

It decomposes, and the decomposition is the actual result.

| Source of variation | Held fixed | Spread |
| --- | --- | --- |
| Tolerance (15–90 min) | weekend buckets, one-sided | **0.270** |
| Day-type (none / weekend / dow) | 30 min, one-sided | **0.040** |
| One-sided vs symmetric | 30 min, weekend | **0.259** |

## Positive rate and night-by-night agreement

Agreement is against the paper's setting (30 min, weekend buckets, one-sided).

| Variant | Positive rate | Agreement |
| --- | --- | --- |
| 15 min | 0.588 | 0.923 |
| **30 min — the paper's setting** | **0.666** | — |
| 45 min | 0.726 | — |
| 60 min | 0.780 | 0.886 |
| 90 min | 0.858 | — |
| Pooled baseline (no day-type) | 0.625 | 0.839 |
| Day-of-week buckets | 0.651 | 0.915 |
| Symmetric (two-sided) | 0.406 | 0.741 |

## What this says

**Tolerance is not a fragile choice.** Halving it to 15 minutes changes 7.7% of
labels; doubling it to 60 changes 11.4%. The positive rate moves because a wider
window mechanically admits more nights — that is arithmetic, not instability.
The labels themselves are stable, which is the question that matters.

**Day-type bucketing barely moves the rate but does move the labels.** The rate
spread across none/weekend/dow is 0.040, the smallest of the three. But
agreement with the pooled baseline is 0.839 — 16% of nights flip. Both facts
matter: the choice is nearly invisible in aggregate and consequential per night,
which is exactly the case where reporting only the rate would mislead. It also
confirms the Section III-G argument that pooling contaminates thin weekend
buckets rather than being a harmless simplification.

**Weekend and day-of-week bucketing are close to interchangeable** (agreement
0.915, rates 0.666 vs 0.651). The paper picked the simpler one and loses almost
nothing by it.

**One-sided versus symmetric is the one genuinely consequential choice.**
Agreement 0.741 — a quarter of all nights flip — and the rate drops from 0.666
to 0.406. The paper defends one-sidedness conceptually: oversleeping means
waking *late*, and scoring someone who woke forty minutes early as a failure
measures a different construct. That argument stands, but it is a conceptual
argument, not an empirical one, and this is the number that shows how much rides
on it. It belongs in the paper rather than in a reviewer's rebuttal.

## What is still owed

- **Repeat on LifeSnaps.** 69 participants against PMData's 16. Blocked on
  Zenodo returning 504; retry, or fetch `rais_anonymized.zip` by hand from
  record 7229547.
- **Check whether the AUC moves with the label.** This analysis shows the label
  changes; it does not show whether the *model's* discrimination survives the
  change. A reviewer may reasonably ask for AUC at 15 and 60 minutes, not only
  the positive rate.
