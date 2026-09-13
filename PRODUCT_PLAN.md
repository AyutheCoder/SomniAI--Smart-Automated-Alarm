# SomniAI — Product Build Plan

Completing the app after the methods paper is submitted, and turning it into the
instrument for a second paper.

Companion to [`BUILD_PLAN.md`](BUILD_PLAN.md) (the paper). Same rules: one prompt
at a time, don't move on until the `Verify` block passes.

**Start this only after the paper is submitted.** February is the scarce
resource; this work is months, and none of it changes the first paper's outcome.

---

## Can this really be two papers?

Yes, if the contributions are genuinely distinct. Reviewers do look for
"salami slicing" — one result split to inflate a publication count — and it is
held against you.

| | Paper 1 (in progress) | Paper 2 (this plan enables) |
| --- | --- | --- |
| Claim | A planning method that knows when it cannot promise | What happens when people actually follow it |
| Evidence | Exhaustive simulation + public cohorts | A deployment study with instrumented alarms |
| Data | LifeSnaps, PMData | Yours, collected here |
| Venue | ICHI / BHI / CBMS | IMWUT, CHI, ICHI |

That is a legitimate split — method first, deployment second — and a common
shape. Paper 2 **must cite Paper 1** and must not re-report its results as new.

A third, smaller output is available immediately: a **demo paper** describing
SomniAI itself. Short, lower bar, still IEEE Xplore, and you have a working
system with a real UI. It needs the app's claims to match the paper's first.

### The blocker to solve early

**A deployment study needs ethics approval, and you have no institution.** This
is the same wall that blocked NSRR data access, and it is now on the critical
path for Paper 2. Three routes, in order of practicality:

1. **Partner with a university.** A named academic co-author brings their IRB.
   Also strengthens the submission. Start these conversations early — they take
   months.
2. **A commercial IRB.** Low thousands of dollars, works for unaffiliated
   researchers, and is accepted by most venues.
3. **Self-experimentation (n=1).** No approval needed in most jurisdictions when
   you are the only subject. Publishable only as a case study, but it validates
   the instrument before you spend money on route 1 or 2.

Route 3 first regardless — it is free, and debugging alarm reliability on
yourself for a month is something you want to do before anyone else relies on it.

---

## Phase A — Make "autonomous" true

The spec promises a system that manages the sleep–wake lifecycle with minimal
interaction. Today the alarm dies when the tab closes. Nothing else in this plan
matters until that is fixed.

- [ ] **A1. Native shell**

  ```
  Wrap the Next.js app in Capacitor and get a minimal Android build installing and running on a physical device, with login working against the existing backend.
  ```

  **Verify:** Installs on real hardware, not the emulator. You can sign in and
  the dashboard renders.

- [ ] **A2. OS-level alarm scheduling**

  ```
  Implement local notification scheduling so every Alarm document is registered with the OS. Schedule on create, reschedule on edit and snooze, cancel on delete and dismiss, with the server as the source of truth.
  ```

  **Verify:** Set an alarm two minutes out, **fully close the app**, confirm it
  fires. This single check decides whether the product is viable.

- [ ] **A3. Full-screen ringing over the lock screen**

  ```
  When an alarm notification fires, launch the full-screen ringing overlay with audio at the configured intensity, the escalation ladder running, and the verification challenge — working from a locked screen.
  ```

  **Verify:** Phone locked, screen off. Alarm fires, UI appears, audio plays,
  solving a challenge dismisses it and records the outcome server-side.

- [ ] **A4. Android reliability**

  ```
  Handle Android alarm reliability: SCHEDULE_EXACT_ALARM on 12+, battery optimisation exemption, Doze behaviour, and rescheduling all alarms after reboot.
  ```

  **Verify:** Survives reboot and battery saver. **Three real overnight tests** —
  eight hours of idle is where Doze problems appear and nothing shorter reveals
  them.

