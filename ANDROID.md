# Android

The Android app is a [Capacitor](https://capacitorjs.com) shell around the web
app (`android/`, configured in `capacitor.config.ts`). From prompt 2.2 on,
native code in it schedules, rings and dismisses alarms; the web view shows
everything else.

## Commands

| Command | What it does |
| --- | --- |
| `npm run android:doctor` | Lists what is installed, what is missing, and what to install |
| `npm run android:test` | Syncs, then runs the JVM unit tests (`testDebugUnitTest`) |
| `npm run android:build` | Syncs, then builds `android/app/build/outputs/apk/debug/app-debug.apk` |
| `npm run android:run` | Installs the debug APK on the running emulator or phone and opens it |

`npm run verify:all` runs the unit tests and the debug build too. Without the
toolchain those steps fail and say what is missing; they are never skipped.

## Installing the toolchain (Windows)

What the project needs, read from the generated files rather than assumed:

| Need | Why | Source |
| --- | --- | --- |
| JDK 21 (21-24 work) | Capacitor compiles for Java 21; Gradle 8.14.3 can't run on newer. Tried here: JDK 25 fails with `Unsupported class file major version 69`, JDK 26 with `70` | `node_modules/@capacitor/android/capacitor/build.gradle`, `android/gradle/wrapper/gradle-wrapper.properties` |
| Android SDK Platform 36 | `compileSdkVersion = 36` | `android/variables.gradle` |
| SDK Build-Tools, Platform-Tools | building and installing (`adb`) | Android Gradle Plugin 8.13.0 |
| Android Emulator + an x86_64 system image | running the APK without a phone | |

Steps:

1. **Install Android Studio** (the current stable release) from
   <https://developer.android.com/studio>.
2. **Run its setup wizard** on first start and choose **Standard**. That
   installs the SDK, Platform-Tools, Build-Tools and the Emulator. If the
   wizard was skipped or closed, *More Actions → SDK Manager* offers to install
   the SDK instead.
3. **Get a JDK 21 through Android Studio.** Its own bundled JDK is too new:
   Android Studio 2026.2.1 bundles JDK 25, which this Gradle can't run on.
   *Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK
   → Download JDK…*, version **21**, vendor **Eclipse Temurin**. It goes into
   `.jdks` in your user folder, where `npm run android:doctor` looks. The JDK
   26 already installed stays as it is and is not used for Android builds.
4. **Add API 36** if the wizard installed a different one: *More Actions →
   SDK Manager → SDK Platforms →* tick **Android 16.0 ("Baklava") API 36**, then
   *SDK Tools →* make sure **Android SDK Build-Tools**, **Android SDK
   Platform-Tools** and **Android Emulator** are ticked. Apply.
5. **Turn on Windows Hypervisor Platform.** Virtualization-based security is
   running on this machine, so the emulator can only accelerate through it. In
   an **administrator** PowerShell:
   ```powershell
   Get-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform
   Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform   # if State is Disabled
   ```
   Restart when asked.
6. **Create a virtual device:** *More Actions → Virtual Device Manager → Create
   device →* a Pixel phone *→* system image **API 36, Google APIs, x86_64**.
   This machine has 8 GB of RAM and little free, so under *Advanced* give the
   device **2048 MB** of RAM, and close other apps before starting it.
7. **Check:** `npm run android:doctor` should report everything OK. It looks for
   the JDK in `JAVA_HOME`, then where Android Studio installed its own, then the
   `java` on your PATH; and for the SDK in `ANDROID_HOME`, `ANDROID_SDK_ROOT`,
   then Android Studio's default location. If it can't find them, set
   `JAVA_HOME` and `ANDROID_HOME` to the paths Android Studio shows (Settings →
   Build Tools → Gradle → Gradle JDK, and SDK Manager → Android SDK Location).

Network note: on this machine Java's downloads time out when they try IPv6
first, though curl works. `android/gradle.properties` and `scripts/android.mjs`
make Gradle prefer IPv4.

## Running it

```bash
npm run dev            # the shell loads this, via 10.0.2.2 on the emulator
npm run android:build
npm run android:run    # with the emulator running
```

On a phone on the same Wi-Fi: start the dev server with `npx next dev -H 0.0.0.0`,
then `CAP_SERVER_URL=http://<this PC's LAN IP>:3000 npm run android:build`.

## Decision: the shell loads the app from a server, not bundled files

**Decided in prompt 2.1.** The web view loads the app from a server
(`server.url`): the local dev server during development, the deployed site
for release. It does not bundle the app's pages into the APK.

### The two options

| | Load from a server (chosen) | Bundle the pages into the APK |
| --- | --- | --- |
| Works with the app as built | Yes: pages, API routes, sign-in and middleware all run as they do in a browser | No: needs a static export. The API stays on a server, so every call becomes cross-origin, and sign-in has to move from cookies to tokens or native HTTP |
| UI with no connection | No: an offline page is shown instead | Yes |
| Shipping a UI change | Deploy the site; no store release | A new store release |
| Capacitor's guidance | `server.url` is documented as "not intended for use in production" | The supported path |
| Native bridge exposure | Whatever the server sends can call the app's native plugins | Only code shipped in the APK can |
| Play Store | Apps that wrap a website risk rejection under the minimum-functionality policy | No such concern |

### Why load from a server

- **The alarm doesn't depend on the web view.** From prompts 2.2–2.4, native
  code schedules the alarm with `AlarmManager`, rings it from a foreground
  service and runs a native challenge to dismiss it. Prompt 2.5 keeps each alarm's
  ring plan on the device. So the UI needing a connection never touches the rule
  that the alarm never waits on the network at ring time.
- **Bundling means rebuilding the app first.** A static export would mean
  reworking sign-in for a cross-origin app and every API call. That is real
  work, and it belongs in a prompt of its own, not hidden inside the shell set-up.

### What this costs, and how it is contained

- **We use `server.url` beyond its documented purpose.** A web view whose
  native bridge is driven by a remote site is only as trustworthy as that site.
  So:
  - A release build must use HTTPS: `capacitor.config.ts` refuses
    `CAP_RELEASE=1` with plain HTTP, and `ShellConfigTest` checks the packaged
    config.
  - Navigation is locked to the app's own host (`allowNavigation`). Every other
    link opens in the browser, outside the bridge.
  - The native plugins offer as little as they can.
  - The security review (prompt 7.1) must cover the server as part of the app.
- **No UI offline.** `mobile/www/offline.html` explains that instead of a blank
  screen. It must say truthfully whether alarms still ring. It currently says
  native alarms are not in this build yet; update that when 2.2–2.4 ship.
- **Native and web can drift apart.** The site can update while an older APK is
  installed, so the web code checks the plugin's `version()` before using it
  (`lib/nativeSync.ts`, prompt 2.5). An older app is left alone, and the page
  says so and keeps ringing alarms itself.

### When to revisit

Move to bundled pages if the Play Store review (prompt 7.5) objects, if the UI
is needed offline, or if the server-as-trusted-code risk stops being acceptable.
The route is a static export of the pages plus Capacitor's native HTTP, so that
sign-in cookies work across origins.

## Native alarms (prompt 2.2)

`android/app/src/main/java/app/somniai/alarm/alarms/` is an in-app Capacitor
plugin, `SomniAlarm`. The web app's typed handle on it is `lib/nativeAlarm.ts`.

- **Scheduling.** Every alarm goes through `AlarmManager.setAlarmClock`. It is
  exact, the system shows it as the next alarm, and it fires through Doze.
  Android's Doze page: "Alarms set with `setAlarmClock()` continue to fire
  normally. The system exits Doze shortly before those alarms fire."
- **Storage.** Alarms are kept as wall-clock times (hour, minute, and days or a
  date) in device-protected storage, so they survive the process being killed
  and can be read before the first unlock after a reboot.
- **When it reschedules.**
  - Boot, both before and after the first unlock.
  - A change of time or time zone.
  - An app update.
  - The exact-alarm permission being granted.
  - Every app start.
- **When an alarm fires.** It rings: see "Ringing" below. The web app's alarm
  list is connected to the plugin in prompt 2.5.

### Exact alarms: the permission on each Android version

Checked on 2026-10-24 against Android's documentation and the SDK's own
Javadoc (`sources/android-37.0`), not from memory:

| Android | Permission | How it is granted | What the app does |
| --- | --- | --- | --- |
| 8–11 (API 26–30) | none | — | Schedules directly. `canScheduleExactAlarms()` doesn't exist yet. |
| 12, 12L (API 31–32) | `SCHEDULE_EXACT_ALARM` | "Alarms & reminders" special access. The user and the system can turn it off, which deletes the app's exact alarms and stops the app. Without it, `setAlarmClock` throws `SecurityException`. | Checks `canScheduleExactAlarms()`. If access is off, the alarm is saved as `waiting_for_permission` and `openExactAlarmSettings()` opens `ACTION_REQUEST_SCHEDULE_EXACT_ALARM` with `package:` for this app. When access is turned on, Android sends `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`, and everything is rescheduled. No broadcast is sent when access is turned off. |
| 13+ (API 33+) | `USE_EXACT_ALARM` | A normal permission, granted at install, that the user cannot revoke. | Schedules. It still asks `canScheduleExactAlarms()` and reports `unavailable` instead of pretending if the answer is ever no. |

- **Google Play.** Play's "Permissions and APIs that Access Sensitive
  Information" policy, Exact Alarm section, allows `USE_EXACT_ALARM` only when
  "The app is an alarm or timer app" (or a calendar app). It also requires the
  Play Console permission declaration, which belongs to prompt 7.5. SomniAI is
  an alarm app, so it qualifies.
- **Android 14 change.** `SCHEDULE_EXACT_ALARM` is no longer pre-granted to new
  installs. That is why it isn't the permission relied on for 13+.
- **The `maxSdkVersion="32"` cap on `SCHEDULE_EXACT_ALARM` is this project's
  choice.** No Android page we found recommends it. It means Android 13+ holds
  only the permission the user can't switch off, rather than also a duplicate
  that can be revoked. On the API 37 emulator the app holds `USE_EXACT_ALARM`
  (`granted=true`) and doesn't request `SCHEDULE_EXACT_ALARM`.
  `AlarmManifestTest` keeps the declarations as they are.
- **The rest of the manifest.**
  - `RECEIVE_BOOT_COMPLETED`.
  - `POST_NOTIFICATIONS`, because Android 13+ asks the user (`requestNotifications()`).
  - Both receivers are `exported="false"` and `directBootAware="true"`.
  - Every action the reschedule receiver listens for is a protected broadcast
    that only the system can send. Each is also allowed to reach a manifest
    receiver on Android 8+: the boot, time and time zone broadcasts are on
    Android's implicit-broadcast exceptions list, and `MY_PACKAGE_REPLACED`
    goes only to the app that was replaced.

### Time rules (tested in `NextTriggerTest` and `AlarmPlannerTest`)

- An alarm keeps its clock time through daylight-saving changes and moves with
  the phone's time zone: 07:00 stays 07:00 local.
- **A time the clocks skip** (02:30 when 02:00 jumps to 03:00) rings at the
  moment of the jump.
- **A time that happens twice** (01:30 when 02:00 falls back to 01:00) rings
  once, the first time.
- **Strictly after now.** A repeating alarm moves on to its next occurrence
  even if it was delivered a moment early.
- **No second ring after the clock is set back.** An occurrence that already
  rang doesn't ring again.
- **Late and missed occurrences.**
  - If one was due less than 15 minutes ago and hasn't rung (a short reboot,
    for example), it is rung late.
  - If it is older than that, it is recorded as `missed` instead.
  - A one-off past its time is refused when it is first set.

