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
  installed, so from 2.5 the web code must check the native plugin's version
  before using it.

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
| Vibration | A repeating waveform with alarm usage: `VibrationAttributes.USAGE_ALARM` on 13+, `AudioAttributes.USAGE_ALARM` before. | |
| Wake lock | Partial, `SomniAI:ring`, with a timeout just past the longest ring | |
| Over the lock screen | A notification in the alarm category, `VISIBILITY_PUBLIC`, on the `ringing` channel (importance HIGH, no channel sound or vibration). Its full-screen intent opens `RingActivity`, which uses `showWhenLocked` and `turnScreenOn` (window flags on 8.0). | `setFullScreenIntent` Javadoc: it needs a channel of importance HIGH or above. While the phone is in use, a heads-up is shown instead. Without `USE_FULL_SCREEN_INTENT` it is "heads up notification even when the screen is locked or turned off", persistent for only 60 s. Google Play: on 14+ the permission is granted by default only to "calling or alarm" apps, after a Play Console declaration (7.5). `ringStatus()` reports it, and `openFullScreenIntentSettings()` opens the setting. |
| Silent mode | Unaffected: the alarm stream isn't a ringer-mode stream | On-device test, and a locked-emulator run |
| Do Not Disturb | Priority mode lets alarms through when the "Alarms" exception is on, which is the default. "Alarms only" lets the alarm category through. **Total silence** (`INTERRUPTION_FILTER_NONE`) mutes "all audio streams (except those used for phone calls) and vibrations". No app can ring through it. Each ring records the DND state, the ringer mode and the alarm volume in the log, so a silent ring can be explained afterwards. | `NotificationManager` Javadoc |
| How long it rings | Up to 20 minutes, then it stops and is logged as `unanswered`. Prompt 2.6's escalation will revisit this. | |
| Stopping | Stop on the ring screen. Sound, vibration, wake lock, the raised volume, the notification and the service are all released. The occurrence is logged as `dismissed`, and stopping doesn't unlock the phone. | Tests, and the locked-emulator run |
| Two alarms at once | The second joins the ring already going, and one Stop ends both | Tests |
| Process killed mid-ring | `START_REDELIVER_INTENT`: Android restarts the service and it rings again rather than falling silent | |

**Until prompt 2.4, Stop dismisses without a wake check,** even when the ring
plan requires one. No alarm reaches this code from the web app before prompt
2.5, so nobody can rely on this gap yet. Prompt 2.4 adds the native challenge
in front of Stop.

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
