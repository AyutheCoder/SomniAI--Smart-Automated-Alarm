# Calibration and refusal quality

The paper's central claim under the infeasibility-first framing, evaluated on
held-out participants.

**Two headlines. First: the stated reliability is well calibrated (ECE 0.0148),
so the planner's numbers mean what they say. Second: model-based refusal beats
always-promising decisively at high targets — at a 0.95 target the model-free
planners over-promise on 100% of nights and the inverse planner on 4%.**

**And one problem worth stating plainly: the inversion itself cannot be
validated on observational data.** See the last section.

Code: `ai-brain/evaluation/planner_eval.py`. Tests: `tests/test_planner_eval.py`.

---

## Calibration

Pooled over 5 grouped splits, 3,180 held-out person-nights.

| Predicted | n | Observed | Gap |
| --- | --- | --- | --- |
| 0.28 | 15 | 0.267 | +0.011 |
| 0.35 | 74 | 0.378 | −0.025 |
| 0.45 | 83 | 0.313 | **+0.133** |
| 0.55 | 152 | 0.513 | +0.041 |
| 0.66 | 436 | 0.649 | +0.013 |
| 0.76 | 1,115 | 0.765 | −0.009 |
| 0.84 | 1,178 | 0.832 | +0.010 |
| 0.93 | 127 | 0.929 | −0.000 |

**ECE 0.0148 · MCE 0.1325 · Brier 0.1727**

Well calibrated where the mass is. The one poor bin (0.4–0.5, n=83) over-claims
by 13 points; it holds 2.6% of nights, which is why ECE stays low and MCE does
not. Report both.

**The necessary caveat:** always predicting the base rate scores ECE 0.0000 —
perfectly calibrated, entirely uninformative. Brier separates them: 0.1727 for
the model against 0.1898 for the base-rate predictor. So the honest description
is **well calibrated, weakly informative**, which is consistent with AUC 0.66.

That combination is unusual to report and it is exactly what honest refusal
needs: the model does not know much, but it knows how much it knows.

## Refusal quality

Over-promise rate — the fraction of nights where a planner promised a target the
participant's own achieved rate could not deliver. Lower is better. Three splits
averaged, 101 nights each.

| Target | always_promise | cycle_calculator | inverse | forward_only |
| --- | --- | --- | --- | --- |
| 0.70 | 0.376 | 0.376 | 0.372 | **0.294** |
| 0.80 | 0.614 | 0.614 | 0.473 | **0.261** |
| 0.90 | 0.867 | 0.867 | 0.068 | **0.016** |
| 0.95 | 1.000 | 1.000 | 0.040 | **0.013** |

**The model-free planners fail completely at high targets.** At 0.95 both promise
every night and are wrong every time. This is the behaviour the paper argues
against, and the size of the failure is the result: a 90-minute-cycle calculator
has no way to know it cannot deliver, so it never says so.

The model-based planners refuse almost everything at 0.90 and 0.95, which is
correct — very few participants achieve those rates.

## The problem: inversion cannot be validated here

`forward_only` beats `inverse` at every target. **This is a measurement artifact,
not evidence that inversion hurts**, and the paper must say so rather than
report the ranking.

The two planners make different kinds of promise:

- `forward_only` says *"tonight, as it already stands, clears the target."* The
  ground truth — what the participant actually did that night — tests exactly
  that claim.
- `inverse` says *"if you moved your bedtime to 22:45, you would clear the
  target."* **Nobody in LifeSnaps moved their bedtime to 22:45 on our advice.**
  The observed outcome tests a night the recommendation was not made about.

So the evaluation penalises the inverse planner for promising outcomes
conditional on behaviour change that never happened. The comparison is not
between a better and a worse planner; it is between a claim the data can check
and one it cannot.

This is the counterfactual gap named at the top of `planner_eval.py`, and no
retrospective dataset resolves it. What the current evidence supports:

| Claim | Status |
| --- | --- |
| The stated reliability is calibrated | **Validated** (ECE 0.0148) |
| Model-based refusal beats always-promising | **Validated** (1.000 → 0.040 at target 0.95) |
| The bedtime recommendation is correct | **Not testable** on observational data |
| Inversion beats forward-only prediction | **Not testable** on observational data |

### What would test it

1. **A matched subset.** Nights where a participant happened, by coincidence, to
   sleep at the hour the planner would have recommended. A quasi-experimental
   comparison against their other nights. Feasible here, underpowered, worth
   attempting as a secondary analysis.
2. **A deployment study.** Give people the recommendation and measure what
   follows. The only clean test, and the natural follow-up.

## Consequence for the paper

This strengthens rather than weakens the infeasibility-first choice. The
component that survives observational evaluation is precisely the one that
framing leads with: **the refusal and its calibration.** The bedtime
recommendation is presented as a secondary output whose validation requires a
deployment study — stated as a limitation up front rather than left for a
reviewer to find.
