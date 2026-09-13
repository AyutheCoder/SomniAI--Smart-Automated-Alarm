# Ablations and the matched subset

Step 11b: which parts of the planner earn their place, and the one observational
grip available on the recommendation itself.

**Two headlines. Every component has a distinct, measurable job — and the
controllable/habit/fixed partition is the only one whose removal breaks
soundness. The matched-subset analysis points the right way at every tolerance
but is inconclusive at all of them, which is itself the useful result: it says
what a deployment study needs to be.**

Code: `ai-brain/evaluation/ablation.py`, `matched.py`. Tests:
`tests/test_ablation_matched.py`.

---

## Ablations

Each component disabled in turn, graded against exhaustive ground truth over
seven scenarios × six targets.

| Ablation | Verdict correct | False refusals | Broken promises | Bedtime optimal | Exactly minimal |
| --- | --- | --- | --- | --- | --- |
| **none** (full planner) | **0.929** | 3 | **0** | **1.00** | 0.95 |
| no bedtime sweep | 0.881 | 5 | 0 | **0.69** | **0.56** |
| no coordinate ascent | **0.762** | **10** | 0 | 1.00 | 1.00 |
| no controllable/habit partition | 0.857 | 3 | **3** | 1.00 | 0.95 |
| no counterfactual attribution | 0.929 | 3 | 0 | 1.00 | 0.95 |

Each row fails differently, and the differences are the point:

**The bedtime sweep buys optimality, not feasibility.** Without it, coordinate
ascent still finds *a* plan — false refusals rise only 3 → 5 — but the plan is
the wrong one. Bedtime optimality collapses to 0.69 and minimality to 0.56: it
recommends going to bed earlier than necessary, and asks for more changes than
required. Exactly what an exhaustive 25-point scan exists to prevent.

**Coordinate ascent buys completeness.** Removing it more than triples false
refusals (3 → 10) and drops verdict accuracy to 0.762. Interestingly its
minimality is a perfect 1.00 — with only one lever available every solution is
trivially minimal. A flattering number that means less than it looks.

**The partition is what keeps the planner honest.** It is the *only* ablation
that produces broken promises — 3 of them — and the only one where promises rise
(20 → 23). Letting habit-level inputs pose as tonight's levers makes the planner
offer plans nobody can execute before bed: "respond to your alarm 14 seconds
faster tonight" is not advice. The mechanism flagged as distinctive in the
original invention disclosure turns out to be the one carrying soundness.

**The attribution is purely explanatory, as designed.** Its row is identical to
the full planner — same verdicts, same refusals, same minimality. What changes
is what the user is told:

| | Refused? | Habit causes named | Summary explains why |
| --- | --- | --- | --- |
| full | yes | **2** | **yes** |
| no attribution | yes | 0 | no |

Same decision, no reason given. Worth stating plainly rather than padding the
ablation table with a component that moves no metric.

### One limitation to carry into the paper

The simulation exercises all seven controllable levers. Real cohorts supply
three — bedtime, stress and exercise — because no wearable dataset records
screen time, caffeine, ambient noise or room temperature. So the
coordinate-ascent row measures what that component contributes **when its full
lever set exists**, which is an upper bound on what it contributes in deployment
today. Reported as such rather than by quietly redefining `CONTROLLABLE` to
whatever happens to be available.

### A measurement trap worth recording

Ground truth is computed from the **honest** lever set, captured before any
ablation widens it. Grading the partition ablation against its own inflated
beliefs would have shown zero broken promises and hidden the only soundness
failure in the table. `test_ground_truth_ignores_the_ablated_lever_set` pins it.

## Matched subset

Nights where a participant happened, by coincidence, to sleep near the hour the
planner would have recommended, compared against their other nights. Within
participant, because step 8 established most predictable variance sits between
people rather than between nights.

Held-out split: 587 nights, 13 participants. The planner advised on 456 and
refused 131.

| Tolerance | Matched | Unmatched | Participants usable | Difference | 95% CI | d | Conclusive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ±15 min | 43 | 413 | 9 | +0.085 | −0.055 … +0.225 | 0.40 | **no** |
| ±30 min | 86 | 370 | 9 | +0.045 | −0.128 … +0.217 | 0.17 | **no** |
| ±45 min | 137 | 319 | 11 | +0.093 | −0.043 … +0.230 | 0.40 | **no** |
| ±60 min | 168 | 288 | 11 | +0.071 | −0.056 … +0.199 | 0.33 | **no** |

**The direction is positive at every tolerance. Every interval crosses zero.**

With 9–11 participants contributing a usable paired difference, it could not
have been otherwise — this is an underpowered analysis and the consistent sign
is suggestive at most. It is **not** evidence that following the advice helps,
and the paper must not present it as such. It is also not randomised: a night
someone slept early because tomorrow mattered is a night tomorrow mattering
also explains the wake.

### What it is actually good for

Turning an inconclusive result into a study design. At 80% power and α = 0.05,
detecting an effect of the size observed would need:

| Observed d | Participants needed |
| --- | --- |
| 0.40 (±15 min) | ~50 |
| 0.33 (±60 min) | ~72 |
| 0.17 (±30 min) | ~274 |

So a deployment study of **roughly 50–75 participants** could settle what 13
cannot — and if the true effect is nearer the ±30 min estimate, no feasible
study would detect it. That is a concrete input to `PRODUCT_PLAN.md` Phase F,
which currently proposes 15–30 participants. **That would be underpowered.**

## Where this leaves the evidence

| Claim | Status |
| --- | --- |
| Each component contributes something distinct | **Established** (ablation) |
| The partition is what preserves soundness | **Established** — only ablation that breaks it |
| The attribution explains without changing verdicts | **Established** |
| Following the advice improves waking | **Still open** — direction positive, underpowered |
