# Pre-registration (draft): does seeing a wake plan help people wake on time?

**Status: draft, written 2026-11-15, before any study data exists.** No participant
has been enrolled and no study code has been issued. This draft is to go to an
ethics committee (DEVELOPMENT_PLAN 8.2) and then to a public registry before the
first enrolment; any change after that is a deviation and will be reported as one.

Consent document: `study-v1` (`lib/studyConsent.ts`). App support: study mode
(prompt 6.2) and per-alarm randomisation (prompt 6.1).

## Background

The method paper (under review) plans the night backwards from a must-wake time
and tells the user the latest bedtime that meets a required chance of waking close
to their usual time. Retrospectively, nights on which participants happened to
sleep near the recommended hour were followed by more regular wakes at every
tolerance, but no interval excluded zero: 9 to 11 participants contributed a
paired difference, and those nights were not randomised. Whether *showing* the plan
changes anything can only be settled by randomising it.

## Hypothesis

**H1.** On nights where the wake plan for the next morning's alarm is shown, the
probability of waking close to one's usual time is higher than on nights where it
is not shown.

Two-sided: a harmful effect is reportable too.

## Design

- **Within-participant, randomised per alarm.** Each alarm a participant sets is
  randomised to *shown* or *not shown* when it is first planned (`wake_plan`
  experiment). Under *not shown*, the app declines to give a plan for that alarm's
  wake time and says it is part of the study. Everything else about the alarm is
  identical.
- **Balanced and reproducible.** Permuted blocks of four (two of each arm) per
  participant, the order drawn from a seeded generator; every assignment is logged
  and can be recomputed from the seed (`lib/randomisation.ts`).
- **Unmissable alarms are never randomised** (an alarm linked to something that
  can't be missed, or needing a strong wake check). They are logged as excluded
  and are not part of the primary analysis.
- **Duration:** each participant takes part for 6 weeks.

## Outcomes

**Primary.** For each randomised alarm, whether the next wake was *regular*: not
more than 30 minutes later than the participant's own habit, the median of up to
28 earlier wake times of the same day type (weekday or weekend), needing at least
3. This is the label of the method paper (`ai-brain/datasets/wake_proxy.py`, ported
to `lib/wakeProxy.ts`). Wake times come from the participant's sleep log (Health
Connect, or entered by them). A night with no wake time, or before a habit exists,
is unlabelled and missing; it is not imputed.

**Secondary** (alarm telemetry, recorded with consent):

1. time from the first ring to the first interaction (ms, per wake);
2. snoozes per wake;
3. the escalation stage reached;
4. whether the wake check was passed, where one was required;
5. sleep duration the night before.

## Estimand and analysis

- **Intention to treat by assigned arm**, whether or not the participant looked at
  the plan.
- **Primary model:** logistic regression by generalised estimating equations,
  clustered by participant (exchangeable working correlation, robust errors):
  `regular ~ arm + weekend + study_week`. The effect is reported as an odds ratio
  and as a risk difference, each with a 95% interval; two-sided α = 0.05.
- **Sensitivity:** a mixed-effects logistic model with a random intercept per
  participant; and the primary model restricted to participants with at least 8
  labelled randomised nights in each arm.
- **Secondary outcomes:** the same structure (linear GEE for times, on the log
  scale; Poisson for snoozes; ordinal or logistic for the stage), reported with
  intervals and without a correction, as secondary.
- No interim analysis and no early stopping for efficacy.

## Sample size

60 participants (the plan's range is 50 to 75). Detecting the paired effect seen
retrospectively, d = 0.33 to 0.40, at 80% power and α = 0.05, needs about 50 to 72
participants (`docs/ablation-matched-results.md`). Randomising per night within
participant should be more efficient than that paired comparison, so 60 is
conservative for those effects; if the true effect is nearer the smallest
retrospective estimate (d = 0.17), no feasible study would detect it, and the
result will be reported as such.

## Exclusions and missing data

- Participants who withdraw are removed entirely: withdrawal deletes their study
  data, so they cannot be analysed. The number who withdraw is reported.
- Participants with no labelled randomised night are excluded from the primary
  model and counted.
- No imputation. Unlabelled nights are missing; the rate per arm is reported.

## Safety

The alarm always rings: the arm changes only whether a bedtime suggestion is shown,
never whether or how loudly an alarm sounds (escalation pacing is a separate
experiment, not part of this study). Unmissable alarms are never randomised.

## Data

The analysis uses the anonymised export (`/api/study/export`): a random
participant code, the consent version, study days rather than dates, local times of
day, the assigned arm, the outcomes above. No names, e-mail addresses, account
identifiers or alarm labels leave the app.
