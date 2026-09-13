# Feature mapping: `feature_spec.py` → LifeSnaps and PMData

Supersedes [`feature-mapping-mmash.md`](feature-mapping-mmash.md) as the basis
for the evaluation.

**Revised 2026-09-10 after building the loaders.** The first version of this
document was written from column names and non-null counts. Three of its claims
turned out to be wrong once real values were parsed, and they are corrected
below. Everything here now reflects what the loaders actually produce, asserted
by `ai-brain/tests/test_real_datasets.py`.

## The two datasets, as loaded

| | LifeSnaps | PMData |
| --- | --- | --- |
| Participants **with sleep data** | **69** (of 71 in the CSV) | 16 |
| Person-nights | **3,551** | **1,881** |
| Raw sleep records | 4,141 | 1,942 `mainSleep` |
| Complete cases over available features | **1,780** | **1,210** |
| Source | Zenodo 7229547, `rais_anonymized.zip` | datasets.simula.no, `pmdata.zip` |
| Access | open, no request | open, no request |

Raw records exceed person-nights because some nights carry several sleep
episodes; the loaders keep the longest per night. Two LifeSnaps participants
contributed no sleep at all, which is why 69 rather than 71.

**Where the data lives.** LifeSnaps' curated CSVs contain *no sleep timing* —
bedtime exists only in `mongo_rais_anonymized/fitbit.bson`, a 9.7 GB mongodump.
`ai-brain/datasets/bson_stream.py` streams it. PMData needs none of this;
`fitbit/sleep.json` carries `startTime` directly.

---

## 1. Directly available

| Feature | LifeSnaps | PMData |
| --- | --- | --- |
| `bedtime_hour` | `fitbit.bson` sleep `startTime` | `fitbit/sleep.json` `startTime` |
| `resting_hr` | daily CSV `resting_hr` | `resting_heart_rate.json` (nested one level; 0.0 means "not computed" and is dropped) |
| `steps` | daily CSV `steps` | `fitbit/steps.json`, minute-level, summed daily |
| `stress_level` | — | `pmsys/wellness.csv` `stress`, daily 1–5 self-report |

## 2. Derivable, with assumptions

| Feature | Derivation | Assumption |
| --- | --- | --- |
| `sleep_consistency` | SD of bedtime over the preceding nights, rescaled 0–100 | Possible here only because there are ~50 (LifeSnaps) / ~120 (PMData) nights per person. The linear map and its 3 h floor are arbitrary — report sensitivity. |
| `sleep_debt_hours` | Cumulative (need − actual) over preceding nights | `need_hours` is unavoidable. A per-person mean is circular, so a fixed 8 h is used and exposed as a parameter. |
| `chronotype_code` | Habitual bedtime binned lark / intermediate / owl | A behavioural proxy for MEQ, which neither dataset administers. It captures when someone sleeps, not their stated preference. |
| `exercise_minutes` | `very_active` + `moderately_active` minutes | Fitbit's own classification. Lightly-active is excluded as incidental movement. |
| `stress_level` (LifeSnaps) | `100 − stress_score` | **Fitbit's Stress Management Score is inverted** — higher means *less* stressed. It is also a proprietary composite, not a self-report, and covers only 52.5% of nights. |

Both habit features are computed from **strictly prior nights**. Including
tonight's own value would leak the target into the predictors and make every
reported metric optimistic; `TestNoLeakage` in `tests/test_derive.py` pins this.

## 3. Unavailable — no equivalent in either dataset

Goes into limitations verbatim.

| Feature | Why |
| --- | --- |
| `age` | **Corrected.** Listed as available in the first draft on a 91.7% non-null count. The values are not numbers: LifeSnaps de-identifies age to `<30` / `>=30`. PMData ships no demographics at all. A midpoint imputation would fabricate precision nobody measured, so the model input is empty and the band is kept as `age_band` for the cohort table. |
| `screen_minutes_before_bed` | Neither dataset instruments device use. |
| `caffeine_mg` | LifeSnaps: nothing. PMData `reporting.csv` logs meals, fluid and alcohol — no caffeine field, no doses. |
| `ambient_noise_db` | No environmental audio. |
| `room_temp_c` | No environmental temperature. LifeSnaps' `nightly_temperature` is *body* temperature — not a substitute. |
| `snooze_count` | No alarm interaction recorded. |
| `alarm_response_ms` | Same. |

**Score: 3 direct (LifeSnaps) / 4 direct (PMData), 5 derivable, 7 absent.**

---

## Actual coverage

Measured, not estimated. The first draft warned that heavy CSV-level
missingness would shrink the usable set; that was too pessimistic. Nights with
sleep records are also nights the watch was worn, so covariate coverage on the
person-nights that matter is far better than coverage across all person-days.

| Feature | LifeSnaps | PMData |
| --- | --- | --- |
| `bedtime_hour`, sleep outcomes | 100% | 100% |
| `exercise_minutes` | 99.9% | 99.9% |
| `steps` | 99.7% | 99.9% |
| `resting_hr` | **98.9%** (CSV-level suggested 59.7%) | 82.7% |
| `sleep_consistency`, `sleep_debt_hours` | 96.2% | 98.3% |
| `stress_level` | **52.5%** | 79.2% |

`stress_level` is the only genuinely sparse feature. Decide deliberately whether
to drop it, impute it, or restrict the model to complete cases — and say which.

---

## What this means for the mechanism

### The habit partition: 2 of 4 (was 0 of 4 on MMASH)

`wake_plan.py`'s habit features are `sleep_consistency`, `snooze_count`,
`alarm_response_ms`, `sleep_debt_hours`. Multi-night coverage makes the first
and fourth derivable at ~96–98% coverage. **The infeasibility attribution is
evaluable** — it can attribute a shortfall to bedtime irregularity or
accumulated debt, on half its intended inputs.

The other two are structurally absent. No consumer wearable records alarm
interaction, so this is not fixable by finding a better dataset.

### The controllable partition: 3 of 7

Of bedtime, screen time, caffeine, ambient noise, room temperature, stress and
exercise, only **bedtime, stress and exercise** survive.

The primary control survives, so the bedtime sweep — the core of the
contribution — is fully evaluable. The greedy coordinate ascent is not: it was
built to search seven levers and can search three. Report it as evaluated over
the available subset rather than quietly redefining `CONTROLLABLE`.

### There is still no wake-success label

Neither dataset knows whether anyone woke *when they needed to*. The proxy must
be deviation from a per-participant habitual wake time. That is anchorable here
in a way it was not on MMASH, but it remains a proxy and is the first thing a
reviewer will interrogate.

---

## Recommendation

**Use both.** They fail in opposite directions.

- **LifeSnaps as primary** — 69 participants and 3,551 nights is what supports
  grouped splits and any generalisability claim.
- **PMData as replication** — 16 participants, but better instrumented per day:
  a real self-reported stress item at 79% coverage against LifeSnaps'
  proprietary score at 52%. A second independent cohort is what reviewers ask
  for.

Neither yields a numeric age, so any age-adjusted analysis is off the table and
the cohort table reports bands only.
