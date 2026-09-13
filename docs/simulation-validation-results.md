# Inverse planning: algorithm validation in simulation

Step 10 established that the planner's recommendation cannot be checked against
observational data — it promises an outcome conditional on a bedtime nobody
adopted. This closes that gap by grading the algorithm against exhaustive
search, where the counterfactual is computable.

**Headline: the planner is sound but incomplete. It never promises a target that
cannot be reached (0 violations in 42 scenarios), the bedtime sweep is optimal in
100% of cases including non-monotone responses, and lever selection is exactly
minimal whenever it succeeds. Its failure is conservatism: at production settings
it refuses 24% of targets that were in fact achievable.**

Code: `ai-brain/evaluation/simulation.py`, `scenarios.py`. Tests:
`tests/test_simulation.py`.

---

## Method

Seven ground-truth reliability functions, six targets each. For every pair, the
right answer is computed by exhaustive search over the planner's own reachable
set, so "found the optimum" is checked rather than asserted.

The scenarios deliberately include the shapes that defeat greedy search:

| Scenario | What it tests |
| --- | --- |
| `monotone` | Control: smooth and well behaved |
| `non_monotone` | A dip around 22:30, so "earlier is better" is locally false |
| `redundant_levers` | Two levers on one shared channel — gains must not add |
| `interacting_levers` | A lever that only helps once another has moved |
| `ceilinged` | Hard ceiling at 0.72; targets either side must be handled |
| `habit_bound` | Nothing controllable helps; only long-run habit does |
| `flat` | Constant, so every raised target must be refused |

**The reachable set must match the planner's.** `_optimize_plan` advances the
chosen lever 3 steps per round and may pick the same lever every round, so with
`max_rounds` rounds one lever travels up to `3 × max_rounds` steps. An earlier
version of this study searched only 3 steps and reported "broken promises" that
were artifacts of the measurement being narrower than the planner. It is
parameterised now, and `tests/test_simulation.py` pins the relationship.

## Results

At the **previous** production configuration (`max_rounds=3`), which is what
prompted the change described below:

| Property | Result |
| --- | --- |
| Bedtime sweep finds the latest feasible bedtime | **100%** (42/42) |
| Promises only what is reachable (**soundness**) | **100%** — 0 broken promises |
| Lever set exactly minimal when it succeeds | **100%** (13/13) |
| Refuses only what is genuinely unreachable (**completeness**) | **76%** — 10 false refusals |

At the **current** configuration (`max_rounds=8`), soundness, sweep optimality
and the ceiling boundary are unchanged; false refusals fall from 10 to 3 and
verdict accuracy rises from 0.762 to 0.929.

### Soundness holds; completeness does not

The planner never over-promises, at any iteration budget tested. That is the
safety-critical direction: a system whose contribution is honest refusal must
not claim a target it cannot support, and it does not.

It does refuse targets that were achievable — 10 of 42. The cause is not the
greedy strategy but the iteration budget. Traced on `redundant_levers` at target
0.70:

```
round 1: caffeine 200 -> 80    rel 0.350 -> 0.500
round 2: caffeine  80 ->  0    rel 0.500 -> 0.600
round 3: bedtime 24.00 -> 23.25  rel 0.600 -> 0.660   <- max_rounds reached
round 4: bedtime 23.25 -> 22.50  rel 0.660 -> 0.720      (would have met 0.70)
```

The search was one round short. Round 2 correctly re-scored caffeine's remaining
gain rather than double-counting it, so the re-scoring that exists to handle
redundancy works — the budget simply ran out.

### The ceiling boundary is exact

Probed at a thousandth either side of `ceilinged`'s 0.72 limit and `flat`'s 0.40:

| Target vs ceiling | Promises? | Correct |
| --- | --- | --- |
| 0.005 below | yes | yes |
| 0.001 below | yes | yes |
| **exactly the ceiling** | **yes** | yes |
| 0.001 above | no | yes |
| 0.005 above | no | yes |

A target equal to the achievable ceiling is achievable, and the planner treats
it so. This is where an off-by-one in the comparison would hide, invisible on a
coarse target grid: refusing at the ceiling would lose reachable plans, and
promising above it would break soundness. Neither happens.

### The budget is a soundness-preserving dial

Ground truth re-matched to each budget:

| `max_rounds` | Verdict correct | False refusals | Broken promises | Bedtime optimal | Exactly minimal |
| --- | --- | --- | --- | --- | --- |
| 3 (previous) | 0.762 | 10 | **0** | 1.00 | 1.00 |
| 4 | 0.786 | 9 | **0** | 1.00 | 1.00 |
| 6 | 0.810 | 8 | **0** | 1.00 | 1.00 |
| **8** (current) | 0.929 | 3 | **0** | 1.00 | 0.95 |

Raising it monotonically reduces false refusals and **never introduces a broken
promise**. At 8 rounds verdict accuracy reaches 0.93 with soundness intact, for
more compute and a slight loss of minimality (1.00 → 0.95).

**Applied.** `wake_plan._optimize_plan` now defaults to `max_rounds=8`, with the
reasoning recorded at the call site so the value is traceable to this evidence
rather than looking arbitrary. `TestIterationBudget` pins both the value and the
property that justified it.

One consequence worth recording: a test asserting that false refusals exist at a
single mid-range target began failing after the change — because the change
worked. It was widened to the full grid, where 3 of 42 cells still refuse
something achievable, and bounded on both sides so the residual gap is
documented but cannot silently grow.

## What this does and does not establish

| Claim | Evidence |
| --- | --- |
| The bedtime sweep returns the latest feasible bedtime | **Simulation, exhaustive** |
| The planner never promises an unreachable target | **Simulation, exhaustive** |
| Lever selection is minimal | **Simulation, exhaustive** |
| The reliability it states is calibrated | **Real data**, ECE 0.0148 |
| Refusal beats always-promising | **Real data**, over-promise 1.000 → 0.040 |
| Following the advice improves waking | **Not established** — needs deployment |

That division is the paper's evaluation section, and stating it plainly is
stronger than blurring it. Algorithm validated where counterfactuals are
computable; model validated where real behaviour is observed; end-to-end effect
declared out of scope with the reason given.