- [ ] **A5. iOS, and its honest limits**

  ```
  Add iOS notification support with the permission flow, and document precisely what iOS will and will not allow — critical alerts entitlement, silent mode, Focus.
  ```

  **Verify:** Overnight test on physical hardware. Write down observed behaviour
  in silent mode and Do Not Disturb; this becomes store copy, and overpromising
  here gets apps rejected.

- [ ] **A6. Sensor challenges on real hardware**

  ```
  Get shake and QR verification working reliably on both platforms, including the iOS devicemotion permission request and camera permissions, with the existing fallbacks intact.
  ```

  **Verify:** All four challenge types complete on real devices, both platforms.
  Deny camera permission and confirm the manual-code fallback still works.

---

## Phase B — Kill every mock

The spec leans on inputs the app currently fabricates. Each of these replaces a
`(mock)` string or a `Math.random()` with something real.

- [ ] **B1. Real emergency contact**

  ```
  Replace the mocked emergencyContact channel in lib/backupAdapters.ts with a real Twilio integration — SMS first, escalating to a voice call — using the contact already on the User model.
  ```

  **Verify:** A real SMS and a real call to your own number.
  `emergencyContacted` reflects the send result, not a client assertion.

- [ ] **B2. Real calendar**

  ```
  Add Google Calendar OAuth and wire real events into lib/context/calendar.ts, replacing simulateCalendar, with token refresh and revocation handling. Feed event titles into the existing semantic engine.
  ```

  **Verify:** Your own events appear and are semantically classified. Revoke
  access in Google settings; the app degrades cleanly.

- [ ] **B3. Real wearable data**

  ```
  Add Health Connect (Android) and HealthKit (iOS) read-only integrations to replace lib/context/wearable.ts, pulling heart rate, steps and sleep.
  ```

  **Verify:** Real values on device, `source` reads `live`. Deny permission and
  the simulated fallback engages *and is labelled as simulated in the UI*.

- [ ] **B4. Screen-usage tracking**

  ```
  Add screen-usage collection to enable the spec's bedtime detection and sleep-disruption score, using platform usage-stats APIs with explicit opt-in.
  ```

  **Verify:** Late-night screen minutes populate `screen_minutes_before_bed` —
  one of the seven controllable levers the planner has never had real data for.

- [ ] **B5. Remaining backup channels**

  ```
  Implement the secondary-device alarm via push to a second signed-in device, and either implement or clearly retire the smart-light and smart-speaker channels.
  ```

  **Verify:** No path returns fabricated data presented as real. Anything not
  implemented says "unavailable", not a fake success message.

---

## Phase C — Finish the spec

- [ ] **C1. Missing verification methods**

  ```
  Add the memory challenge and walking-steps verification from the spec, scored through the existing wake-confidence gate.
  ```

  **Verify:** Both integrate with `computeWakeConfidence` rather than bypassing
  it. The unsolved-challenge ceiling still holds — re-run the gate tests.

- [ ] **C2. Pre-wake relaxation**

  ```
  Implement the pre-wake relaxation stage that opens the spec's multi-stage pipeline but does not exist in lib/escalation.ts.
  ```

  **Verify:** Fires before the alarm, is skippable, and never delays the alarm
  itself.

- [ ] **C3. Honest AI surfaces**

  ```
  Audit every place the UI presents a model prediction and make the copy match what the paper established: rename the wake-success surface to wake-time regularity, and distinguish AI-Brain output from fallback rules.
  ```

  **Verify:** No screen implies clinical accuracy or claims the app predicts
  whether waking "went well". This is a prerequisite for a demo submission.

---

## Phase D — Turn the app into a research instrument

**This is what makes Paper 2 possible, and it is the part a generic product plan
would omit.** Every public sleep dataset lacks `snooze_count` and
`alarm_response_ms` because no consumer device instruments the alarm. Yours will.