### Force-stop deletes alarms: this is Android, not a bug

"Force stop" in Settings, or `am force-stop`, deletes all of an app's alarms.
The SDK's Javadoc says a force stop returns the app to the "stopped" state.
Android 15's behaviour changes say "the system also cancels all pending intents
when the app enters the stopped state". On the API 37 emulator, AlarmManager's
removal history showed `Reason=pi_cancelled` for SomniAI's alarm each time.

No app can ring after a force-stop until the user opens it again. When they
do, SomniAI reschedules everything: at app start, and on Android 15+ through
the `BOOT_COMPLETED` that Android delivers when the app leaves the stopped
state. That was seen on the emulator. An occurrence that went by meanwhile is
logged as missed.

Being killed in the ordinary ways is different. A swipe from recents, the
low-memory killer or a battery manager kill only ends the process, and the
alarm still fires. The checks below show that.

### Checking alarms on a device

Debug builds include an adb-only test hook (`src/debug/`, guarded by
`android.permission.DUMP`):

```bash
export MSYS_NO_PATHCONV=1   # Git Bash only
R="-n app.somniai.alarm/.alarms.DebugAlarmReceiver"
adb shell am broadcast -a app.somniai.alarm.debug.SCHEDULE $R --ei minutes 2   # one-off; add --ez daily true to repeat
adb shell am broadcast -a app.somniai.alarm.debug.LIST $R
adb shell am broadcast -a app.somniai.alarm.debug.CANCEL $R
adb logcat -s SomniAlarm
```

