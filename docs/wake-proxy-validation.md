# Wake-success proxy: validation results

Neither LifeSnaps nor PMData contains an alarm, so the wake-success target has
to be constructed. This is what happened when it was tested.

**Headline: the proxy is stable and non-circular, but it has no association with
how participants said they felt. It measures schedule deviation, not success —
and the paper has to say so and rename the target accordingly.**

Code: `ai-brain/datasets/wake_proxy.py`. Tests: `tests/test_wake_proxy.py`.

---

## The label

"Woke no more than `tolerance_min` after this participant's habitual wake time
for this kind of day." Default: 30 minutes, weekday/weekend-aware baseline,
one-sided, baseline from the preceding 28 nights excluding tonight.

Three defaults are deliberate:

- **One-sided.** Oversleeping is waking *late*. A symmetric window scores
  someone who woke 40 minutes early as a failure, which is a different construct.
- **Day-type aware.** People wake later at weekends by choice. A pooled baseline
  turns the label into a weekday detector.
- **Baseline excludes tonight.** Otherwise the night shapes its own target.

A fourth was discovered by test rather than designed: **no fallback to pooled
history for thin buckets.** Borrowing the pooled baseline for early weekend
nights judges a 10:00 weekend wake against a 07:00 weekday habit and calls it
three hours of oversleeping — reintroducing exactly the contamination the
bucketing removes. Off by default; costs ~11% of nights on LifeSnaps.

## Coverage and balance, at the defaults

| | Nights | Labelled | Positive rate |
| --- | --- | --- | --- |
| LifeSnaps | 3,551 | 3,169 (89%) | 0.746 |
| PMData | 1,881 | 1,785 (95%) | 0.666 |

## Sensitivity — it passes

Positive rate, LifeSnaps, one-sided:

| baseline | 15 min | 30 min | 45 min | 60 min | 90 min |
| --- | --- | --- | --- | --- | --- |
| pooled | 0.637 | 0.712 | 0.774 | 0.812 | 0.874 |
| weekday/weekend | 0.656 | 0.746 | 0.804 | 0.848 | 0.901 |
| day-of-week | 0.638 | 0.722 | 0.776 | 0.833 | 0.885 |

The **baseline choice barely matters** — 3.4 points between the three at 30
minutes. Tolerance is a smooth monotone dial, as it must be. Symmetric mode sits
around 0.45 at 30 minutes, but that is a different construct rather than
instability.

Night-by-night agreement between defensible settings runs **0.86–0.94**, so the
settings are close to interchangeable rather than merely producing similar
summary rates.

Day-of-week bucketing costs 863 labelled nights (needs three prior same-weekday
nights) for no gain over weekday/weekend. Not worth it.

## Circularity — it passes

`sleep_consistency` is a model *feature*, and a label that merely re-read it
would make the model look good for a trivial reason.

| | corr(label, `sleep_consistency`) | corr(label, `bedtime_hour`) |
| --- | --- | --- |
| LifeSnaps | +0.089 | −0.148 |
| PMData | +0.053 | −0.266 |

Negligible. The label is not a restatement of an input.

## Construct validity — it fails

Does the label track anything the participant independently reported?

| Check | n | Standardised difference |
| --- | --- | --- |
| PMData `sleep_quality` (1–5) | 1,424 | **−0.093** |
| PMData `readiness` (1–10) | 1,369 | **−0.026** |
| LifeSnaps `TIRED` flag | 1,608 | **−0.041** |

All |d| < 0.1, and two of three point the *wrong way*. Restricting to weekdays
does not help. Ignoring the threshold and correlating the raw deviation against
self-report gives −0.024, −0.018 and −0.020.

Some settings in the grid do show the expected direction — weekday-only at a
90-minute tolerance reaches +0.107 and +0.138. Those are the two cells where the
sign flips in a grid where it flips freely, on a smaller subsample. That is
noise, and reporting it as a finding would be picking the result.

**The proxy does track objective sleep timing**, which is why it is not
meaningless:

| | corr(deviation, sleep duration) | corr(deviation, bedtime) |
| --- | --- | --- |
| LifeSnaps | +0.178 | −0.003 |
| PMData | +0.366 | +0.224 |

Waking later than habit means sleeping longer. Mechanically sensible, and
unrelated to feeling worse.

## What this means

The obvious reading is the right one: **waking later than usual is not a bad
outcome.** Most late wakes are lie-ins, and lie-ins feel good. Calling the label
"wake success" claims something the data does not support.

This does **not** damage the method. The inverse planner is unchanged: it still
inverts a trained classifier against a probability target, still partitions
controllable from habit-level inputs, still returns an infeasibility verdict
with attribution. What changes is the honest name of what it predicts.

### Recommended reframing

Predict **P(waking within N minutes of habitual wake time)** and call it
*wake-time regularity*, not wake success. The planner then answers:

> "What is the latest bedtime that still gives me an 85% chance of waking within
> half an hour of my usual time?"

That is a real question for anyone who has to be up at their usual hour, it is
exactly what the existing machinery computes, and it claims nothing about
wellbeing or about meeting an obligation.

### For the limitations section

- The target is constructed, not measured; no alarm exists in either dataset.
- It captures deviation from personal schedule, and showed **no association**
  with self-reported sleep quality, readiness or tiredness (|d| < 0.1).
- It cannot distinguish an unwanted oversleep from a deliberate lie-in. A
  deployment study with a real alarm is the only way to separate them — which is
  the natural follow-up, and where instrumented `snooze_count` and
  `alarm_response_ms` would also come from.
