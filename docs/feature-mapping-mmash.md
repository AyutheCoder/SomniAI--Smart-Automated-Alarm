# Feature mapping: `feature_spec.py` → MMASH

What the 15 model inputs would actually be backed by if MMASH were the training
set. Written to be pessimistic on purpose — the third list below goes into the
paper's limitations section, and an optimistic mapping here becomes a reviewer's
objection later.

**Source:** MMASH v1.0.0 (PhysioNet) — 22 healthy young adult males, 24 hours of
continuous monitoring spanning 2 days, with `user_info`, `sleep`, `RR`,
`questionnaire`, `Activity`, `Actigraph` and `saliva` files per participant.

---

## 1. Directly available (3 of 15)

| Feature | MMASH source | Notes |
| --- | --- | --- |
| `age` | `user_info.csv` | Present, but the cohort is young adults only — the schema's 16–70 range is not exercised. |
| `bedtime_hour` | `sleep.csv` "In Bed Time" | Needs conversion to the 20–26 encoding where 24–26 means 00:00–02:00. |
| `steps` | `Actigraph.csv` step counts | Summable per day. The most solid feature in the set. |

## 2. Derivable, with assumptions that must be stated (6 of 15)

| Feature | Derivation | The assumption you are making |
| --- | --- | --- |
| `chronotype_code` | MEQ score (16–86) in `questionnaire.csv` | Horne-Östberg defines five categories; the schema has three. Collapsing them (≤41 → owl, 42–58 → intermediate, ≥59 → lark) is conventional but is still a choice you are imposing. |
| `stress_level` (0–100) | DSI score (0–406), rescaled | **Different construct.** DSI counts and weights discrete stressful events during the day; the model's `stress_level` is a general state. A monotone rescale does not make them the same thing, and the distribution shape changes. |
| `resting_hr` | `RR.csv` inter-beat intervals, or `Actigraph.csv` HR | Requires defining a "resting" window — lowest sustained HR during a lying/inactive period. Defensible, but the definition is yours and results will move with it. |
| `exercise_minutes` | `Activity.csv` exercise category durations | Self-reported activity log. Cross-checkable against accelerometer counts, and you should do that check rather than trust the log alone. |
| `screen_minutes_before_bed` | `Activity.csv` screen-usage category, windowed before in-bed time | Two choices: trusting a self-reported log, and picking the pre-bed window (2 h? 3 h?). Report sensitivity to the window. |
| `caffeine_mg` | `Activity.csv` substance-consumption events | **The weakest in this list.** MMASH logs consumption *events*, not doses. Any milligram figure is imputed from a nominal per-serving value you invented — it is not measured. Consider degrading this to a binary "consumed caffeine" rather than pretending to a quantity. |

## 3. Unavailable — no equivalent exists (6 of 15)

These go into limitations verbatim. There is no derivation, no proxy worth the
name, and no amount of feature engineering that recovers them.

| Feature | Why it is absent |
| --- | --- |
| `ambient_noise_db` | MMASH contains no environmental audio sensing of any kind. |
| `room_temp_c` | No environmental temperature sensing. |
| `snooze_count` | No alarm is part of the protocol; no alarm interaction is recorded. |
| `alarm_response_ms` | Same — participants were not woken by an instrumented alarm. |
| `sleep_consistency` | A trailing-window measure of bedtime variability. Requires multiple prior nights per person; MMASH gives essentially one. |
| `sleep_debt_hours` | Accumulated deficit against need. Same problem — no history to accumulate over. |

---

## The two findings that matter more than the table

### The habit partition is entirely unavailable

`wake_plan.py` splits features into *controllable tonight*, *habit-level* and
*fixed*. The habit partition is exactly four features:

```
sleep_consistency, snooze_count, alarm_response_ms, sleep_debt_hours
```

**MMASH provides none of them.** That partition is what produces the
infeasibility attribution — *"the limit is not tonight; it is that you habitually
need 19 seconds to respond to an alarm"* — which is the most distinctive part of
the contribution and the one an informal prior-art check rated most likely to be
novel.

So the headline mechanism cannot be evaluated on MMASH at all. Not evaluated
weakly — not evaluated.

### There is no wake-success outcome, and not enough rows to fit anything

The wake-success model needs a label of the form *"did this person wake when
they needed to."* MMASH records no intended wake time and no alarm, so there is
nothing to compare an actual wake against. The proxy planned in prompt 7 —
"woke within N minutes of intended wake time" — has no intended wake time to
anchor to.

Separately, the arithmetic does not work. Roughly one usable night per
participant across 22 participants is about **22 rows** against **15 features**.
That will not support a RandomForest, a grouped train/test split, or a
mixed-effects model over repeated nights. The cohort is also all male, all young,
and all healthy, which would cap the generalisability claim even if the sample
were larger.

---

## What this changes

**I told you two messages ago that MESA was "a sample-size upgrade, not a
prerequisite." That was wrong, and this mapping is why.** MMASH cannot carry the
evaluation:

- 3 of 15 features solid, 6 imputed, 6 absent
- the entire habit partition missing, so the headline mechanism is untestable
- no wake-success outcome available at all
- ~22 rows

MESA Sleep's 7-day actigraphy across 2,237 participants is a different
proposition: roughly 15,000 person-nights, which supports trailing-window
features, grouped splits, and repeated-measures statistics. **It is now the
critical path, not a bonus.** The email to `support@sleepdata.org` about
unaffiliated access is correspondingly more urgent than I made it sound.

### Options, honestly

1. **Wait for MESA and build on it.** Best paper, dependent on an access
   decision you do not control.
2. **Use MMASH as a documented pilot only** — sanity-check the sleep-duration
   model on real data, state plainly that it is 22 participants and not the
   evaluation. Useful as a secondary result, never as the main one.
3. **If MESA is refused, find another multi-night source before writing.** The
   requirement is now explicit: multiple nights per participant, plus some
   anchor for intended wake time. Any candidate dataset gets this same mapping
   exercise before you commit to it.
4. **Reframe to what the data can support.** A paper about inverse planning for
   *bedtime under a sleep-duration target* — dropping wake-success and the habit
   attribution — is honest and evaluable on more datasets, but it gives up the
   most novel part of the contribution.

My recommendation is 1 with 2 running in parallel, and 3 prepared in advance so
a refusal costs days rather than weeks.
