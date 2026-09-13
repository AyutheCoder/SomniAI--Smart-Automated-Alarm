# Original spec vs. what is actually built

An honest audit of `Project Idea.pdf` against the codebase, phase by phase.

**Short answer: roughly 60% fully built, 20% partial, 20% missing or mocked.**
The decision core — semantic understanding, scheduling, escalation, verification,
lifecycle, RL — is real and tested. What is thin is the *input* side (sensors,
external integrations) and the *output* side (backup channels), plus one
structural gap that undercuts the word "autonomous".

Legend: **Built** · *Partial* · **Missing** · `Mocked` (returns fake data that
looks real)

---

## Phase 1 — Data Collection

### 5.1 Behavioural data

| Spec | Status | Where |
| --- | --- | --- |
| sleep time, wake time | **Built** | `models/SleepLog.ts` |
| snooze frequency | **Built** | `models/BehaviorEvent.ts`, snooze route |
| alarm response time | **Built** | tracked per alarm |
| task completion time | **Built** | `models/Task.ts` |
| screen usage patterns | **Missing** | no screen monitoring anywhere |
| productivity schedules | *Partial* | tasks only, no schedule model |

### 5.2 Device sensors

| Sensor | Status | Note |
| --- | --- | --- |
| Accelerometer | **Built** | `lib/sensors/motion.ts`, shake challenge |
| Microphone | **Built** | `lib/sensors/mic.ts`, real RMS/dB |
| Gyroscope | **Missing** | not referenced in the codebase |
| Screen activity → bedtime detection | **Missing** | the spec's bedtime-detection route does not exist |
| GPS → contextual awareness | *Partial* | coordinates feed weather only |

### 5.3 External data

| Source | Status |
| --- | --- |
| weather | **Built** — real Open-Meteo calls |
| deadlines, exams | **Built** — via task text and due dates |
| calendar, meetings | `Mocked` — `simulateCalendar()` shuffles a hardcoded list |
| wearable health data | `Mocked` — `simulateWearable()` returns `Math.random()` |
| traffic | **Missing** — no reference anywhere |

## Phase 2 — Feature engineering

| Metric | Status |
| --- | --- |
| sleep consistency score | **Built** |
| wake efficiency score | **Built** |
| fatigue score, consistency score | **Built** |
| oversleep probability | **Built** |
| wake success probability | **Built** — but see the caveat below |
| wake resistance index | *Partial* — snooze history drives the escalation profile |
| sleep disruption score | **Missing** — needs screen-use data |
| productivity score | *Partial* |

## Phase 3 — Behavioural analysis

Habitual sleep cycles, response behaviour and wake reliability are **built**
(`lib/escalation.ts` derives a per-user effective-wake-level profile, which is
exactly the spec's "snoozes at 6:00 but wakes at 5:40" example). Productivity
windows and energy trends are *partial*.

## Phase 4 — AI decision engine

| Component | Status |
| --- | --- |
| Sleep prediction (quality, fatigue, oversleep risk) | **Built** — `ai-brain/predict.py` |
| Recommendation engine | **Built** — `ai-brain/recommend.py` |
| Reinforcement learning | **Built** — real disjoint LinUCB in `ai-brain/rl.py` |
| Burnout probability | **Missing** — no reference in the codebase |

## Phase 5 — Intelligent alarm scheduler

**Fully built.** `lib/scheduler.ts` sets time, intensity, strategy, verification
tier and confidence threshold from task importance and predicted oversleep risk,
with the four priority bands the spec asks for and an auditable reason for every
alarm it creates or skips.

## Phase 6 — Adaptive wake-up

Five-level ladder **built**, with gentle/adaptive/aggressive strategies and
per-user pacing. One stage of the spec's pipeline is absent: **pre-wake
relaxation** has no implementation — the ladder starts at the alarm.

## Phase 7 — Wake verification

| Method | Status |
| --- | --- |
| Math, typing | **Built** |
| Shake, QR | **Built** |
| Wake confidence score 0–100 | **Built** — gated so ancillary signals cannot substitute for correctness |
| Memory challenge | **Missing** |
| Walking steps | **Missing** |
| Face detection, voice confirmation | **Missing** |

## Phase 8 — Backup escalation

Five levels **built**. Every backup *channel* is `Mocked`:

```
"Triggered a backup alarm on a paired device (mock)."
"Flashed the bedroom smart lights to full brightness (mock)."
"Would notify your emergency contact (mock - no message sent)."
```

Only smartwatch vibration and smart-speaker announcement do anything real, and
only through the current browser — not a paired device.

## Phase 9 — Auto lifecycle management

**Fully built.** `lib/lifecycle.ts` prunes completed one-offs, disables stale
alarms, and re-tunes recurring ones from snooze history.

## Phase 10 — Analytics and reporting

Sleep graphs, wake statistics, fatigue predictions and weekly reports are
**built**. Productivity analysis is *partial*.

## Semantic analysis layer

| Spec item | Status |
| --- | --- |
| Task importance understanding | **Built** — the PDF's exact examples work |
| Emotional context detection | **Built** — stress/fatigue/motivation from text |
| Intent understanding ("cannot miss this") | **Built** — `must-not-miss` intent |
| Behavioural language ("maybe I'll study later") | **Built** — `procrastination-risk` |
| Contextual alarm planning | **Built** |
| BERT / DistilBERT | *Partial* — Tier 2 exists but is off by default |
| Chat input | **Missing** — no conversational interface |
| Voice tone analysis | **Missing** |
| LLM integration | **Missing** |

## Advanced features

| Feature | Status |
| --- | --- |
| Circadian intelligence | *Partial* — chronotype yes, biological cycle modelling no |
| Context-aware intelligence | *Partial* — weather real, traffic absent |
| Emotion & stress awareness | *Partial* — text yes, voice no |
| Smart environment integration | `Mocked` — lights, curtains, speakers all fake |

---

## The two things that matter most

### 1. "Autonomous" is not yet true

The spec's core promise is a system that "functions with minimal manual
interaction" and manages the sleep–wake lifecycle by itself. **The alarm only
fires while a browser tab is open.** There is no background scheduler and no push
delivery, so the most autonomous component in the design is the one that cannot
run unattended. Everything else works; this is the gap between the app and the
product the PDF describes.

### 2. "Wake success probability" does not mean what the spec assumes

The spec treats wake-success as a measurable outcome. Validation on two real
cohorts found the available proxy tracks **schedule regularity**, not whether
waking went well — no association with self-reported sleep quality, readiness or
tiredness (all |d| < 0.1). And the shipped models are trained on a synthetic
panel that overstates predictability roughly fourfold.

So the number is real, calibrated (ECE 0.0148), and does not measure what the
spec's phrasing implies. See `docs/wake-proxy-validation.md` and
`docs/sleep-duration-results.md`.

## What would close the biggest gaps

Ordered by value, not effort:

1. **Background alarm delivery** — makes "autonomous" honest. Needs a native
   shim; the largest single piece of work remaining.
2. **Real calendar + wearable integrations** — replaces the two mocked inputs
   the spec leans on most heavily.
3. **Real backup channels** — one working path (SMS or call) would make
   emergency escalation genuine rather than cosmetic.
4. **Rename the wake-success surface** so the app's claims match the evidence.

Screen-usage tracking, gyroscope, traffic, voice analysis, face detection and
smart-home control are all genuinely absent, but each is additive rather than
load-bearing.