- [ ] **D1. Consented telemetry**

  ```
  Design an opt-in telemetry pipeline with a clear consent flow, capturing alarm outcomes, snooze counts, alarm response latency, verification results and escalation levels reached.
  ```

  **Verify:** Consent is genuinely informed and revocable, data export and
  deletion work, and nothing is collected before consent. Ethics review will
  examine exactly this.

- [ ] **D2. Randomisation support**

  ```
  Add the ability to randomise wake strategy or escalation pacing per alarm, logged with the assignment, so a deployment study can make causal rather than correlational claims.
  ```

  **Verify:** Assignment is logged, balanced, and never applied to alarms the
  user marked unmissable. **This is the single feature that separates an
  observational study from a randomised one** — and it is the difference between
  a mid-tier and a top-tier venue.

- [ ] **D3. Retrain on real data**

  ```
  Retrain the shipped models on LifeSnaps and PMData using the pipeline from the paper, replacing the synthetic panel, and wire the datasets cache into the training path.
  ```

  **Verify:** The app's predictions come from real-data-trained models. Report
  the honest metrics in-app rather than the synthetic ones.

- [ ] **D4. Close the habit partition**

  ```
  Once telemetry is flowing, add snooze_count and alarm_response_ms as real features and re-run the planner evaluation with the habit partition complete.
  ```

  **Verify:** 4 of 4 habit features populated — the first time the infeasibility
  attribution runs on its full intended input set. Compare against the 2-of-4
  results in the paper.

---

## Phase E — Ready for other people

- [ ] **E1. Rate limiting** on registration and login, with tests.
- [ ] **E2. `/security-review`** and fix what it finds.
- [ ] **E3. Error tracking and uptime monitoring** for app and AI Brain.
- [ ] **E4. Privacy policy and terms** covering sleep, calendar, wearable,
      contact and screen-usage data — plus deletion and export flows the stores
      require.
- [ ] **E5. Failure-mode tests** — AI Brain down, database down, network lost
      mid-alarm, notification permission revoked after scheduling. **The alarm
      must still ring; local scheduling cannot depend on the network.**

---

## Phase F — The deployment study

- [ ] **F1. Dogfood for a month.** SomniAI as your only alarm. Log every
      failure and near-miss. A backup phone alarm invalidates the test.
- [ ] **F2. Secure ethics approval** by one of the three routes above.
- [ ] **F3. Run the study.** 15–30 participants, 4+ weeks, randomised where D2
      allows. Pre-register the analysis.
- [ ] **F4. Write Paper 2**, citing Paper 1 for the method.

---

## Suggested additions that would strengthen Paper 2

Beyond the spec, ordered by research value:

**Show the refusal to the user, and measure what they do.** The paper's
contribution is a system that declines to promise. Nobody knows whether people
*trust* a system that says "not at this reliability — set a backup". Instrument
it: do they set the backup? Do they trust the system more or less afterwards?
That is a genuine HCI contribution and no dataset can answer it.

**Release the dataset.** An instrumented alarm-response dataset would be the
first of its kind, since no public sleep corpus contains it. Reviewers value
data releases highly, and it makes Paper 2 citable well beyond its own claims.

**On-device personalisation.** The LinUCB policy is already per-user and
serialises to JSON. Keeping it on-device rather than server-side is a privacy
story that is currently fashionable and cheap for you to implement.

**Counterfactual logging.** Record what the planner *would* have recommended
even when the user ignores it. That is exactly the counterfactual Paper 1 could
not observe, and collecting it turns the untestable claim into a testable one.

---

## Rules

- **Finish the paper first.** None of this changes Paper 1's outcome.
- **A mock that looks real is worse than a missing feature.** If it isn't
  implemented, the UI says so.
- **Never skip an overnight test.** Alarm bugs only appear after hours of idle.
- **Failed-to-fire is the only metric that matters.** Everything else is a
  feature; this is the product.
