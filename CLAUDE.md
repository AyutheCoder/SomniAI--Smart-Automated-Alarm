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
| **Next prompt** | **3.1** |
| Last completed | 2.7 (device matrix: emulator API 37 and a POCO M8 5G on HyperOS 3.0 / Android 16, SomniAI not exempted: every condition rang, including reboot before unlock, swiped away + clear all, and a real night unplugged with the maths check; the phone exposed three test-tool faults, fixed: HyperOS's log pruning deleted the evidence (the script now copies the app's log as it is written), a given-up alarm kept ringing into the next condition, and the debug receiver wasn't direct-boot aware. Found on the emulator and fixed: a reboot mid-ring left the alarm volume raised (`AlarmVolume`)) |
| Waiting on the human | Phone checks for 2.1-2.6 in `DEVICE_TESTS.md` (2.4 history and 2.5 need the dev server and a signed-in phone). The app's own record of the 2.7 night ring (2026-10-25 09:00, id `night-test`) is still on the phone: read it when it's next connected. The 2.2 gate's "fires with the app force-stopped" can't be met by any app (`ANDROID.md`) |
| Open finding for 7.1 | `middleware.ts` answers signed-out `/api/*` calls with a redirect to the sign-in page, not a JSON 401. Routes enforce auth themselves (0.3 tests). |
| Open (scoring) | The server ignores `interactions`, which both clients score with, so its score can sit a few points under the client's. Fixed in 2.5: web outbox now keeps a 401; web verify now sends time on task like the phone |
| Open (wake check) | Tester on 2026-10-25: "the question is very easy". One sum from 6x6 to 13x13, and one quick correct answer clears minConfidence 70. Harder sums, more of them, or a higher bar is a product decision no prompt covers yet |
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
| End-to-end | `npm run e2e` (Playwright, headless; own `next dev` on :3100 + in-memory Mongo; ~5 min locally; don't run alongside `verify`, both use `.next`) |

## Where things are

| Path | What |
| --- | --- |
| `DEVELOPMENT_PLAN.md` | **The plan being executed.** 37 prompts, 8 phases |
| `app/` | Next.js pages, components, 23 API routes under `app/api/` (the plan says 22) |
| `tests/api/` | Route integration tests, in-memory MongoDB, session stubbed in `setup.ts` |
| `lib/` | Core logic: `scheduler.ts`, `escalation.ts`, `wakeConfidence.ts` (gated scoring), `backupAdapters.ts` (currently fake), `context/` (calendar/wearable simulated), `sensors/` (silent simulated fallbacks) |
| `lib/ringPlan.ts` | What an alarm needs to ring, fixed at creation (`ringPlanServer.ts` computes it). Ring time reads only this; outcomes go through `lib/outbox.ts` afterwards |
| `android/app/src/main/java/app/somniai/alarm/alarms/` | Native alarms: `NextTrigger` / `AlarmPlanner` (pure, JVM-tested), `AlarmScheduler` (AlarmManager), receivers, `SomniAlarmPlugin`. Web handle: `lib/nativeAlarm.ts` |
| `DEVICE_TESTS.md` | Device-only results, emulator and phone, with dates and versions |
| `models/` | Mongoose models |
| `ai-brain/` | FastAPI service: `wake_plan.py` (the paper's method), `semantic.py`, `predict.py` |
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
- Lint is `eslint .` (flat config in `eslint.config.mjs`), not the deprecated
  `next lint`. It covers the whole repo, not only `app/` and `lib/`, and ignores
  `ai-brain/` because its virtualenv contains vendored JavaScript.

## Platform limits to state honestly

iOS cannot be built on Windows; it needs Xcode on a Mac, and the route there is
AlarmKit (iOS 26+). Android-first. Manufacturer battery managers (Xiaomi, Realme,
Oppo, Vivo) can still stop a correct alarm; prompts 2.7 and 3.1 mitigate, nothing
fully removes it.
