# Dataset decision: LifeSnaps, without waiting for anyone

> **Superseded in part (2026-09-10).** Written when the datasets were chosen,
> from their published descriptions. The participant and night counts here are
> the papers' figures; the measured counts after building the loaders are 69
> participants with sleep data and 3,551 person-nights for LifeSnaps. See
> [feature-mapping-lifesnaps-pmdata.md](feature-mapping-lifesnaps-pmdata.md) for
> what the data actually contains.

MESA needs an access decision that has not arrived and may not come at all
without an institutional affiliation. MMASH turned out to be unusable — see
[feature-mapping-mmash.md](feature-mapping-mmash.md). This is what to build on
instead, downloadable today with no request, no committee, and no agreement to
sign.

---

## Primary: LifeSnaps

| | |
| --- | --- |
| Source | Zenodo record [7229547](https://zenodo.org/records/7229547) |
| Licence | **CC BY 4.0** — open, redistributable with attribution |
| Access | Direct download. No request, no approval, no DUA. |
| Size | 586 MB (`rais_anonymized.zip`) |
| Participants | **71**, geographically distributed |
| Duration | **4+ months each** — roughly 8,000 person-nights |
| Device | Fitbit Sense, plus validated surveys and ecological momentary assessments |
| Published | *Scientific Data* (Nature), 2022 — citable and peer-reviewed |

The file that matters is
`csv_rais_anonymized/daily_fitbit_sema_df_unprocessed.csv` — daily-granularity
Fitbit and EMA data. There is an hourly version alongside it, plus scored
BREQ-2, IPIP, PANAS, STAI and TTM surveys.

### Why this fixes the MMASH problem

MMASH failed on two counts: no habit features, and ~22 usable rows. Months of
consecutive nights per person fixes both.

| | MMASH | LifeSnaps |
| --- | --- | --- |
| Person-nights | ~22 | ~8,000 |
| Nights per person | ~1 | ~120 |
| `sleep_consistency` | Underivable | **Derivable** — variability over a trailing window |
| `sleep_debt_hours` | Underivable | **Derivable** — trailing duration against personal need |
| Habit partition coverage | 0 of 4 | **2 of 4** |
| Grouped splits / mixed-effects | Impossible | Supported |

Two of four habit features means the infeasibility attribution — the most
distinctive part of the contribution — becomes demonstrable rather than
untestable. That is the difference that decides whether there is a paper.

---

## Feature mapping (provisional)

Marked provisional deliberately: this is from the dataset documentation, not
from the file itself. **Prompt 6 must verify every row against the real
columns** and this table gets corrected there.

### Available or directly derivable

| Feature | Source |
| --- | --- |
| `bedtime_hour` | Sleep records (bedtime start) |
| `steps` | Daily step count |
| `resting_hr` | Fitbit daily resting heart rate |
| `exercise_minutes` | Moderately + very active minutes |
| `stress_level` | Fitbit stress score, corroborated by STAI/PANAS and EMA |
| `sleep_consistency` | **Computed** — SD of bedtime or mid-sleep over a trailing window |
| `sleep_debt_hours` | **Computed** — trailing sleep duration against per-person need |
| `chronotype_code` | **Computed** — mid-sleep time on free days, the standard actigraphic chronotype proxy. Arguably better evidence than a questionnaire, since it is behaviour rather than self-report. |
| `age` | Expected in demographics — **verify on download**, do not assume |

### Unavailable — these go into limitations

| Feature | Why |
| --- | --- |
| `screen_minutes_before_bed` | No phone screen sensing; a wrist wearable cannot see it |
| `caffeine_mg` | Not logged (PMData covers this — see below) |
| `ambient_noise_db` | No environmental audio |
| `room_temp_c` | Fitbit Sense measures *skin* temperature, not the room |
| `snooze_count` | No alarm instrumentation |
| `alarm_response_ms` | Same |

`snooze_count` and `alarm_response_ms` are absent from **every** consumer
wearable dataset — they require an instrumented alarm, which only a deployment
study provides. Treat them as permanently out of reach on this branch and say so
plainly rather than substituting a proxy.

---

## Secondary: PMData

| | |
| --- | --- |
| Source | [datasets.simula.no/pmdata](https://datasets.simula.no/pmdata/) (also OSF, Kaggle, HuggingFace) |
| Licence | CC BY-NC 4.0 — **non-commercial**, unlike LifeSnaps |
| Participants | 16, over 5 months — **1,836 days of sleep scores** |
| Adds | Daily **meal logging** (a route to caffeine), and daily self-reported stress, fatigue, mood and readiness via the PMSys app |

Worth having as a robustness check on a second cohort, and it is the only easy
source that touches caffeine. Note the non-commercial clause differs from
LifeSnaps — keep the provenance of each result straight.

---

## The wake-success outcome

Still the hardest problem, but materially better here than on MMASH.

No consumer dataset records "did an alarm wake this person." What ~120 nights
per participant *does* give you is a per-person baseline: establish each
participant's habitual weekday wake time from their own history, then define the
outcome as waking within N minutes of it. MMASH could not do this — one night
gives no baseline to deviate from.

This remains a proxy, and the paper must say so in those words. Report
sensitivity across N, and across weekday-only versus all-days definitions.

---

## What this costs you

Being honest about the trade against MESA:

- **Consumer wearable, not polysomnography.** Fitbit sleep staging is less
  accurate than PSG. For sleep *duration* and *timing* — which is what the
  planner actually consumes — it is adequate, and that is the argument to make.
- **71 participants, self-selected.** Smaller and less representative than
  MESA's 2,237.
- **No clinical validation.**

None of these sink a methods paper. They are limitations to state, not defects
to hide. And the alternative was waiting on an access decision that may never
arrive.

**MESA is not abandoned** — if access is granted later, the same pipeline
re-runs against it and becomes a much stronger second results section. Build the
loader so the feature schema is the interface and the source is swappable.
