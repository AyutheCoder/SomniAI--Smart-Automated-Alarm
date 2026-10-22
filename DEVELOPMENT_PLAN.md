# SomniAI — Development Plan

Turning SomniAI from a web demo into an alarm people can actually trust with an
exam, a flight or an interview. Written 2026-10-22 from a fresh study of the
code, not from the September `PRODUCT_PLAN.md`, which this replaces.

---

## How to use this

1. Give me **one prompt at a time**, in order. Copy the text in the box exactly.
2. Every prompt ends with the **verification gate** (Part 4). I run it and report
   pass/fail counts. **Red means not done** — we fix it before moving on.
3. Some behaviour can only be proven on a real phone (an alarm ringing through a
   locked screen cannot be unit-tested). Those prompts say so and give you a
   short checklist to run on the device. That is part of the gate, not optional.
4. Each finished prompt is one commit on the `develop` branch.

If you only get partway, stop at a phase boundary. Each phase leaves the app in a
better, working state.

---

## Part 1 — What I found

### The one thing that matters most

**The alarm only rings if a browser tab is open and the device is awake.**

`app/page.tsx` checks for due alarms with a `setInterval` running inside the page,
and the sound comes from Web Audio in that same page. Close the tab, lock the
phone, or let the browser get suspended — which phones do aggressively at night —
and nothing rings. The service worker (`public/sw.js`) only caches pages; it
schedules nothing.

For an alarm whose entire promise is *"you will not oversleep"*, this is the gap
that outranks every other. Phase 2 exists to close it.

### Baseline, measured today

| Check | Result |
| --- | --- |
| TypeScript unit tests (vitest) | **70 passed**, 3 files |
| Typecheck (`tsc --noEmit`) | **clean** |
| Lint | **0 errors, 11 warnings** |
| AI Brain tests (pytest) | **283 passed**, 28 skipped (need the LifeSnaps download), 4 slow deselected |
| Production build (`next build`) | **fails** on the original machine — a stray `package-lock.json` in a parent directory confuses Next's workspace root, then a Windows `EPERM` |
| API route tests | **none** — 22 routes, zero tests |
| End-to-end tests | **none** |
| CI | **none** |

### Real, simulated, or fake