`bash scripts/android-alarm-check.sh <apk>` does the whole check on whatever
device is connected:

- The permission is the right one for that Android version.
- On 12/12L, the alarm waits while access is off and is rescheduled when it
  is turned on.
- An alarm set about two minutes ahead fires after the app's process has been
  killed.

CI runs it on API 26, 32 and 35 emulators. Results on a real phone go in
`DEVICE_TESTS.md`.

`bash scripts/device-matrix.sh` runs the whole condition matrix (screen locked,
silent mode, Do Not Disturb, Battery Saver, low battery, airplane mode, time
zone change, force-stop, Doze, Restricted battery usage, standby bucket, and
`reboot` on request). It sets each condition, rings a test alarm under it,
records the evidence, stops the alarm and puts the condition back.
`DEVICE_TESTS.md` explains how to run it on a phone and what to do by hand.

## Ringing (prompt 2.3)

When an alarm fires, `AlarmFiredReceiver` starts `RingService`. Android allows
this from the background because the alarm was set with `setAlarmClock`
("Alarms scheduled via this API will be allowed to start a foreground service
even if the app is in the background", from the SDK Javadoc). The lifecycle is
`RingController`, a pure state machine tested on the JVM. `RingService` carries
it out:

| What | How | Source checked 2026-10-24 |
| --- | --- | --- |
| Foreground service | Type `systemExempted` (`FOREGROUND_SERVICE_SYSTEM_EXEMPTED`). Started with that type on Android 14+, and with the manifest's type before that. | The service-types page allows it for "Apps holding SCHEDULE_EXACT_ALARM or USE_EXACT_ALARM permission". Android 14's required-types page describes it as "using Foreground Service to continue alarms in the background, including haptics-only alarms". Google Play's foreground-service declaration table doesn't list `systemExempted`; this is re-checked at Play submission (7.5). |
| Sound | `MediaPlayer` or `AudioTrack` with `USAGE_ALARM`. Sources are tried in order: the phone's alarm sound, then its ringtone, then a tone made in code. The tone needs no file, so it plays before the first unlock, when media files may be unreadable. | On the emulator, AudioService lists the streams the ringer mode affects as system, ring, notification, system-enforced and DTMF. The alarm stream isn't among them. |
| Volume ramp | Rises evenly in decibels from −30 dB to the target. Ramp length comes from the ring plan's strategy (gentle 60 s, adaptive 30 s, aggressive 10 s). The target is 0.3 + 0.7 × intensity/100, so intensity 0 is still audible. | `RingTuning` |
| Alarm stream floor | If the alarm volume is below 40 % of its range, it is raised to that while ringing, then put back afterwards unless the user changed it meanwhile. | A choice, not a requirement. An alarm turned right down would otherwise ring inaudibly. |
| Vibration | Alarm usage throughout: `VibrationAttributes.USAGE_ALARM` on 13+, `AudioAttributes.USAGE_ALARM` before. Since 2.6: one buzz when the ring starts, then a repeating waveform from the ladder's vibration level, or at once if no sound will play. | |
| Wake lock | Partial, `SomniAI:ring`, with a timeout just past the longest ring | |
| Over the lock screen | A notification in the alarm category, `VISIBILITY_PUBLIC`, on the `ringing` channel (importance HIGH, no channel sound or vibration). Its full-screen intent opens `RingActivity`, which uses `showWhenLocked` and `turnScreenOn` (window flags on 8.0). | `setFullScreenIntent` Javadoc: it needs a channel of importance HIGH or above. While the phone is in use, a heads-up is shown instead. Without `USE_FULL_SCREEN_INTENT` it is "heads up notification even when the screen is locked or turned off", persistent for only 60 s. Google Play: on 14+ the permission is granted by default only to "calling or alarm" apps, after a Play Console declaration (7.5). `ringStatus()` reports it, and `openFullScreenIntentSettings()` opens the setting. |
| Silent mode | Unaffected: the alarm stream isn't a ringer-mode stream | On-device test, and a locked-emulator run |
| Do Not Disturb | Priority mode lets alarms through when the "Alarms" exception is on, which is the default. "Alarms only" lets the alarm category through. **Total silence** (`INTERRUPTION_FILTER_NONE`) mutes "all audio streams (except those used for phone calls) and vibrations". No app can ring through it. Each ring records the DND state, the ringer mode and the alarm volume in the log, so a silent ring can be explained afterwards. | `NotificationManager` Javadoc |
| How long it rings | Up to 20 minutes, then it stops and is logged as `unanswered`. The ladder (2.6) reaches its top long before that; the cap stays as the end of an unanswered ring. | |
| Stopping | Stop on the ring screen (after the wake check, if the plan has one). Sound, vibration, wake lock, the raised volume, the notification and the service are all released. The occurrence is logged as `dismissed`, and stopping doesn't unlock the phone. | Tests, and the locked-emulator run |
| Two alarms at once | The second joins the ring already going, and one Stop ends both | Tests |
| Process killed mid-ring | `START_REDELIVER_INTENT`: Android restarts the service and it rings again rather than falling silent | |

Stop leads to the native wake check whenever the ring plan asks for one: see
"Wake check and offline sync" below.

### Tests

- **JVM:** `RingControllerTest` and `RingTuningTest`, run by
  `npm run android:test` and `verify:all`. `RingControllerTest` covers every
  path: dismiss, unanswered, destroyed mid-ring, a second alarm joining, sound
  fallback, foreground refused, and ringing again afterwards. It checks that
  nothing is left held.
- **On the device:** `RingServiceTest`, in `src/androidTest`. It runs the real
  service: foreground with the full-screen alarm notification, playing on the
  alarm stream, the wake lock, the ramp, the volume floor, silent mode plus DND,
  a second alarm joining, and dismissal leaving nothing behind. Run it with:

  ```bash
  npm run android:build                    # builds the test APK too
  bash scripts/android-instrument.sh       # with an emulator or phone connected
  ```

  CI runs it on API 26, 32 and 35, together with `android-alarm-check.sh`. That
  script now also checks that the fired alarm rings in a foreground service of
  type `0x400` and stops when dismissed.

## Wake check and offline sync (prompt 2.4)

An alarm can be verified and stopped with no network and without the web view,
and the result reaches the server once the phone is back online.

### The wake check

When the ring plan asks for a check (`challenge.required`), Stop leads to maths
on the ring screen. The sums are the web's (`lib/mathChallenge.ts`):
a × b + c × d, with a and c from 2 to 9 and b and d from 3 to 12, three in a row
for each method the plan lists ("Sum 2 of 3"). A wrong answer brings a new sum
without undoing the ones already solved. The phone's check is always maths; the
methods sent to the server say so.

Speed is judged **per sum**: the score's 6 to 45 s brackets describe one
answer, so the time on task is divided by the number of answers (`steps`, sent
to the server with it). Judged as one answer, three sums would always read as
"fell back asleep", and a correct but unhurried wake couldn't pass the
strictest tiers.

**The gate is the web's.** `WakeConfidence.java` is `lib/wakeConfidence.ts`,
line for line. The alarm stops only when every problem in the sequence is solved
**and** the score meets the plan's `minConfidence`, the same rule the overlay
applies:

- **A wrong answer never stops it.** It brings a new problem and counts as an
  attempt. An unsolved check is capped at 35, below every threshold.
- **Solved but too slow** (score under `minConfidence`): the sequence starts
  again and is scored on its own, as on the web.
- **Checked twice.** The ring screen gates Stop, and `RingService` checks again.
  `RingController.passes` refuses any dismissal without a passed check: wrong,
  missing, too short, too low, or claiming a score while unsolved. A refusal is
  logged as `dismiss_refused` and the alarm keeps ringing. The adb debug hook
  can't stop a checked alarm either.
- **A plan that can't be read** gets a required check at minConfidence 70, the
  web's default. It never makes an alarm easier to stop.

**Kept in step with the TypeScript.** `WakeConfidenceTest` restates every case
in `lib/wakeConfidence.test.ts` under the same names. It also checks 3,456 signal
combinations and 12 sequences in a table that
`lib/wakeConfidence.parity.test.ts` checks against the TypeScript
(`android/app/src/test/resources/wake-confidence-cases.json`). If either side
changes alone, one of those tests fails. To change the model on purpose, change
both, then regenerate the table with `WRITE_PARITY=1`.

### The offline queue

Stopping a ring queues what the web app would have sent. The calls are the same
as `lib/ringFlow.ts` `syncCalls`, in the same order: `fire`, then `verify` if
there was a check, then `dismiss`. An unanswered ring queues only `fire`.

- **Each call carries `at`,** when it happened on the phone. The server routes
  accept it, up to 7 days old and not in the future, and record history at that
  time rather than the sync time. The dismiss route looks for the verification
  near the dismissal's own time, so a morning stopped offline and synced at
  noon still counts as verified. Covered by `tests/api/alarm-actions.test.ts`,
  "a ring reported late".
- **Storage.** The queue is in device-protected storage, written with
  `commit()` before the ring service lets go.
- **Sending.** WorkManager's `SyncWorker` runs once there is a network
  (`NetworkType.CONNECTED`), with exponential backoff while the server can't
  take it. It is also scheduled at app start and after unlock at boot. It posts
  to the server the web view loads, with the web view's own session cookie.
- **When a call is kept or dropped** (`OutboxQueue`):
  - 2xx: sent.
  - 5xx, a timeout, no network, 408, 425 or 429: kept, with everything after it,
    in order.
  - **401: kept**, because the phone may not be signed in yet.
  - Any other 4xx: dropped and logged, so a deleted alarm can't jam the queue.

  The queue is saved after every call, so a crash mid-send neither loses one nor
  sends twice one the server accepted.
- **Plain HTTP.** Debug builds allow it to the dev server (Capacitor adds
  `usesCleartextTraffic` only when `server.cleartext` is on). Release builds are
  HTTPS-only, as in prompt 2.1.

### Tests

| Where | What |
| --- | --- |
| JVM | `WakeConfidenceTest` (TypeScript cases, shared table), `WakeCheckTest` (problems, wrong answers, sequences, retry, plan defaults), `SyncCallsTest` (paths, order and fields match the server routes), `OutboxQueueTest` (offline, survives restarts, order, 5xx/401/retryable kept, permanent dropped, saved per call, bounded), `RingControllerTest` (the service's gate: refusals, unsolved-but-high-score, strictest plan, what gets queued). Each gate was checked by breaking it on purpose: the tests caught it, except one case, which got its own test. |
| On the device | `RingActivityTest`: wrong answers keep it ringing, the right one stops it, and the result is queued. The keyboard opens by itself and never covers Check. `RingServiceTest`: only a passed check stops a checked ring. `OutboxSyncTest`: real HTTP to a server on the phone that is unreachable, then failing, then healthy, so nothing is lost and it arrives in order with its times; not signed in, so it is kept. |

### Found and fixed on the emulator

- **The keyboard covered Check.** Android 15+ draws apps edge to edge, so the
  window no longer shrinks for the keyboard. The ring screen now pads itself
  by the keyboard and system-bar insets, scrolls if it has to, and opens the
  keyboard by itself.
- **An alarm going off just as another was dismissed crashed the app.** The
  service stopped itself with `stopSelf()`, which also drops a start already on
  its way; Android then killed the app for not calling `startForeground`.
  It now uses `stopSelf(latestStartId)`, and calls `startForeground` on every
  ring start. The test reproduced the crash 3/3 before the fix.

### Open, for prompt 2.5 (one source of truth): resolved there except the last

- **Fixed in 2.5.** The web outbox now keeps a 401 instead of dropping it, as
  the native queue does (`lib/outbox.ts`; tested in `lib/ringFlow.test.ts`).
- **Fixed in 2.5.** Verify's `responseMs` is now the time on the challenges
  from both clients (`timeOnTaskMs` on the web), so the same wake scores the
  same from either. Dismiss still reports the whole ring.
- **Still open.** The server ignores `interactions`, which both clients score
  with, so the server's score can sit a few points under the client's. It is a
  trust choice about an unverifiable client signal, for the security review
  (7.1).

## Keeping the phone and the server in step (prompt 2.5)

### Who owns what

- **The server owns the alarm definitions:** which alarms exist, and each one's
  label, time, repeat days, on/off state and ring plan. They change only
  through the app's pages and the server's own scheduling.
- **The phone owns what already rang:** whether an occurrence rang, was
  dismissed or was missed. It reports that through the outbox (prompt 2.4).

### How they stay in step

1. **After every list the page gets from the server,** the page sends the
   whole list to the plugin's `reconcile` (`lib/nativeSync.ts`). That covers the
   first load, create, edit time, turn on or off, delete, the wake planner's
   alarms, and a reload when the app comes back to the foreground.
2. **The phone diffs that list against its own schedule** (`ReconcilePlan`):
   - adds what's new;
   - replaces what differs;
   - removes server alarms that are gone;
   - leaves everything else alone.
3. **It is idempotent.** An identical list isn't sent again, and on the phone an
   unchanged alarm isn't touched, so its AlarmManager entry stays as it was.
   Rapid changes are folded into one follow-up with the latest list.
4. **On every app start the phone reconciles twice over.** The plugin's
   `load()` re-sets AlarmManager from the phone's own store, which restores
   anything a crash or force-stop lost. Then the page sends the server's list.
5. **Inside the app, the page doesn't ring alarms itself;** the phone does.
   This stops anything ringing twice. In a browser, the page rings as before.
6. **Version handshake.** The page first checks the plugin's `version()`
   (`REQUIRED_NATIVE_API = 2`). An app built before 2.5 has no `version()`, so
   it is left alone: the page says to update it, and keeps ringing alarms only
   while it is open.

### When the two disagree

| Situation | What happens | Why |
| --- | --- | --- |
| On the server, not on the phone | Added | The server owns the definitions |
| On the phone, not on the server (deleted elsewhere, or while the app was closed) | Removed at the next reconcile | Same |
| Both have it, set differently | The server's version replaces the phone's | Same |
| A one-off already rang or was missed on the phone, and the server still has it on (its dismissal is still in the outbox) | Kept as rung; not armed again | The phone owns what already rang. The server learns from the outbox |
| A one-off whose time has passed, which the phone never had | Not scheduled; reported as `past` | The past can't ring |
| An alarm moved to a time already past | Its old copy is removed | It mustn't ring at the old time |
| An alarm is deleted or edited while it is ringing | The ring carries on and is stopped as usual. The change applies from then on, and the ring's result for a deleted alarm is dropped by the server (404) | Interrupting a ringing alarm is worse than finishing it |
| The alarm list failed to load, or is the offline cache | **Nothing is sent** | A partial list would remove every alarm missing from it |
| A list naming an alarm twice, or an id the server didn't issue | Refused, nothing changed, the error shown | A list like that is a bug to surface, not to guess at |
| The debug hook's alarms (ids that aren't the server's 24-hex ObjectIds) | Left alone | The server didn't make them |
| A repeating alarm snoozed in a browser | The phone keeps the alarm's own time (`snoozedFrom`), not the snooze | The phone has no snooze yet; moving every later morning would be wrong |
| The phone was offline when the alarm changed | The phone keeps its last list; the change arrives at the next load | The page can't load offline |
| The plugin call fails | The page shows "Couldn't update the alarms on this phone" with Try again; the next change or app start retries | It's never reported as done when it wasn't |

**Server-side alarms reach the phone at the next load.** Alarms the server
creates by itself (autonomous scheduling) arrive at the next app start, the
next return to the foreground, or the next change made in the app.

### Tests

| Where | What |
| --- | --- |
| JVM, `ReconcilePlanTest` (14) | Create; edit, with every field the web sets counted; disable; delete; an empty list; the same list twice; debug alarms left alone; duplicates refused; a one-off's history kept; a past one-off not scheduled; **a crash after each of the 5 steps of a reconcile**, where the next reconcile finds exactly the steps left and converges. Plus `AlarmCodecTest`: the same ring plan reads the same whatever its key order |
| On the device, `ReconcileTest` (5) | The real store and AlarmManager, checked through `getNextAlarmClock()`: create, edit, disable, delete; the same list twice; a crash with the store ahead of AlarmManager, then an app start; debug alarms; a bad list changes nothing |
| Vitest, `lib/nativeSync.test.ts` (12) | Create, edit, on/off, delete (the last one too); the same list again isn't sent; bursts folded together; a failure retried; an invalid alarm skipped and reported; snoozed repeating alarms; the version handshake |
| Playwright, `e2e/native-sync.spec.ts` (3) | The real page and server, with a stand-in phone at Capacitor's bridge: create, off, on, edit and delete all reach the phone; a reload reconciles; a repeat isn't sent twice; a due alarm doesn't also ring in the page; an old app is left alone |
| Emulator, with a page served at the app's server URL | Capacitor's bridge reaches the plugin from a page loaded from the server: `version` 2, `reconcile` ran. An alarm set for 3 minutes ahead was edited to 2 minutes ahead by a reload. It fired at the edited minute (194 ms late), on the locked screen, and **not** at the old one |

## Escalation ladder (prompt 2.6)

The phone climbs the alarm's five-stage ladder itself, from the ring plan
cached with the alarm, so escalation works offline and with the app closed.
`EscalationLadder` (pure) holds the ladder and `RingController` climbs it.

| Level | Standard timing (gentle / adaptive / aggressive) | What the phone does |
| --- | --- | --- |
| 1 Normal alarm | 0 s | Ring at the ramp (2.3); one buzz |
| 2 Increased volume | 20 / 10 / 5 s | Player at the ramp × 1.4; alarm stream raised to 70 % |
| 3 Continuous vibration | 40 / 22 / 10 s | Volume × 1.5; repeating vibration, alarm usage |
| 4 Wake challenge | 60 / 35 / 18 s | Volume × 1.6; the ring screen opens the wake check by itself, if the plan has one |
| 5 Trying backups | 120 / 75 / 40 s | Volume × 1.8, alarm stream full; each backup channel tried once |

- **Which ladder.**
  - The plan's own ladder: the server personalised it to how this person wakes
    (`personalizeEscalationPlan`).
  - The standard ladder for the plan's strategy, if the plan has none or it
    doesn't make sense: no level at 0 s, levels out of order, unknown fields
    or backup kinds. The ring log says which ladder was used and why.
- **Unmissable alarms always get the full ladder** (`critical` in the ring plan):
  - every level, every backup channel, each level at least as strong as the
    standard one;
  - **never later than the standard timing**, whatever the personal plan holds
    back.

  The web's own critical ladder can climb *slower* than standard for an easy
  waker, because personalisation stretches the timeline by the pace factor
  (level 5 at 94 s instead of 75 s, adaptive). The phone caps it at standard.
  An unmissable alarm going off while another rings brings its full ladder to
  that ring.
- **Volume.** The player plays at the ramp × the level's factor, never past
  full. The alarm stream is raised from the 40 % floor at factor 1 to full at
  1.8, never below what the user set, and put back afterwards.
- **A slow pass climbs to the top.** A wake check solved but scoring under
  `minConfidence` sends the ring straight to the top level, as the web does.
- **Backups are reported honestly.** No backup channel has a transport on the
  phone yet (prompt 3.3), so each reports `not_configured` and sends nothing,
  and the report says so.
- **Timing.** The ladder is checked every 0.5 s against the time since the
  ring started, so each level arrives within half a second after its time,
  never before it.

### What the server learns, and a fix to it

Every stopped ring reports the level it had reached (escalate, with `at`):

- **What it feeds.** That level is what `deriveEscalationProfile` learns the
  personal ladder from, through `ringPlanServer.ts`.
- **What was wrong.** Until 2.6, the web sent escalate **only when a ring
  reached level 5**. The profile therefore saw only the hardest mornings, which
  pulled it towards "needs level 5": a faster ladder for everyone with three
  such mornings.
- **The fix.** Both clients now report every stopped ring's level
  (`lib/ringFlow.ts`, `SyncCalls.java`). A ring nobody answered reports no wake
  level, because it isn't one.
- **`at` on escalate.** The escalate route now accepts `at` like the other
  ring routes, so a queued escalation is recorded when it happened.

### Tests

| Where | What |
| --- | --- |
| JVM, `EscalationLadderTest` | The standard ladder equals `buildEscalationPlan` for every strategy. The 12 non-critical personalised ladders from the TypeScript table (`lib/escalation.parity.test.ts`) are climbed exactly as written. **Unmissable:** all 24 personalised ladders, plus their held-back twins, get every level and backup and are never later than standard. An easy waker's held-back backups stay held back unless unmissable. Stage boundaries to the millisecond. A nonsensical ladder falls back to the standard one |
| JVM, `RingControllerTest` | Each stage arrives at its time, and only once. Volume rises by level. No check is prompted when the plan has none. A slow pass goes to the top. The level reached is what's queued. An easy waker climbs slower without backups; a hard waker climbs sooner. **An unmissable alarm climbs the full ladder at standard timing**, also when it joins a ring already going |
| JVM, `RingTuningTest`, `BackupsTest`, `SyncCallsTest` | Stream index and player volume per factor; backups report `not_configured` in the route's shape; escalate is sent with the level and `at` |
| Vitest and API | Every dismissed ring reports its level; escalate takes `at`; late reports are recorded in order |
| On the device | `theLadderClimbsOnTheDevice`: levels on time, vibration from level 3, the check prompted, the stream full at the top, backups recorded, volume put back, escalate queued at level 5. `anUnmissableAlarmGetsTheFullLadderOnTheDevice`: a slow personal ladder with no backups reaches the backups at the standard 40 s. `atTheChallengeLevelTheCheckOpensByItself` |

## The bedtime check (prompt 3.1)

Before bed, the phone checks everything that can silently stop tomorrow's
alarm. Everything is native (`Preflight*.java`), so it works with the app
closed, before the first unlock and offline; the web app only passes on the
planned bedtime and links to it.

### What is checked

`Preflight.java` decides; `PreflightProbe.java` reads the phone. Each check is
PASS, FAIL, UNVERIFIED (the phone can't read it: shown as "check yourself",
never as passing) or CONFIRMED (the user said they did it: shown as their word).

| Check | Fails when | Fix (one tap) |
| --- | --- | --- |
| Alarms & reminders | Android 12/12L with exact alarms turned off; or refused with no setting | Opens the setting (12/12L) |
| Notifications | Off: the ring screen and Stop can't show | Opens SomniAI's notification settings |
| Alarm screen over the lock screen | Android 14+ with the full-screen permission off | Opens that permission |
| Battery optimisation | Optimised **on a brand with its own battery manager** (Xiaomi, Realme, Oppo, Vivo, Samsung, OnePlus). Elsewhere it passes: Android delivers alarm-clock alarms through Doze, as the 2.7 matrix showed | Opens the battery-optimisation list. Not the direct "ignore optimisations" request: that needs REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, which Google Play restricts |
| The brand's own settings | Always UNVERIFIED on those brands until the user confirms: no public API reads autostart or the brand's manager. The steps per brand are dontkillmyapp.com's | Tries the brand's known autostart/battery screens (not public APIs: each tried in turn), else SomniAI's app info; "I've done these" records the user's word |
| Alarm volume | At the lowest Android reports to apps (0 on some phones; many stop the alarm stream at 1, and some report 3 to apps) | Raises the alarm stream to 70 %, with the volume panel shown |
| Do Not Disturb | Total silence on; or priority mode that blocks alarms, now or when a schedule turns it on (UNVERIFIED if the policy can't be read) | Opens the Do Not Disturb (Modes) settings |
| Battery | Below 25 % and not charging | None to tap: the screen says plug in |

### When it runs

`PreflightSchedule.java`: half an hour before bedtime. Bedtime is the wake
plan's, if the user asked the app for a bedtime reminder and it falls in the
night before the alarm (`setBedtime` from the page); otherwise eight hours
before the next alarm. An alarm set later than that (at bedtime) is checked a
minute after it is set. Once per alarm, never within an hour of it.
`PreflightReceiver.update` is called whenever the alarms change, and never
throws, so it can't get in the way of setting an alarm. The check is an exact
alarm while idle, not an alarm clock, so it doesn't show as the next alarm.

If anything needs attention, one notification ("Before bed: 2 things could stop
your 7:00 alarm") opens the check; if everything passes, nothing is posted. The
check screen (`PreflightActivity`) lists every check, re-checks when the user
comes back from a fix, and opens each fix in its own task so Back returns to it.

### The web app

Plugin API 3 adds `preflight()` (the verdicts), `openPreflight()` and
`setBedtime()`. The alarm list shows "Tonight's alarm check: …" with a link to
the screen (`app/page.tsx`, `lib/nativePreflight.ts`); saving a bedtime
reminder in the wake plan passes the bedtime to the phone.

### Tests

| Where | What |
| --- | --- |
| JVM, `PreflightTest` | Every check, every branch: exact-alarm states, notifications, full screen, battery optimisation per brand, the manufacturer check never passing unread, every brand's steps, the volume minimum, each Do Not Disturb mode with and without alarms allowed, battery level and charging, brand detection |
| JVM, `PreflightScheduleTest` | Planned and default bedtime, another night's plan ignored, an alarm set at bedtime, not within the hour, once per alarm, never in the past |
| Vitest | Passing the bedtime to the phone, an app without the check, the page's summary line |
| Device, `scripts/preflight-device.sh` | Each setting made to fail, detected, its fix tapped on the screen, put back; the bedtime notification posted (and not, when all pass). On the phone in `DEVICE_TESTS.md`; in CI on API 26, 32 and 35 |
