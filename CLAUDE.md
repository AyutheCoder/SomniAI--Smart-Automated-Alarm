# CLAUDE.md — SomniAI

Loaded automatically by Claude Code at the start of every session. It carries the
context a new machine does not have. Keep it current: update **Progress** after
every finished prompt.

## What this is

SomniAI is an alarm app: a Next.js 15 / React 19 / TypeScript web app on MongoDB
with NextAuth, plus a Python FastAPI service ("AI Brain", `ai-brain/`) using
scikit-learn. It reads tasks, schedules its own alarms, plans the night backwards
from a must-wake time with an explicit "this is not reachable" verdict, escalates
in stages, and verifies the user is awake before dismissing.

A methods paper on the planning algorithm is written and under review. The
current job is **developing the app**, following `DEVELOPMENT_PLAN.md`.

## The job

Execute `DEVELOPMENT_PLAN.md` **one prompt at a time, in order**. The human pastes
each prompt. Each prompt ends with its verification gate (plan, Part 4). Red is
not done: fix the cause before moving on, and never weaken a test to make it pass
unless the test is genuinely wrong, in which case say so explicitly.

Read `DEVELOPMENT_PLAN.md` Part 1 before the first prompt. Its central finding:
**alarms currently ring only while a browser tab is open**, because firing is a
`setInterval` in `app/page.tsx` and sound is Web Audio in that page. Phase 2
fixes it natively on Android.

## Progress

