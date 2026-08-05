# SomniAI — Invention Disclosure (Confidential Draft)

**Status:** internal working document, prepared for review by a registered patent
attorney or agent. **Not legal advice, and not a novelty opinion.**

**Do not publish this file, or the repository containing it, before you have
taken advice.** Public disclosure — a public GitHub repo, a demo video, a
conference talk, an app-store listing, a paper — can forfeit patent rights
outright in absolute-novelty jurisdictions (EPO, China, India) and starts a
12-month clock in the United States. Keep the repository private until then.

---

## 0. What this document is, and what it is not

This describes three mechanisms implemented in this codebase, in the form an
attorney needs in order to assess them: what problem each solves, what it
actually does, and what the closest known art is.

**It does not establish that anything here is patentable.** That determination
requires:

1. **A professional prior-art search.** Sleep tracking and smart alarms are a
   crowded, heavily-patented field (Sleep Cycle, Fitbit/Google, Apple, Withings,
   Philips, Oura, ResMed, and a long tail of academic work on sleep-stage
   detection and sleep-inertia mitigation). Nothing below has been searched. It
   is entirely possible each is anticipated.
2. **A subject-matter eligibility analysis.** In the US, *Alice/Mayo* makes
   "apply an abstract idea on a generic computer" ineligible. Claims in this
   area survive most often when tied to a concrete technical improvement or a
   specific device interaction rather than framed as data analysis. Sections 1–3
   flag where such a hook plausibly exists — flag, not establish.
3. **A decision about whether a patent is the right instrument at all.** For a
   small software product, trade secret plus speed of execution is frequently
   the better commercial choice. A patent publishes the method in exchange for a
   right that is expensive to enforce.

The honest summary: **mechanism 1 is the most likely to be distinctive; 2 and 3
are refinements whose novelty depends heavily on prior art.**

---

## 1. Reliability-targeted inverse wake planning

**Files:** `ai-brain/wake_plan.py`, `app/api/ai/wake-plan/route.ts`,
`app/_components/WakePlanPanel.tsx`

### Problem

Sleep applications forecast: given tonight's behaviour, they output a predicted
duration or quality. A user with a hard obligation has the inverse question,
which is a *constraint*, not a forecast:

> "I must be up at 05:40 and I cannot miss it. What do I have to do tonight?"

A forecast leaves the user to interpret a probability and guess at a remedy. It
also never says *"what you want is not achievable"* — arguably the most
important output when someone is about to rely on a single alarm.

### Mechanism

A trained wake-success classifier is used as a **constraint to solve against**
rather than a predictor to read:

1. **Partition the feature space.** The 15 model inputs are split into
   *controllable tonight* (bedtime, screen minutes, caffeine, room noise, room
   temperature, stress, exercise), *habit-level* (sleep-timing consistency,
   habitual snooze count, habitual alarm response latency, accumulated sleep
   debt) and *fixed* (age, chronotype, resting HR). Only the first class is
   admissible in a same-night plan.
2. **Invert over the primary control.** Bedtime is swept across its admissible
   range at 15-minute resolution and the whole vector scored in one batched
   forward pass; the search returns the **latest** bedtime still meeting the
   required reliability. Latest, not earliest — the objective is the least
   behavioural cost that satisfies the constraint.
3. **Greedy coordinate ascent when the primary control is insufficient.**
   Remaining controllable inputs are searched one at a time, re-scoring after
   each committed move so redundancy between correlated levers is not
   double-counted. It terminates as soon as the target is met, yielding the
   *fewest* changes that suffice.
4. **Explicit infeasibility with attribution.** If no admissible combination
   reaches the target, the system says so, reports the achievable ceiling, and
   then attributes the shortfall to the *habit-level* partition by counterfactual
   substitution — "the limit is not tonight; it is that you habitually need
   19 seconds to respond to an alarm, worth 28% on its own" — and recommends an
   independent backup device.

### What may be distinctive

- Treating a required **reliability** as the input and a **behavioural deadline**
  as the output, rather than the reverse.
- The controllable / habit-level / fixed partition, which is what makes the
  output actionable tonight and the infeasibility explanation meaningful.
- Returning a first-class infeasibility verdict with a counterfactual
  attribution of the binding constraint, instead of an unqualified number.

### Closest art to search

Sleep Cycle / Fitbit smart-wake windows (wake within a window at a light sleep
point) — these optimise *when to ring within a window*, not *what bedtime meets
a reliability target*. Also: bedtime-reminder features (Apple Health, Fitbit),
which use a fixed duration goal rather than model inversion; general
counterfactual-explanation literature (DiCE, Wachter et al.), which is prior art
for the *technique* — the arguable novelty is its application to a wake-time
reliability constraint, not counterfactual explanation itself.

---

## 2. Correctness-gated sequential wake verification

**Files:** `lib/wakeConfidence.ts`, `app/api/alarms/[id]/verify/route.ts`

### Problem

A wake challenge must distinguish *awake* from *acting while asleep*. The
previous additive scoring here demonstrated the failure concretely: a wrong
answer delivered quickly with device motion scored **90**, while a correct answer
given slowly scored a floor of **82**. Motion and speed could substitute for
correctness, so a sleeping user whose phone was jostled could be scored more
awake than one who solved the problem. Three of four configured thresholds were
unreachable as failures.