| Part | State |
| --- | --- |
| Accounts, alarms, tasks, sleep logs (MongoDB) | real |
| Task understanding (`ai-brain/semantic.py`) | real, rule + TF-IDF tiers |
| Wake plan (the paper's method) | real |
| Escalation ladder and personalisation | real logic, web-only |
| Wake verification scoring | real, server-checked |
| **Alarm firing** | **works only with the tab open** |
| Weather | live when location is given, simulated otherwise |
| Calendar | **simulated** (`simulateCalendar`) |
| Wearable / sleep data | **simulated** (`simulateWearable`) |
| Screen-time sensor | browser-tab visibility only, simulated fallback |
| Motion / mic sensors | real when the browser allows, **silent simulated fallback** |
| Backup alarms (second device, watch, lights, speaker, emergency contact) | **all fake** — they print "Triggered…" and send nothing |
| Shipped ML models | trained on the **synthetic** panel the paper showed overstates predictability ~4× |
| "Wake success" in the UI | named for a target the paper showed measures nothing about how people felt |

The fake backup adapters are the most dangerous item after the firing gap: the app
*tells the user* a backup fired when nothing happened. Someone relying on that for
a flight would be worse off than with no backup at all.

### Coordination

PR #1 was merged upstream, but nothing from `PRODUCT_PLAN.md` has been built —
upstream has no product commits. So there is nothing to conflict with. Agree
between you who owns which phase before starting; this plan replaces the old one.

---

## Part 2 — What the finished app does

### Core (from the original idea)

1. **Understands your tasks.** "Final exam tomorrow 9am" → critical, must not miss.
2. **Schedules its own alarm** from task importance and your sleep pattern.
3. **Plans your night backwards.** "To be up at 5:40 with 90% reliability, sleep by
   22:15." And when that's impossible, it says so, tells you the best you can
   reach, and why. (This is the paper's method, finally put in front of users.)
4. **Wakes you in stages** — volume, vibration, challenge, backup — and learns the
   gentlest level that actually works on you, except on unmissable alarms.
5. **Checks you're really awake** — maths, typing, shake, QR across the room —
   and a wrong answer can never be outweighed by phone movement.

### My recommended additions

These are the features I think matter most, in order:

1. **It rings no matter what.** Locked screen, silent mode, Do Not Disturb, app
   closed, phone rebooted, no internet. Done natively on Android. Nothing else on
   this list is worth building until this is true.

2. **Bedtime pre-flight check.** Most real missed alarms are not the alarm's fault —
   battery optimisation killed it, volume was zero, the phone was at 4%, a
   manufacturer's "battery saver" blocked it. Before your planned bedtime, the app
   checks all of it and gives one-tap fixes. **This matters especially in India**,
   where Xiaomi, Realme, Oppo and Vivo phones ship with aggressive app killers
   that silently stop alarms. I'd call this the single most useful feature you
   can add, and almost no alarm app does it properly.

3. **Wake buddy.** Pair with a friend. If you don't verify within N minutes of a
   critical alarm, their phone gets a push and they can call you. Real
   accountability, cheap to build (Firebase push is free), and it replaces the
   fake "emergency contact" with something that actually works.

4. **Morning report.** What woke you, how long it took, whether you followed last
   night's plan. Turns the escalation learning from invisible to something users
   see and trust.

5. **Alarm telemetry, with consent.** Native code can measure exactly what no
   public dataset contains — how long you take to respond and how often you
   snooze. That's the empty half of the paper's habit partition. It makes the
   predictions personal and it's the data Paper 2 needs.

### What I'd cut

- **Smart lights and smart speaker backups.** Real integrations need specific
  hardware and accounts per brand. Faking them is worse than not offering them.
  Remove from the UI; revisit only if you have the hardware.
- **iOS, for now.** See Part 3.
- **The `/simulator` page in production.** Keep it as a developer tool behind a
  flag.

---

## Part 3 — Architecture decisions

**1. The alarm must never depend on the network at ring time.** Everything needed
to ring and be dismissed — time, sound, escalation plan, challenge — is stored on
the phone when the alarm is created. If the AI Brain, the database or the
internet is down at 5:40am, the alarm still rings and can still be dismissed. The
server makes alarms smarter; it is never on the critical path of waking you.

**2. Native code owns ringing; the web app owns everything else.** Capacitor wraps
the existing Next.js app, and a small custom Android plugin uses
`AlarmManager.setAlarmClock()` (exact, Doze-exempt), a foreground service playing
on the **alarm** audio stream, and a full-screen intent over the lock screen.
A minimal native challenge lets the alarm be dismissed even if the web view
cannot load. This keeps native code small and the rest of the app reusable.

**3. Android first. iOS needs a Mac.** iOS apps can only be built with Xcode on
macOS, and you are on Windows, so iOS cannot be built or tested on this machine
at all. When you have Mac access, the route is Apple's AlarmKit (iOS 26+), which
is the first API that lets a third-party app ring like the built-in clock. Until
then, Android only — and say so honestly in the app listing.

**4. Real data or nothing.** No simulated value ever silently feeds a prediction.
If a source isn't connected, the feature says "not connected", and the model uses
only what's real.

**5. Deployment:** Next.js on Vercel, the AI Brain on Render or Railway (the
`Dockerfile` already exists), MongoDB Atlas (already used), Firebase Cloud
Messaging for pushes. All have free tiers sufficient for development and a small
study.

---

## Part 4 — The verification gate

Prompt 0.2 creates two commands. **Every prompt after that ends by running them.**

| Command | Runs |
| --- | --- |
| `npm run verify` | lint (zero warnings allowed), typecheck, unit + API tests, production build |
| `npm run verify:all` | all of the above, plus AI Brain pytest, plus Android unit tests and debug build once Phase 2 exists |
| `npm run e2e` | Playwright end-to-end flows (from 0.4) |

A prompt is **done** only when:

1. `verify:all` is green, with counts reported (e.g. "92 passed, 0 failed").
2. The new work has **its own tests** — a feature without a test is not done.
3. Any device-only behaviour has been run on a real phone and recorded in
   `DEVICE_TESTS.md` with the date, phone model and Android version.
4. Nothing reports success for something that didn't actually happen.

If a test fails, I fix the cause, not the test — unless the test itself is wrong,
in which case I'll say so explicitly and explain why.

---

## Part 5 — The prompts

### Phase 0 — Make change safe

Nothing user-visible. Without this, every later change is a guess.

#### 0.1 Housekeeping and a working build

```
Create a develop branch from main. Get the production build working on this machine: run next build and fix whatever stops it. On the original machine it failed because a package-lock.json in a parent directory made Next.js pick the wrong workspace root (fix with outputFileTracingRoot, never by deleting files outside the repo without asking me) and then hit an EPERM error on Windows; check whether either happens here. Fix all 11 lint warnings. Migrate off the deprecated `next lint` to the ESLint CLI. Then run lint, tsc, vitest and next build and report each result.
```

**Gate:** `next build` succeeds; lint 0 errors 0 warnings; tsc clean; 70+ tests pass.

#### 0.2 One command that checks everything

```
Add npm scripts verify (lint with --max-warnings 0, tsc --noEmit, vitest run, next build) and verify:all (verify plus the AI Brain pytest suite). Make them fail loudly on any error and print a short summary of counts at the end. Document them in README.md. Run both and report the counts.
```

**Gate:** both commands green, counts reported.

#### 0.3 Tests for every API route

```
There are 22 API routes and no tests for any of them. Add integration tests using mongodb-memory-server so tests never touch the real Atlas database. For every route cover: unauthenticated request rejected, invalid input rejected with a clear error, the happy path, and ownership — user A must never be able to read, change or delete user B's alarms, tasks, sleep logs or events. Expect to find real bugs; when you do, fix the route and tell me what was wrong. Add the tests to npm run verify.
```

**Gate:** every route has tests; ownership tests pass for every resource; bugs found are listed with fixes.

#### 0.4 End-to-end harness

```
Add Playwright. Write one end-to-end flow against a local dev server with an in-memory database: sign up, create an alarm one minute ahead, wait for the ringing overlay, solve the maths challenge, dismiss, and confirm the alarm shows as dismissed in history. Add a second flow for a wrong answer: the alarm must not dismiss. Add npm run e2e and make it run headless.
```

**Gate:** both flows pass headless, three runs in a row (flaky = not done).

#### 0.5 Continuous integration

```
Add a GitHub Actions workflow that runs npm run verify, the pytest suite and the Playwright flows on every push and pull request to develop and main. Cache dependencies. Secrets must not be needed for tests. Push and show me the run result.
```

**Gate:** green run visible on GitHub.

---

### Phase 1 — An honest web core

The app stops claiming things that aren't true, and stops depending on the
server when it rings.

#### 1.1 Remove fake success

```
lib/backupAdapters.ts reports "Triggered a backup alarm…" for channels that send nothing. Replace this with a typed BackupChannel interface where every channel returns one of delivered, failed or not_configured, and only a real delivery can return delivered. Remove smart lights and smart speaker from the UI entirely. In the UI, an unconfigured channel must say "not set up", never imply it fired. Add tests proving no code path returns delivered without a real delivery.
```

**Gate:** standard, plus a test that fails if any adapter returns `delivered` without a send.

#### 1.2 Honest context sources

```
Calendar and wearable data are simulated and feed predictions silently. Make every context value carry its source (live, simulated, missing). Simulated values must never reach a model input in production; the model uses only live values and treats the rest as missing. Show the user which sources are connected. Default weather to live when location is granted. Add tests that a production prediction request never contains a simulated value.
```

**Gate:** standard, plus the "no simulated input" test.

#### 1.3 Honest AI wording

```
Rename the user-facing "wake success" to "wake-time regularity" everywhere, to match what the paper established the label measures. Wherever the UI shows a prediction, show whether it came from the AI Brain or the fallback rules, and show a confidence the user can understand. Remove any wording that implies clinical accuracy or that the app knows whether waking "went well". Add tests on the rendered text.
```

**Gate:** standard; grep shows no remaining user-facing "wake success".

#### 1.4 Alarms that don't need the server to ring

```
Make every alarm record self-contained: time, sound, strategy, the full escalation plan, challenge configuration and criticality, all computed when the alarm is created. If the AI Brain is unreachable at creation, fall back to the rule-based plan and record that it did. Nothing at ring time may call the server. Add tests with the AI Brain down and with the database down at ring time.
```

**Gate:** standard, plus the two outage tests.

#### 1.5 Put the wake plan in front of users

```
Make WakePlanPanel the centre of the evening flow: pick a must-wake time and a reliability, and show the latest bedtime, the smallest set of changes, or — when infeasible — the honest refusal with the reachable ceiling, the habit holding it back, and a recommendation to set a second alarm. Add a bedtime reminder at the planned time (web notification for now; native in Phase 2). Test the feasible case, the infeasible case, and the exact-ceiling boundary.
```

**Gate:** standard, plus all three plan cases tested.

**After Phase 1:** a web app that never lies to its user. It still only rings with the tab open.

---

### Phase 2 — A real Android alarm

The phase that makes this an alarm clock. Needs an Android phone with USB
debugging, and Android Studio installed.

#### 2.1 Toolchain and Capacitor shell

```
Check what Android tooling is installed (JDK, Android SDK, platform tools, an emulator) and tell me exactly what to install if anything is missing — don't guess at paths. Add Capacitor and the Android platform. Decide whether the shell loads the deployed URL or bundled assets, explain the trade-off, and document the decision. Produce a debug APK that installs and opens on the emulator. Add the Android unit tests and debug build to verify:all.
```

**Gate:** `assembleDebug` succeeds; APK runs on emulator; **you** confirm it opens on your phone.

#### 2.2 Native alarm scheduling

```
Write a Capacitor plugin that schedules alarms with AlarmManager.setAlarmClock. Handle the exact-alarm permission properly for every Android version from 8 upward, using the alarm-clock-app permissions Google Play allows for this category. Store scheduled alarms natively so they survive the app being killed. Reschedule on reboot, time change, timezone change and app update. Write JVM unit tests for the scheduling maths, including daylight-saving transitions and alarms set across midnight. Check current Android documentation for each permission rather than relying on memory.
```

**Gate:** Android tests pass. **Device:** alarm set 2 minutes ahead fires with the app force-stopped; survives a reboot.

#### 2.3 Ringing like a real alarm

```
When an alarm fires: start a foreground service with the correct Android 14+ foreground-service type, play sound on the alarm audio stream with a volume ramp, vibrate, hold a wake lock, and show a full-screen intent over the lock screen. It must ring in silent mode and with Do Not Disturb on. Stop cleanly on dismissal. Write tests for the service lifecycle. Then give me a device checklist.
```

**Gate:** tests pass. **Device:** rings on a locked screen, in silent mode, with DND on.

#### 2.4 Dismiss without the internet

```
Add a small native challenge (maths, using the same gating rule as lib/wakeConfidence.ts: a wrong answer can never dismiss) so the alarm can be verified and dismissed with no network and without the web view. Queue the result and sync it when the network returns. Test the gating rule natively against the same cases as the TypeScript tests, and test the offline queue.
```

**Gate:** native gating tests mirror the TS ones. **Device:** dismiss in airplane mode; result appears in history after reconnecting.

#### 2.5 One source of truth

```
Keep the web app and the native schedule in sync: creating, editing, disabling or deleting an alarm in the app must update the native schedule, idempotently, and the native side must reconcile on every app start. Define what happens on conflict and document it. Test create, edit, delete, duplicate calls and reconcile-after-crash.
```

**Gate:** standard plus sync tests. **Device:** edit an alarm, lock phone, it fires at the new time.

#### 2.6 Escalation in native code

```
Run the five-stage escalation ladder natively — volume, vibration, challenge, backup — using the personalised plan cached on the device, so it works offline. Unmissable alarms always use the full ladder. Test stage timing and the unmissable override.
```

**Gate:** tests pass. **Device:** leave an alarm ringing and confirm each stage happens at the expected time.

#### 2.7 The device test matrix

```
Create DEVICE_TESTS.md with a matrix of conditions: screen locked, silent mode, DND, battery saver, rebooted overnight, timezone changed, app force-stopped, airplane mode, battery under 15%, and the manufacturer's own battery manager. Walk me through running each on my phone, record the results, and fix every failure. If you can, list which conditions need a Xiaomi, Realme, Oppo or Samsung phone to test properly.
```

**Gate:** every row passes on your phone, recorded with phone model and Android version.

**After Phase 2:** a real alarm. This is the minimum for anyone to rely on it.

---

### Phase 3 — Reliability features

#### 3.1 Bedtime pre-flight check

```
Before the planned bedtime, check everything that silently breaks alarms: exact-alarm permission, battery-optimisation exemption, manufacturer autostart and battery managers (with per-brand instructions for Xiaomi, Realme, Oppo, Vivo, Samsung, OnePlus), alarm volume above zero, Do Not Disturb settings, and battery level and charging. Show a clear pass/fail list with a one-tap fix for each. Test the decision logic for every check; give me a device checklist for the rest.
```

**Gate:** logic tests pass. **Device:** each failing setting is detected and its fix works.

#### 3.2 Wake buddy

```
Let a user pair with another SomniAI user, with explicit consent on both sides and the ability to unpair anytime. If a critical alarm is not verified within a set number of minutes, send the buddy a Firebase push saying their friend hasn't woken, with a button to call them. Rate-limit it and never send for ordinary alarms unless the user opts in. Tell me exactly what Firebase setup you need from me. Test pairing, consent, unpairing, the trigger timing and the rate limit.
```

**Gate:** tests pass. **Device:** two phones, a missed critical alarm notifies the buddy.

#### 3.3 Real backup channels

```
Replace the remaining fake backups with real ones: ring a second device the user owns via Firebase, and the wake buddy from 3.2. For an emergency contact, explain the options (Twilio SMS, the phone's own SMS app, or a call intent), their cost and Play Store restrictions, and recommend one before building it. Each channel must report delivered, failed or not_configured truthfully. Test each.
```

**Gate:** tests pass. **Device:** each configured channel actually reaches its target.

#### 3.4 Morning report

```
After each alarm, show a short report: which stage woke you, how long verification took, whether you followed last night's plan, and your streak. Use it to update the escalation profile. Test the report contents for a gentle wake, a fully escalated wake, and a missed alarm.
```

**Gate:** standard.

---

### Phase 4 — Real data instead of simulations

#### 4.1 Google Calendar

```
Connect Google Calendar read-only, building on the existing Google sign-in with incremental authorisation. Turn upcoming events into tasks, scored by the semantic engine. Handle revoked access, token refresh and an empty calendar. Tests use recorded fixtures, never my real calendar. Tell me what to enable in Google Cloud Console.
```

**Gate:** standard. **Device/manual:** a real event appears as a task.

#### 4.2 Health Connect sleep data

```
Read sleep sessions and resting heart rate from Android Health Connect, with its permission flow, into SleepLog. Handle no data, partial nights and multiple sessions in one night (fold to the longest, as the paper did). Test with fixtures.
```

**Gate:** standard. **Device:** last night's sleep appears.

#### 4.3 Real pre-sleep screen time

```
Measure screen time in the hours before bed natively with UsageStatsManager, behind its special-permission flow, and feed it to the feature pipeline. Explain to the user why it's asked for. Test the windowing and the no-permission path.
```

**Gate:** standard. **Device:** value matches Android's Digital Wellbeing roughly.

#### 4.4 Retire the simulators

```
Remove simulateCalendar, simulateWearable and the sensor simulator fallbacks from every production code path. Keep them only behind the /simulator developer page, which must be disabled in production builds. Add a test that fails if any production module imports a simulator.
```

**Gate:** standard, plus the import guard test.

---

### Phase 5 — Intelligence on real data

#### 5.1 Consented alarm telemetry

```
With explicit, revocable consent, record natively: time from ring to first interaction, snooze count, stage reached, and verification result. Nothing is collected before consent. Users can export and delete everything. This is the habit data no public dataset has, so make it accurate: test the timing capture and the consent gate.
```

**Gate:** standard, plus a test that nothing is stored without consent.

#### 5.2 Retrain the shipped models on real data

```
Replace the synthetic-trained models the app ships with models trained on LifeSnaps and PMData through the paper's pipeline. Publish honest metrics in a model card and show them in the app instead of the synthetic ones. Do not change the research pipeline's results: after you finish, run ai-brain/reproduce.py and confirm every paper number still matches.
```

**Gate:** `reproduce.py` passes unchanged; model card committed.

#### 5.3 Personal models

```
Once a user has enough of their own nights and telemetry, personalise predictions to them, with uncertainty that honestly reflects how little data a single person has. Before that threshold, use the population model and say so. Test the threshold, the fallback, and that uncertainty shrinks as data grows.
```

**Gate:** standard.

---

### Phase 6 — Research instrument for Paper 2

#### 6.1 Randomisation

```
Support randomising one aspect of waking per alarm — escalation pacing, or whether the wake plan is shown — with the assignment logged. Never randomise an alarm marked unmissable. Assignments must be balanced and reproducible from a seed. Test balance, logging and the unmissable exclusion.
```

**Gate:** standard.

#### 6.2 Study mode

```
Add a study mode: enrolment by code, a versioned consent document, withdrawal at any time with data deletion, and an anonymised export for analysis. Write a short pre-registration draft describing the hypothesis, the outcome and the analysis before any data exists. Test enrolment, withdrawal and that exports contain no names or emails.
```

**Gate:** standard. Then take it to your institution's ethics committee before enrolling anyone.

---

### Phase 7 — Ready for other people

#### 7.1 Security

```
Add rate limiting to sign-up, sign-in and every write endpoint. Audit input validation and auth on every route. Make sure no secret is in the repo or the client bundle. Then run /security-review and fix everything it finds. Report what was found.
```

**Gate:** standard; security review findings all resolved or explicitly accepted.

#### 7.2 Privacy and terms

```
Write a privacy policy and terms covering sleep, calendar, health, screen-time and telemetry data, and the wake buddy. Add in-app data export and account deletion that really deletes. Prepare the answers for Google Play's Data Safety form. Test that deletion removes every record for that user.
```

**Gate:** standard, plus the full-deletion test.

#### 7.3 Monitoring and failure modes

```
Add error tracking for the app and AI Brain, and uptime monitoring for the AI Brain. Write failure-mode tests: AI Brain down, database down, network lost mid-request. In every case alarms must still ring and the user must see a clear message, not a crash.
```

**Gate:** standard, plus the three failure tests.

#### 7.4 Deploy

```
Deploy the Next.js app to Vercel, the AI Brain to Render or Railway using the existing Dockerfile, and use MongoDB Atlas. Separate staging and production. Point the Android app at production. Tell me every account and secret you need from me before you start.
```

**Gate:** staging and production both healthy; e2e flows pass against staging.

#### 7.5 Play Store internal testing

```
Prepare a release: signing key (and tell me how to back it up safely), the permission declarations Google Play requires for exact alarms and full-screen intents with the alarm-clock justification, store listing, screenshots, and the Data Safety form. Release to the internal testing track.
```

**Gate:** build accepted on the internal track; installs from Play on your phone.

---

### Phase 8 — Prove it works

#### 8.1 Dogfood

```
Help me set up a 30-night dogfooding log: both of us use SomniAI as our only alarm. Record every miss, every false alarm and every annoyance in DOGFOOD.md, and turn each real failure into a test and a fix.
```

#### 8.2 Ethics and pilot

Take 6.2's consent and pre-registration to your institution's ethics committee. Once
approved, run a pilot of 50–75 participants — the number the paper's matched
analysis says is needed to detect the observed effect. That study is Paper 2.

---

## Part 6 — Rules

- **One prompt at a time.** Each one's gate protects the next.
- **Red is not done.** No moving on with a failing check.
- **A feature without a test is not done.**
- **Nothing reports success it didn't achieve.** No fake "triggered", no
  simulated value presented as real.
- **The alarm never waits on the network.**
- **Device-only behaviour is checked on a real phone** and recorded.
- **Don't touch the research pipeline** (`ai-brain/datasets`, `ai-brain/evaluation`,
  `paper/`) except in 5.2, and re-run `reproduce.py` afterwards.
- **Commits are yours.** Authored as you, with no AI co-author line.

---

## What you'll need

| Item | When | Cost |
| --- | --- | --- |
| An Android phone with USB debugging | Phase 2 | — |
| Android Studio + JDK | Phase 2 | free |
| A second, cheap Xiaomi/Realme/Oppo phone (ideal, not required) | 2.7, 3.1 | borrow one |
| Firebase project | 3.2 | free tier |
| Google Cloud project (Calendar API) | 4.1 | free |
| Vercel, Render/Railway, Atlas | 7.4 | free tiers |
| Google Play developer account | 7.5 | one-time USD 25 |
| Twilio (only if chosen in 3.3) | 3.3 | pay per SMS |
| A Mac, for iOS | later | — |

## Rough size

Phases 0–1: about a week of prompts. Phase 2: one to two weeks, mostly device
testing. Phases 3–4: two weeks. 5–7: two to three weeks. Phase 8 is calendar
time, not effort.

**Phases 0–3 are the version worth handing to a friend**: an alarm that rings no
matter what, never lies, warns you before bed when something will stop it, and
gets a friend to call you if you don't wake.

---

## How this maps to the old `PRODUCT_PLAN.md`

| Old | New |
| --- | --- |
| A1–A6 native shell, alarms, sensors | Phase 2 (2.1–2.7) |
| B1 emergency contact, B5 backups | 1.1, 3.2, 3.3 |
| B2 calendar, B3 wearable, B4 screen | 4.1, 4.2, 4.3 |
| C1 verification, C2 pre-wake | folded into 2.4, 2.6 |
| C3 honest AI surfaces | 1.3 |
| D1 telemetry, D2 randomisation, D3 retrain, D4 habit partition | 5.1, 6.1, 5.2, 5.1 |
| E1–E5 hardening | 7.1–7.3 |
| F1–F4 study | Phase 8 |
| — (new) | 0.x safety net, 1.4 offline core, 3.1 pre-flight, 3.2 wake buddy, 3.4 morning report |