| | |
| --- | --- |
| **Next prompt** | **5.2** Retrain the shipped models on real data |
| Last completed | 5.1 (alarm telemetry with consent, and a native snooze (the tester chose to add one: the phone had none, so a snooze count would always have been 0). Snooze: **Snooze 5 min** on the ring screen, not for unmissable alarms; re-arms the alarm's own AlarmManager entry (`AlarmRecord.snoozedUntil`, kept by reschedules), sends `fire` + `snooze` like the web; `toNativeAlarm` now always gives the phone an alarm's own time (`snoozedFrom`), as a snooze time at minute precision could cancel the phone's snooze ring. Telemetry (`WakeTelemetry.java`, pure): per wake, each ring's time to first interaction on `elapsedRealtime` from the event's own timestamp, snoozes, stage reached, the check's result; nothing recorded without consent at ring start; withdrawing or deleting drops the phone's unsent wakes. Server (`lib/telemetry.ts`): stored only if consent is on, same version (`lib/telemetryConsent.ts`, telemetry-v1), given before the wake began, and after the last deletion; export and delete; home page panel `TelemetryPanel`. Plugin API 7. Device checks not run yet (`DEVICE_TESTS.md` 5.1). Before it, 4.4 (simulators retired: everything made up is in `lib/simulators/` (context: weather, calendar, wearable; sensors: motion, mic, screen), imported only by `app/simulator/page.dev.tsx` and `app/api/dev/simulated-context/route.dev.ts`; `next.config.ts` takes `.dev.ts(x)` only in `PHASE_DEVELOPMENT_SERVER`. `buildContextData` lost `simulate`, `/api/context` refuses it (422); the real sensors refuse (`SensorUnavailable`) where they used to start a random-number simulator, also on a refused permission. Simulator links only when `NODE_ENV` is development. `tests/simulator-guard.test.ts` fails on any production import of a simulator or dev file, or a simulator defined elsewhere, and tests its own checker; `npm run verify`'s build step fails if `.next/app-path-routes-manifest.json` has `/simulator` or `/api/dev` (46 routes, none). `e2e/simulator.spec.ts`: the simulator still works under `next dev`. README: the backups and data-source paragraphs were out of date, corrected. Before it, 4.3 (screen time before bed, `ANDROID.md` "Screen time before bed": Usage access (`PACKAGE_USAGE_STATS`), asked for only after the page explains why (`SCREEN_WHY`), then Settings' page; `ScreenUsage.java` reads `UsageStatsManager` events, `ScreenNights.java` (pure) counts foreground time as Digital Wellbeing does (home screen, system UI and the in-call screen left out) in the 3 hours before bed, bed from the sleep log or the phone's own reading (the end of the last use before the night's longest break); a night it can't tell is skipped with a reason, never 0. `POST /api/screen-time` stores minutes per night only (`ScreenNight`); the last week's mean is `screen_minutes_before_bed`, absent without data. Plugin API 6. On the POCO 2026-11-14: first 459 min/day against Digital Wellbeing's 305, the in-call screen (152 min of calls); left out, 306 against 305. The access-off wording claimed predictions left it out while stored nights still counted; fixed. Also fixed: a hydration warning from the shell's safe-area style on `<html>`. Before it, 4.2 (Health Connect, `ANDROID.md` "Health Connect": the phone reads the last 14 days of sleep sessions and resting heart rate (`HealthConnect.java`, connect-client 1.1.0, read-only permissions, Health Connect's own permission screen and SomniAI's explanation page `HealthRationaleActivity` / the `ViewPermissionUsageActivity` alias) and folds them (`HealthNights.java`, pure): one night per wake date in the phone's zone, the longest session kept as the paper's `pmdata.py` does, time asleep from the stages when there are any, a session still recording left for later, resting heart rate the median of that date's readings or none. `POST /api/sleep-logs/import` (`lib/sleepImport.ts`) stores each as that date's SleepLog (`source: health_connect`, with in-bed hours, sessions, the record id), keeps nights typed by hand, updates a night that grew. `resting_hr` for predictions falls back to the latest night's. One fixture, `tests/fixtures/health-connect/fortnight-nights.json`, is checked as the phone's real output by `HealthNightsTest` and used by the server and page tests. Plugin API 5; the Data sources panel connects, reads on open and says what happened. On the POCO (Android 16) 2026-11-14: the permission flow, the explanation page, the empty fortnight and a refused heart rate pass; a real night not run, no app writes sleep there). Before it, 4.1 (Google Calendar, `CALENDAR.md`: its own OAuth step on the sign-in client with `include_granted_scopes` (incremental), scope `calendar.events.readonly`, so it works for email-and-password accounts too and never swaps the session; the refresh token sealed with AES-GCM under `NEXTAUTH_SECRET`; each sync refreshes the access token; `invalid_grant`, a refused token or a missing permission marks it revoked with "Connect again", an outage doesn't; the next 7 days become tasks scored by the semantic engine, moved events update, cancelled ones go unless done; an empty calendar is no tasks. Tests on fixtures in Google's response shapes, never a real calendar. Google refuses its consent screen in the app's web view, so the app says to connect from a browser. With a real account 2026-11-14 (`DEVICE_TESTS.md` 4.1): a real event became a task, moved and deleted ones followed, removed access showed as revoked, disconnect revoked at Google. Found after 3.4: CI's emulators failed two outbox tests that expected the old requests; fixed in `40f67e8`, CI green). Before it, 3.4 (morning report: after each ring, a stored `WakeReport` (`lib/morningReport.ts`, `lib/wakeReportServer.ts`): the stage that woke you (the level the ring reached), the check's time from the server's verify record, last night's plan (the planner's bedtime, now also saved by `POST /api/night-plans`) against a recorded, non-simulated bedtime, else "can't tell", and the streak. Shown as a card on the home page and, on the phone, as a quiet notification once the ring has synced. An unanswered native ring now sends `/missed` (the alarm itself is left for the buddy check). The escalation profile learns from the reports (`lib/wakeHistory.ts`), a missed ring counting as the whole ladder; when it changes, alarms still to ring are replanned. Device: the notification on the POCO; plan and missed not run on a device. Found: the e2e server read Twilio and Firebase settings from `.env.local`; now blanked. Before it, 3.3 (real backups, `BUDDY.md` "Backups": the ringing device asks `/api/alarms/[id]/backups` in the background (never waits); the second device rings at once by FCM (`BackupRing`, no check and no backups of its own) and is stopped when the first is; the wake buddy and the emergency contact are told only after the sleeper's delay, by the server's check (user's choice), the contact by Twilio SMS (user's choice after comparing Twilio / phone SMS / call: cost, Play's SEND_SMS restriction, works when the phone is dead), only with recorded consent; smartwatch always not_configured (no watch app); every channel delivered/failed/not_configured, delivered only with a transport id. Found: the panel's fields were overwritten by a late load. 3.2 before that |
| 3.3 on devices | Steps 1-3 pass (second device rings and stops, 2026-10-29); step 4's real text is blocked by the Twilio Limited trial (template-only, `572006`), everything up to Twilio works; step 5 (answered in time, no text) passes |
| Waiting on the human | 5.1's phone checklist (snooze and telemetry, `DEVICE_TESTS.md`); 4.2 steps 2-3 with real nights (needs a sleep app or watch writing to Health Connect); phone checks for 2.1-2.6 in `DEVICE_TESTS.md` (2.4 history and 2.5 can now use `npm run dev:phone`), and 3.1's by-hand checklist; 3.3's real text needs a Twilio Full access account (the trial's are in `.env.local`); 3.4 steps 2-3; nothing on secrets: a screenshot showed some; the human chose (2026-11-14) to keep the Twilio auth token and the Google client secret as they are, so don't ask again. `NEXTAUTH_SECRET` and `CRON_SECRET` were replaced in `.env.local` on 2026-11-14 (sessions signed in before then sign in again; calendar access sealed before then asks to connect again). The 2.2 gate's "fires with the app force-stopped" can't be met by any app (`ANDROID.md`) |
| Open finding for 7.1 | `middleware.ts` answers signed-out `/api/*` calls with a redirect to the sign-in page, not a JSON 401. Routes enforce auth themselves (0.3 tests). |
| Open (scoring) | The server ignores `interactions`, which both clients score with, so its score can sit a few points under the client's. Fixed in 2.5: web outbox now keeps a 401; web verify now sends time on task like the phone |
| Wake check (after 2.7, tester's request) | Three sums in a row, each a × b + c × d (2-9 times 3-12), the same on web and phone (`lib/mathChallenge.ts`, `MathChallenge.java`). Speed is now judged per answer (`steps`), on both clients and the server: this also raised the scores of existing multi-challenge sequences, which had been judged as one slow answer. On the phone 2026-10-28: three sums in 33 s, score 96, `steps: 3` queued; the tester says the difficulty is right |
| Branch for development | `develop` |

Update this table after each prompt, in the same commit.

## Baseline at handoff (2026-10-22)

70 TS tests pass, `tsc` clean, lint 0 errors / 11 warnings, 283 Python tests pass
(28 skip without the LifeSnaps download, 4 slow deselected), **`next build`
failed** on the original machine (prompt 0.1 checks and fixes it here), 22 API
routes with **no tests** (0.3).

## Hard rules

1. **No author identity in any tracked file.** The paper is under double-blind
   review and this repository is public. No names, e-mails, institution or GitHub
   usernames in code, docs, comments or commit-tracked files. Run
   `node scripts/check-anonymity.mjs` before every push; it needs the private,
   gitignored `.anonymity-terms.local`. If that file is missing, ask for it and do
   not push until the check runs clean. This rule has been broken by accident
   once already.
2. **Leave the co-author's fork alone.** The paper's anonymised artifact mirror
   (anonymous.4open.science) is built from the `research/evaluation-pipeline`
   branch of the *co-author's fork* of this repository, pinned to commit
   `fe1df9d`. Never push to, delete or force-push that branch, and keep both this
   repository and that fork **public** until the paper decision; breaking either
   breaks the link reviewers use. Development happens in this repository on
   `develop`, branched from `main`.
3. **Don't touch the research pipeline or the paper**: `paper/`,
   `ai-brain/datasets/`, `ai-brain/evaluation/`, `ai-brain/training/train_real.py`,
   `BUILD_PLAN.md`, `REPRODUCE.md`, `docs/`. Only prompt 5.2 changes training, and
   it must leave `python ai-brain/reproduce.py` passing unchanged.
4. **Nothing reports success it didn't achieve.** No fake "triggered", no
   simulated value presented or used as real.
5. **The alarm never waits on the network** at ring time.
6. **A feature without a test is not done.** Device-only behaviour is checked on
   a real phone and recorded in `DEVELOPMENT_PLAN`'s `DEVICE_TESTS.md`.
7. **Commit convention set by the project owners:** commits are authored by the
   human working on the project, with **no AI co-author trailer**.
8. Never print or commit secrets. `.env.local` stays local.

## Commands

| | |
| --- | --- |
| Web dev server | `npm run dev` |
| TS tests | `npm test` |
| Typecheck | `npx tsc --noEmit` |
| AI Brain tests | `cd ai-brain && python -m pytest -p no:warnings` |
| AI Brain server | `cd ai-brain && uvicorn main:app --reload` |
| Anonymity guard | `node scripts/check-anonymity.mjs` |
| Full gate | `npm run verify` / `npm run verify:all` (`scripts/verify.mjs`; red on any failure, warning, or empty run) |
| Android | `npm run android:doctor` (what is installed and missing), `android:test`, `android:build`, `android:run`; see `ANDROID.md` |
| Server for phone tests | `npm run dev:phone` (`next dev` on :3000 with a local MongoDB that needs no install, data in `.data/`); per device `adb reverse tcp:3000 tcp:3000`, and an app built with `CAP_SERVER_URL=http://localhost:3000` |
| Wake-buddy scheduler | `npm run buddy:cron` (calls `/api/cron/buddy-alerts` every minute; needs `CRON_SECRET`) |
| End-to-end | `npm run e2e` (Playwright, headless; own `next dev` on :3100 + in-memory Mongo; ~5 min locally; don't run alongside `verify`, both use `.next`) |

## Where things are

| Path | What |
| --- | --- |
| `DEVELOPMENT_PLAN.md` | **The plan being executed.** 37 prompts, 8 phases |
| `app/` | Next.js pages, components, 23 API routes under `app/api/` (the plan says 22) |
| `tests/api/` | Route integration tests, in-memory MongoDB, session stubbed in `setup.ts` |
| `lib/` | Core logic: `scheduler.ts`, `escalation.ts`, `wakeConfidence.ts` (gated scoring), `backupAdapters.ts` (backup channels; real transports in `backupServer.ts`), `context/` (real context only: live weather or missing), `sensors/` (real browser sensors; refuse rather than fake) |
| `lib/simulators/` | Everything made up (context, sensors), for the developer simulator only (4.4). Imported only by `*.dev.ts(x)` files (`app/simulator/page.dev.tsx`, `app/api/dev/simulated-context/route.dev.ts`), which `next.config.ts` registers only for `next dev`; `tests/simulator-guard.test.ts` fails on any production import, and `npm run verify` fails if a build has `/simulator` or `/api/dev` |
| `lib/ringPlan.ts` | What an alarm needs to ring, fixed at creation (`ringPlanServer.ts` computes it). Ring time reads only this; outcomes go through `lib/outbox.ts` afterwards |
| `lib/morningReport.ts` | The morning report after each ring (pure); `wakeReportServer.ts` stores it (`models/WakeReport.ts`), `wakeHistory.ts` turns the reports into the escalation profile. Phone: `MorningNotice.java` |
| `android/app/src/main/java/app/somniai/alarm/alarms/` | Native alarms: `NextTrigger` / `AlarmPlanner` (pure, JVM-tested), `AlarmScheduler` (AlarmManager), receivers, `SomniAlarmPlugin`, the bedtime check (`Preflight*`). Web handle: `lib/nativeAlarm.ts` |
| `DEVICE_TESTS.md` | Device-only results, emulator and phone, with dates and versions |
| `models/` | Mongoose models |
| `ai-brain/` | FastAPI service: `wake_plan.py` (the paper's method), `semantic.py`, `predict.py` |
| `BUDDY.md` | Wake buddy: how pairing and alerts work, what is shared, the Firebase setup |
| `HealthNights.java`, `HealthConnect.java` | Health Connect (4.2): folding nights (pure, JVM-tested) and reading them; server side `lib/sleepImport.ts`, page side `lib/nativeHealth.ts`. Fixtures in `tests/fixtures/health-connect/` and `android/app/src/test/resources/health-connect/` |
| `ScreenNights.java`, `ScreenUsage.java` | Screen time before bed (4.3): the windowing (pure, JVM-tested) and the usage-record reader; server `lib/screenTime.ts`, page `lib/nativeScreen.ts`. Fixtures in `tests/fixtures/screen-time/` and `android/app/src/test/resources/screen-time/` |
| `WakeTelemetry.java`, `Telemetry.java` | Alarm telemetry (5.1): per-wake timings with consent (pure, JVM-tested) and its storage and sending; server `lib/telemetry.ts`, consent text `lib/telemetryConsent.ts`, page `lib/telemetryClient.ts` and `TelemetryPanel`. Fixture `tests/fixtures/telemetry/` |
| `CALENDAR.md` | Google Calendar (4.1): incremental authorisation, what is read and stored, revoked access, the Google Cloud Console setup. Fixtures in `tests/fixtures/google-calendar/` |
| `INVENTION_DISCLOSURE.md` | Patent notes. Public disclosure already happened 2026-08-05 |
| `PRODUCT_PLAN.md` | Superseded by `DEVELOPMENT_PLAN.md`; kept for history |

## Environment gotchas, learned the hard way

- **Windows: clone to a short path such as `C:\somniai`.** numpy's nested test
  fixtures exceed the 260-character `MAX_PATH`, and the failure surfaces as a
  misleading `No module named 'numpy._utils'`.
- **Windows Git Bash mangles backslashes** in heredocs and `python -c` strings.
  `\r` in `\ref` has become a literal carriage-return byte more than once. For
  any edit containing backslashes (LaTeX, regexes), use the file-editing tool or
  write a script to a file, never an inline shell string. Then verify the bytes.
- A stray `package-lock.json` in a parent directory makes Next.js pick the wrong
  workspace root. Fix with `outputFileTracingRoot`, not by deleting files outside
  the repo.
- `next build` hit `EPERM: kill` on the original Windows machine. It did not
  reproduce on the second machine (Node 22, no parent lockfile), so it was not
  diagnosed further; if it returns, suspect an antivirus or file lock on `.next/`.
- LifeSnaps (Zenodo record 7229547) returned HTTP 504 for days in October 2026.
  PMData downloads fine. `python ai-brain/fetch_datasets.py --out data/external`
  resumes. Datasets are only needed for prompt 5.2.
- **JDK 26 is installed and too new for Android builds**: Gradle 8.14.3 fails
  on it with `Unsupported class file major version 70`. Android needs JDK 21
  (Android Studio 2026.2.1 bundles JDK 25, also too new: download a 21 from
  its Gradle JDK setting); `scripts/android.mjs` finds a usable JDK and
  never uses the 26 for Gradle.
- **Decline Android Studio's "upgrade Gradle" offer.** On 2026-10-24 it moved
  the wrapper to Gradle 9.7.1, which breaks the build: AGP 8.13 uses an internal
  API removed in Gradle 9.6 ("use Gradle 9.5"). The wrapper stays at 8.14.3
  until AGP is upgraded with it on purpose. `git diff android/gradle` shows it.
- **Java needs IPv4 on this network.** Java downloads (the Gradle wrapper,
  Maven) time out trying IPv6 first while curl works; `-Djava.net.preferIPv4Stack=true`
  fixes it, and `android/gradle.properties` and `scripts/android.mjs` set it.
  The wrapper's `networkTimeout` is also raised to 2 minutes for the slow
  GitHub release host.
- **Virtualization-based security is on**, so the Android emulator needs the
  Windows Hypervisor Platform feature (admin PowerShell, see `ANDROID.md`).
- **`NoDefaultCurrentDirectoryInExePath` is set in this shell**, so `cmd` won't
  run `gradlew.bat` by bare name from `android/`; `scripts/android.mjs` calls it
  by full path. In Git Bash, `export MSYS_NO_PATHCONV=1` before `adb shell`
  commands, or `/sdcard/...` arguments get rewritten into Windows paths.
- **The emulator plus Android Studio don't fit in free RAM.** Close Android
  Studio and run `android\gradlew --stop` before starting the emulator. Even
  then the emulator's System UI can show "isn't responding" dialogs under host
  memory pressure; that is the emulator, not SomniAI (check
  `adb logcat -b crash` and `dumpsys activity` for the app's own state).
- **This machine has 8 GB of RAM and often only ~1 GB free.** Two Playwright
  browsers plus `next dev` and MongoDB made it swap so badly that sign-in hung
  for 40+ seconds, which looked like an app bug and wasn't. Locally `npm run e2e`
  runs one browser at a time (`workers: CI ? 2 : 1`). If e2e suddenly times out
  everywhere at once, check free memory before debugging the app.
- **There is no MongoDB installed here**, and `.env.local` points at
  `localhost`. Use `npm run dev:phone`, not `npm run dev`, for anything that
  needs the server.
- **Stopping a background task stops only its shell on Windows**: `npm run`'s
  node children (`next dev`, MongoDB, `buddy-cron`) keep running. Afterwards,
  check port 3000 and `node.exe` processes, and stop the leftovers.
- **Run `npm run verify` / `vitest` from PowerShell (or anywhere the path is
  `C:\...`), not Git Bash.** Git Bash's cwd reaches Node as `c:/...` and
  Vitest then loads its runner twice: every file fails with 0 tests and
  "Vitest failed to find the runner" / "reading 'config'". Not a code failure
  (2026-11-14: red from Git Bash, 920 passed from PowerShell, same tree).
- **CI's Android 32 emulator can fail the bedtime check's "Exact alarms turned off" case** with the app's detection right (`detected: fail ... put back: pass`) but the script's tap finding the launcher, not the check screen: revoking exact alarms kills the app on Android 12, and under the emulator's GPU errors (`Failed to find ColorBuffer`) it doesn't come back in time. Seen once on 4.4 (no Android change); the re-run passed. Read `preflight-results.md` in the artifacts before assuming a regression.
- Lint is `eslint .` (flat config in `eslint.config.mjs`), not the deprecated
  `next lint`. It covers the whole repo, not only `app/` and `lib/`, and ignores
  `ai-brain/` because its virtualenv contains vendored JavaScript.

## Platform limits to state honestly

iOS cannot be built on Windows; it needs Xcode on a Mac, and the route there is
AlarmKit (iOS 26+). Android-first. Manufacturer battery managers (Xiaomi, Realme,
Oppo, Vivo) can still stop a correct alarm; prompts 2.7 and 3.1 mitigate, nothing
fully removes it.