### Mechanism

A naive-Bayes log-odds accumulator over independent signals, with two
constraints the additive form lacked:

1. **Correctness as a gate, not a weight.** An unsolved challenge is capped at a
   ceiling (35) held below the lowest threshold the scheduler can assign (60), so
   no combination of ancillary signals can satisfy any alarm. Measured over 2000
   randomised unsolved attempts, the maximum achievable score is 17.
2. **Discrimination preserved among correct answers.** Weights are set so correct
   answers span ~40–98, keeping every configured threshold meaningful — a crisp
   solve scores 97, a fumbled one 50.
3. **Sequential evidence accumulation.** Evidence sums across a challenge
   sequence rather than averaging, so two confirmations are stronger than one and
   an early failure is not erased by a later success.
4. **Server-side re-derivation.** The score is recomputed from raw signals at the
   API boundary rather than accepted from the client, since the score is what
   satisfies the alarm. A request asserting `confidence: 99` with `solved: false`
   is re-scored to 13 and rejected.

### What may be distinctive

The gating property — a formal guarantee that an ancillary-signal combination
cannot substitute for task correctness — expressed as a bounded ceiling below all
admissible thresholds.

### Closest art to search

CAPTCHA and liveness detection generally; "prove you're awake" alarm apps
(Alarmy and similar) which require a task but typically apply a binary
pass/fail rather than a graded multi-signal confidence; sleep-inertia measurement
literature (psychomotor vigilance tasks). **A binary task gate is old.** The
arguable contribution is the graded-but-gated combination, which is a narrow
claim at best.

---

## 3. Adaptive minimum-effective escalation

**Files:** `lib/escalation.ts` (`deriveEscalationProfile`,
`personalizeEscalationPlan`), `app/api/metrics/route.ts`

### Problem

A fixed escalation ladder is wrong in both directions. A light sleeper is driven
through vibration and a challenge they never needed; a heavy sleeper spends
35 seconds on levels that have never once woken them.

### Mechanism

1. Record the escalation level at which each alarm was actually resolved.
2. Derive a profile: median effective level, a "reliable" level at the 90th
   percentile plus one rung of margin, and a pace factor.
3. Compress dwell times by the pace factor so a habitual level-4 waker reaches
   the challenge at 21 s instead of 35 s, while a level-1 waker is given *more*
   grace (94 s to backup instead of 75 s).
4. Withhold the emergency-backup blast above the reliable level for ordinary
   alarms — **except** where the alarm is tied to something unmissable, where the
   full ladder including backups is always retained regardless of habit.
5. Fall back to the shared timeline below three samples.

### What may be distinctive

The minimum-effective-dose framing — learning the *floor* that works and
declining to exceed it — combined with a criticality override that suppresses
the personalisation where the cost of failure is high.

### Closest art to search

Adaptive alarm volume ramping (widespread); reinforcement-learning
personalisation of notification intensity; smart-home escalation chains. **This
is the most likely of the three to be anticipated.** Volume ramping that adapts
to user response is a well-populated area.

---

## 4. Supporting technical work (context, probably not claimable)

Recorded because it establishes diligence and may support enablement:

- **Physiologically-structured training data** (`ai-brain/training/dataset_builder.py`).
  Sleep duration is derived mechanically — `time_in_bed − onset_latency −
  fragmentation`, capped by alarm time — over a per-person panel of 340
  simulated sleepers × 46 nights, rather than sampled from a formula. Aggregate
  features are computed with the same trailing-window formulas the production
  app uses, so training and serving distributions match.
- **Grouped evaluation.** Person-level `GroupShuffleSplit` prevents nights from
  one sleeper straddling the train/test boundary. Honest metrics: sleep-duration
  MAE 0.41 h against a 0.74 h baseline; wake-success accuracy 0.724 against a
  0.453 majority-class baseline; AUC 0.785.
- **Distribution-grounded thresholds.** Alert thresholds are set from the
  model's actual score distribution (75th percentile) rather than round numbers.

None of this is likely patentable. It matters because a claim must be *enabled* —
an examiner will want the model to be reproducible.

---

## 5. What to do next, in order

1. **Keep the repository private.** Nothing public until step 3.
2. **Write down conception dates and contributors.** Who conceived each
   mechanism, and when. Inventorship is a legal determination with real
   consequences — get it right, and note that AI assistance does not qualify as
   an inventor under current USPTO guidance (an AI cannot be a named inventor;
   contributions made with AI assistance require a natural person who conceived
   the claimed subject matter).
3. **Engage a patent attorney** with software/ML experience. Bring this
   document, the code, and the test evidence.
4. **Consider a provisional application** if advised. It is comparatively cheap,
   holds a priority date for 12 months, and buys time to assess commercial value
   — but it must be enabling to be worth anything, so file the technical detail,
   not a summary.
5. **Ask explicitly whether a patent is worth it here**, versus trade secret
   plus execution speed. A good attorney will tell you when the answer is no.
