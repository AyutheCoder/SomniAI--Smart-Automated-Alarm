# Device tests

Behaviour that only a device can show, with the date, the device and its
Android version. Emulator results are labelled as such: they show the code
works, not that a given phone's battery manager leaves it alone.

The matrix first (prompt 2.7): every condition that can stop an alarm, on the
emulator and a phone. Then each prompt's own device checks, 2.1 to 2.6, and the
bedtime check (3.1).

How to run the alarm checks: `ANDROID.md`, "Checking alarms on a device".

## The device matrix (prompt 2.7)

Every condition that can stop an alarm from ringing, run on a phone. Most of
it is scripted: `scripts/device-matrix.sh` sets each condition over USB, sets a
test alarm a minute or two ahead, collects the evidence, stops the alarm and
puts the condition back. It never sets a PIN, and it restores everything it
changes. The rest, the manufacturer's battery manager and a real night, are
done by hand with the steps below.

### Conditions

| # | Condition | How it is run | What "pass" means |
| --- | --- | --- | --- |
| 1 | Screen locked | Script (`locked`): screen off before the alarm | The screen turns on, the ring screen shows over the lock screen, and alarm audio plays |
| 2 | Silent mode | Script (`silent`): ringer set to silent | It rings out loud; the ring log says "ringer silent"; alarm audio is not muted |
| 3 | Do Not Disturb | Script (`dnd`): priority-only, Android's default exceptions (alarms allowed). Also by hand with your own DND settings | It rings. If your DND blocks alarms, or is set to Total silence, Android mutes every alarm; that's a setting, not a fault |
| 4 | Battery Saver | Script (`saver`): Battery Saver on, phone reported unplugged | It rings on time |
| 5 | Rebooted overnight | Script (`reboot`): reboots, alarm 5 minutes later, never unlocked. Then once by hand overnight | It rings before anyone unlocks the phone |
| 6 | Time zone changed | Script (`timezone`): to another zone and back while an alarm is set | Rescheduled to the same wall-clock time in each zone; rings at the right time |
| 7 | App force-stopped | Script (`forcestop`): force-stop, then open the app | Android deletes the alarm (it does for every app); opening SomniAI restores it and it rings |
| 8 | Airplane mode | Script (`airplane`) | It rings and stops; the result waits in the queue until the network is back |
| 9 | Battery under 15 % | Script (`battery15`): battery reported at 10 %, unplugged. Also once for real | It rings on time |
| 10 | Manufacturer battery manager | **By hand**, brand by brand (below) | It rings after the phone has been left alone, in the manufacturer's default settings |
| + | Doze, deep idle | Script (`doze`): forced deep idle, unplugged | It rings on time |
| + | Battery usage "Restricted" | Script (`restricted`): Android's per-app Restricted battery setting | It rings. Android's documentation says alarms are "restricted" here and doesn't say whether alarm-clock alarms are exempt, so this tests it |
| + | Standby bucket "restricted" | Script (`bucket`) | It rings. Android allows "one alarm per day" in this bucket; this tests whether that limits alarm-clock alarms |

Rows marked + aren't in the prompt's list. They're Android's own ways of
restricting an app, which a phone can be in without the user knowing.

### Which conditions need a particular phone

The emulator and stock Android (Pixel, Motorola, Android One) behave like each
other. Manufacturers add their own battery managers on top, and those are what
most often stop alarms. The settings named here are quoted from
dontkillmyapp.com (read 2026-10-24); the menus vary by model and version.

| Brand | What can stop SomniAI's alarm | Conditions to test on that brand |
| --- | --- | --- |
| **Samsung** (One UI) | "Put unused apps to sleep" / "Deep sleeping apps": "After 3 days any unused app will not be able to start from background (e.g. alarms will not work anymore)". "Adaptive battery". Samsung may put an app back to sleep after you take it off the list | 10 over **3+ days without opening SomniAI**; 5 and 7 |
| **Xiaomi** (MIUI / HyperOS) | Autostart off by default ("Background autostart"), Battery saver per app, "MIUI optimization"; apps swiped away can be killed | 5 (reboot, autostart), 10, process killed by swiping away |
| **Oppo** (ColorOS) | "Allow Auto Start-up", background activity, "Background services are killed every time you turn the screen off" | 1 (screen off), 5, 10 |
| **Realme** (realme UI) | "Allow auto-launch", "Allow background activity", "Sleep stand-by optimization" at night, App quick freeze; and alarm apps need "Display pop-up windows of applications running in the background" to show the ring screen | 1 (ring screen over the lock screen), 5 (overnight), 10 |

Until prompt 3.1's bedtime pre-flight check exists, the fix on these phones is
for the user to exempt SomniAI, as follows. Menu names are dontkillmyapp.com's
and differ between versions.

- **Samsung:**
  - Device care > Battery > (⋮) > Settings: turn off "Put unused apps to sleep"
    and "Auto-disable unused apps".
  - Remove SomniAI from "Sleeping apps" and "Deep sleeping apps", and add it to
    "Never sleeping apps".
- **Xiaomi:**
  - Settings > Apps > SomniAI > App permissions: turn on "Background autostart"
    (older MIUI: Security app > Permissions > Auto-start).
  - Settings > Apps > SomniAI > Battery saver: "No restrictions".
  - Lock SomniAI in recents (drag it down, or press and hold for the padlock).
- **Oppo / Realme:**
  - Settings > Battery > Power saving settings > App battery management >
    SomniAI: turn on "Allow auto-launch", "Allow foreground activity" and
    "Allow background activity".
  - Turn off "Sleep stand-by optimization".
  - **Realme:** Settings > Apps > Special access: allow SomniAI to "Display
    pop-up windows of applications running in the background", or the ring
    screen can't open.

### Running it on your phone

1. **Phone ready.**
   - Settings > About phone: tap "Build number" 7 times to enable Developer
     options.
   - Settings > System > Developer options: turn on "USB debugging" (on Xiaomi
     also "USB debugging (Security settings)").
   - Connect the USB cable and accept the "Allow USB debugging?" prompt.
   - `adb devices` (in `%LOCALAPPDATA%\Android\Sdk\platform-tools`) shows the
     phone as `device`.
2. **App installed.** `npm run android:build`, then `npm run android:run`.
   Open SomniAI once, and allow notifications if asked (the script also
   grants them). On a phone, the debug build shows "Can't reach SomniAI right
   now": it looks for the dev server at the emulator's address. The matrix
   doesn't need it. Keep it that way while the matrix runs: a signed-in app
   reconciles with the server's list and would remove the test alarms.
3. **The scripted conditions** (about 35 minutes; leave the phone alone and
   plugged in):
   ```bash
   export MSYS_NO_PATHCONV=1      # Git Bash only
   bash scripts/device-matrix.sh
   bash scripts/device-matrix.sh reboot
   ```
   The results go to `device-matrix-results.md`, one row per condition with
   the evidence.
4. **Manufacturer battery manager** (by hand).
   - Leave your phone's battery settings for SomniAI **as they come**, without
     exempting it.
   - Set an alarm for 2 hours ahead:
     `adb shell am broadcast -a app.somniai.alarm.debug.SCHEDULE -n app.somniai.alarm/.alarms.DebugAlarmReceiver --ei minutes 120 --ez check false`
   - Swipe SomniAI away from recents, lock the phone, and don't touch it until
     the alarm time. Note whether it rings.
   - On Samsung, also do it once after **3 days without opening SomniAI**.
5. **One real night.** Set an alarm in the app for the morning, then
   reboot the phone before you sleep and don't unlock it. Note whether it
   rang on time.
6. **Send me the results.** Paste `device-matrix-results.md` and what you saw
   in steps 4 and 5, with the phone's model and Android version. I'll record
   them here and fix every failure.

### Results

Emulator, Medium Phone AVD, Android 17 (API 37), 2026-10-24:

| Condition | Result | Fired late by | Evidence |
| --- | --- | --- | --- |
| Screen locked (off) | Pass | 219 ms | alarm audio unmuted; ring screen in front |
| Silent mode | Pass | 148 ms | ringer silent; alarm audio unmuted; ring screen in front |
| Do Not Disturb (priority, Android's default exceptions) | Pass | 381 ms | ringer silent; DND priority; alarm audio unmuted; ring screen in front |
| Battery Saver on (unplugged) | Pass | 278 ms | Battery Saver on; alarm audio unmuted; ring screen in front |
| Battery under 15 % (reported 10 %, unplugged) | Pass | 145 ms | alarm audio unmuted; ring screen in front |
| Airplane mode | Pass | 223 ms | result queued offline (3 calls); alarm audio unmuted; ring screen in front |
| Time zone changed (to Europe/London and back) | Pass | 106 ms | rescheduled to the same wall-clock time in London (2026-10-24T19:32:00Z), and back; alarm audio unmuted; ring screen in front |
| App force-stopped, then opened | Pass (as designed: rings once reopened) | 532 ms | deleted by Android on force-stop, restored on opening; alarm audio unmuted; ring screen in front |
| Doze (deep idle, forced) | Pass | 316 ms | deep idle; alarm audio unmuted; ring screen in front |
| Battery usage set to Restricted (Android setting) | Pass | 284 ms | alarm audio unmuted; ring screen in front |
| Standby bucket restricted | Not applicable: Android kept the app at bucket 20 | 294 ms | bucket requested 45, Android kept 20; alarm audio unmuted; ring screen in front |
| Rebooted (not unlocked afterwards) | Pass | 2767 ms | booted before the alarm time; alarm audio unmuted |

Full evidence for each row: `device-results/emulator-api37-2026-10-24.md`. The
emulator's alarm volume reads 7/7 throughout: a shell can only set the
"default" output's volume on this image, not the speaker's, and an earlier run
had left the speaker at 7 (the defect fixed below).

**Found and fixed while running the matrix on the emulator:**

- **A reboot or crash mid-ring left the user's alarm volume raised.** The
  ladder raises the alarm stream and puts it back when the ring ends, but a
  ring that never ended (the phone rebooted, the process died) never put it
  back. The original level and the raised one are now kept on the phone
  (`AlarmVolume`), written before the raise, and put back at the next app
  start or boot. As before, it is put back only if the user hasn't changed it
  since. Test: `aVolumeRaiseLeftByARebootMidRingIsPutBackAtTheNextStart`, on
  the device.
- **The script itself, three times,** before its results could be trusted:
  - The emulator's 256 KB log buffer rotated the evidence out right after a
    boot. That read as "did not ring" for alarms that did ring: the first
    run's "Screen locked: FAIL" and one reboot run. The script now enlarges the
    buffer and saves the full log on any failure.
  - It forced Doze after setting the alarm, and Android won't enter deep idle
    with an alarm clock that close.
  - It assumed `adb reboot` takes effect at once; on this emulator the
    shutdown outlasted the alarm.

**What Android itself does, established here:**

- **The restricted standby bucket can't apply to SomniAI.** Asked for bucket
  45, Android kept it at 20 (working set). AOSP's
  `AppStandbyController.getAppMinBucket` returns `STANDBY_BUCKET_WORKING_SET`
  for apps that `shouldGetExactAlarmBucketElevation`, and `setAppStandbyBucket`
  clamps every request to that floor, `am set-standby-bucket` included. The
  "one alarm per day" limit is therefore not reachable for an alarm-clock app
  on stock Android. A manufacturer's own manager is another matter (row 10).
- **"Restricted" battery usage did not stop the alarm.** Android's
  documentation says alarms are "restricted" there and doesn't mention
  alarm-clock alarms; on Android 17 it rang 284 ms late. Check it on your
  phone too (row +).

Phone, POCO M8 5G (Xiaomi), HyperOS 3.0, Android 16 (API 36), 2026-10-24,
SomniAI **not exempted** from anything (Autostart, battery saver and
notification settings as installed), plugged in over USB except where the
script reports the battery unplugged:

| Condition | Result | Fired late by | Evidence |
| --- | --- | --- | --- |
| Screen locked (off) | Pass (re-run) | 39 ms | over the lock screen; alarm audio unmuted; ring screen in front. First run: rang 58 ms late, but the script missed it (below) |
| Silent mode | Pass (re-run) | 32 ms | ringer silent; alarm audio unmuted; ring screen in front, over the lock screen |
| Do Not Disturb (priority, Android's default exceptions) | Pass | 70 ms | ringer silent; DND priority; alarm audio unmuted; ring screen in front |
| Battery Saver on (unplugged) | Pass | 34 ms | Battery Saver on; alarm audio unmuted; ring screen in front |
| Battery under 15 % (reported 10 %, unplugged) | Pass (re-run) | 27 ms | alarm audio unmuted; ring screen in front, over the lock screen |
| Airplane mode | Pass | 86 ms | result queued offline (3 calls); alarm audio unmuted; ring screen in front |
| Time zone changed (to Europe/London and back) | Pass | 54 ms | rescheduled to the same wall-clock time in London, and back; alarm audio unmuted; ring screen in front |
| App force-stopped, then opened | Pass (as designed: rings once reopened; re-run) | 29 ms | deleted by Android on force-stop, restored on opening; ring screen in front, over the lock screen |
| Doze (deep idle, forced) | Pass | 57 ms | deep idle; alarm audio unmuted; ring screen in front |
| Battery usage set to Restricted (Android setting) | Pass | 27 ms | alarm audio unmuted; ring screen in front |
| Standby bucket restricted | Not applicable: Android kept the app at bucket 20 | 27 ms | as on the emulator |
| Rebooted (not unlocked afterwards) | Pass | 336 ms | rescheduled at LOCKED_BOOT_COMPLETED, before any unlock, and again at BOOT_COMPLETED; ring screen in front, over the lock screen. HyperOS's Autostart (off by default) did not block either |
| **By hand:** swiped away from recents, then "clear all" | Pass | 415 ms | HyperOS killed the process (`Killing … SwipeUpClean`) but did not force-stop it: the alarm stayed in AlarmManager, and Android started the app again to deliver it. The phone was in use (another app in front), so Android showed the alarm as a heads-up notification, which popped up by itself; tapping it opened the ring screen and "Stop alarm" stopped it |
| **By hand:** nobody answers | Pass | 24 ms | rang through all five levels, stopped itself at the 20-minute cap, and was recorded as "unanswered", queued for the server |
| **By hand:** a real night, unplugged, maths wake check, 9:00 (2026-10-25) | Pass | 44 ms | The app's ring log: louder at 10 s, vibrating at 22 s, the check opened by itself at 35 s; "dismissed after 72 s at level 4; wake check passed, score 84, 0 wrong answer(s)". The tester: the ring screen came up by itself with the sum (7 × 11), and one correct answer stopped it |

Full evidence: `device-results/poco-m8-hyperos3-2026-10-24.md`.

**Found while running it on this phone, all in the test tool, all fixed:**

- **HyperOS's logging deleted the evidence.** This phone logs about 1 MB a
  minute, and Android's log daemon prunes the busiest sources' oldest lines
  first. Within minutes that took the script's marks (adb's shell logs every
  command it runs) and the app's own lines. So "Screen locked" read as "did
  not ring" for an alarm that rang 58 ms late, and each read of the log took
  about 13 s. The script now copies the app's lines to the computer as they
  are written (`adb logcat -s SomniAlarm`), and reads them from there.
- **An alarm the script gave up on kept ringing** into the next condition. The
  first run's "Silent mode" joined that ring, so that row was re-run. The
  script now stops an alarm it gave up on, and waits for "dismissed" after
  every stop, writing NOT STOPPED if it doesn't come.
- **After the reboot, the script's "stop" was held back until the phone was
  unlocked.** Before the first unlock, Android only delivers broadcasts to
  direct-boot-aware receivers; the alarm's own receivers are, but the
  debug-only one the script uses wasn't. It is now. The alarm itself was
  unaffected: it rang until it was stopped on the phone.

**Seen once, not reproduced:** in the first run, the evidence read "ring screen
not in front" on three rows (Silent mode, Battery under 15 %, Force-stop). The
alarm rang in all three. That run's script didn't record what was in front
instead, and Silent mode had joined the earlier ring, which opens no new
screen. Re-run with the evidence naming what's in front, all three showed the
ring screen over the lock screen, and on the real morning it came up by
itself.

**The tester's feedback on the wake check:** "the question is very easy". It
was one sum from 6 × 6 to 13 × 13, and a single quick correct answer cleared
the test alarm's minConfidence of 70. Changed after 2.7 at the tester's
request: three sums in a row, each a × b + c × d (2 to 9 times 3 to 12), with
speed judged per sum (`ANDROID.md`, "The wake check"). On the same phone,
2026-10-28: the check opened by itself at 35 s, the three sums took 33 s with
no wrong answers, score 96, and the queued verify call carried `steps: 3`. The
tester: the sum fits on one line, Check stays above the keyboard, and the
difficulty is right.

**What HyperOS itself does, established here:**

- In its default settings, it didn't stop SomniAI's alarm under any scripted
  condition, after a reboot, after being swiped away, or after a night
  unplugged. None of the Xiaomi exemptions above was needed on this phone.
  Other Xiaomi models and versions may differ, which is why prompt 3.1 checks
  them before bedtime.
- Swiping the app away, or "clear all", kills it but doesn't force-stop it.
  Alarms survive that; they don't survive force-stop.
- While the phone is in use, Android shows a full-screen alarm as a heads-up
  notification instead (Google's Clock does the same). HyperOS let it pop up:
  its "Floating notifications" setting was on for SomniAI as installed.

## 2.1 Shell opens

| Date | Device | Android | Result |
| --- | --- | --- | --- |
| 2026-10-24 | Emulator, Medium Phone | 17 (API 37) | Pass: installs, opens, offline page shown (no dev server running) |
| 2026-10-24 | CI emulator | 15 (API 35) | Pass: installs, opens, `MainActivity` in front |
| | **Your phone** | | **Not run yet** |

## 2.2 Native alarm scheduling

Emulator: Medium Phone AVD, Android 17 (API 37), debug APK, 2026-10-24.
Times are the app's own log (`adb logcat -s SomniAlarm`); "late" is how long
after the scheduled minute the app's receiver ran.

| Condition | Result | Evidence |
| --- | --- | --- |
| Permission on API 37 | Pass | `USE_EXACT_ALARM: granted=true`; `SCHEDULE_EXACT_ALARM` not requested (capped at 32) |
| Fires with the app's process killed (SIGKILL, as the low-memory killer does) | Pass, 14.2 s late | AlarmManager dispatched at +1.2 s; a fresh process was started for the receiver and took ~13 s to cold-start on this memory-starved emulator (host had ~1.7 GB free). A second run: 3.1 s late |
| Survives a reboot | Pass, 1.3 s late | `LOCKED_BOOT_COMPLETED` and `BOOT_COMPLETED` both rescheduled it; it fired at the set time after the reboot |
| Survives a reboot **with a PIN, never unlocked** | Pass, 0.7 s late | User state `RUNNING_LOCKED` throughout; rescheduled on `LOCKED_BOOT_COMPLETED` from device-protected storage and fired before anyone unlocked |
| Time zone changed (Asia/Kolkata to Europe/London) | Pass | Rescheduled on `TIMEZONE_CHANGED` to 04:52 London time |
| Time changed by hand | Pass, 0.14 s late | Rescheduled on `TIME_SET`; fired at 04:52:00 local |
| Repeating alarm across a real DST change | Pass | After firing at 04:52 BST on 24 Oct, next was 04:52 GMT on 25 Oct (London falls back that night): 25 h later, same clock time |
| App updated (`adb install -r`) | Pass | Rescheduled on `MY_PACKAGE_REPLACED` |
| App **force-stopped** | Alarm deleted by Android, as documented; restored on next open | AlarmManager removal history `Reason=pi_cancelled`. Opening the app rescheduled it (app start, and `LOCKED_BOOT_COMPLETED`/`BOOT_COMPLETED` on leaving the stopped state). No app can ring while force-stopped; see `ANDROID.md` |

CI emulators (`scripts/android-alarm-check.sh`, every push). First green run:
40043717343, 2026-10-24. "Fired in" is a new process; the one that set the
alarm had been killed.

| Android | What it checks | Result |
| --- | --- | --- |
| 8.0 (API 26) | no permission needed; fires with process killed | Pass, 35 ms late (killed pid 4900, fired in 5435) |
| 12L (API 32) | access off: alarm saved as `waiting_for_permission`; on: rescheduled on `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`; fires with process killed | Pass, 199 ms late (killed 3828, fired in 7061) |
| 15 (API 35) | `USE_EXACT_ALARM` granted, `SCHEDULE_EXACT_ALARM` not requested; fires with process killed | Pass, 11 ms late (killed 2781, fired in 3356) |

### On your phone (not run yet)

Record date, phone model and Android version for each.

| Condition | Result |
| --- | --- |
| Alarm set 2 minutes ahead fires after swiping the app away from recents | |
| Alarm set 2 minutes ahead fires with the screen off and the phone locked | |
| Alarm set ~5 minutes ahead fires after a reboot, without unlocking the phone | |
| After force-stop, the alarm is restored as soon as the app is opened again | |

## 2.3 Ringing

Emulator: Medium Phone AVD, Android 17 (API 37), 2026-10-24, emulator audio on.

| Condition | Result | Evidence |
| --- | --- | --- |
| On-device tests (`RingServiceTest`, 6) | Pass, 6/6 | Foreground with the full-screen alarm notification; alarm-stream playback; wake lock held; ramp rises; volume floor raised and restored; silent mode plus DND priority; second alarm joins; dismissal leaves nothing behind |
| Real alarm, phone **locked with a PIN, screen off, silent mode, DND priority** | Pass | Screen woke (`mWakefulness=Awake`). `RingActivity` was the resumed activity with the keyguard still showing. `MediaPlayer usage=USAGE_ALARM state:started mutedState:none`. Service `isForeground=true types=0x00000400` (systemExempted). Wake lock `SomniAI:ring` acquired at 13:21:00.713, so it rang 0.7 s after the minute |
| Stop on the ring screen | Pass | Logged `dismissed after 50 s`. Afterwards: no ring service, no alarm-stream player, no ring notification, wake locks `size=0` (released 13:21:51.654), keyguard still showing |
| `android-alarm-check.sh` with ringing and dismissal | Pass | Fired with the process killed, rang in the foreground, gone after dismissal |

The emulator's own System UI showed an "isn't responding" dialog over the ring
screen (host memory pressure, as before); "Wait" cleared it. It is not SomniAI.

CI emulators run the same on-device tests and alarm check on every push. First
run, 40076474483 (2026-10-24):

| Android | Alarm check (process killed, then ring and dismiss) | On-device tests |
| --- | --- | --- |
| 8.0 (API 26) | Pass: fired 43 ms late, rang in the foreground, gone after dismissal | 5 passed, **1 skipped**: silent + DND, because that image's shell can't set the ringer mode or DND. Not covered on 8.0 by CI |
| 12L (API 32) | Pass: 141 ms late (after the permission off/on check) | 6/6 |
| 15 (API 35) | Pass: 137 ms late; service type `0x400` checked | 6/6 |

### On your phone: checklist

Install the debug build over USB (`npm run android:build`, then
`npm run android:run`). Open SomniAI once. On Android 13+, allow notifications
when asked, or turn them on in Settings > Apps > SomniAI. Set test alarms from a
computer with the commands in `ANDROID.md`, "Checking alarms on a device"
(`--ei minutes 2`). After each check, send `LIST` and keep the `SomniAlarm` log
lines: they record the sound used, the alarm volume, ringer mode, DND and
full-screen state for every ring.

Record the date, phone model and Android version, and pass or fail for each:

| # | Set up, then wait for the alarm | Pass when |
| --- | --- | --- |
| 1 | Screen off, phone locked with your PIN or fingerprint | The screen turns on and the ring screen shows over the lock screen without unlocking. Sound starts quiet and gets louder over about 30 s. The phone vibrates. |
| 2 | Ringer switched to **silent** | It still rings out loud, and vibrates from the ladder's vibration level (since 2.6) |
| 3 | **Do Not Disturb** on, as you normally use it | It still rings. If it doesn't, note your DND exceptions: an alarm can't ring when "Alarms" is turned off in DND or in "Total silence" |
| 4 | Alarm volume turned right down (Settings > Sound > Alarm volume) | It rings at about 40 % volume, and your alarm volume is back where you left it afterwards |
| 5 | Phone unlocked and in use | A heads-up "Alarm" notification appears and the sound plays. Tapping it opens the ring screen. |
| 6 | Press **Stop alarm** | Sound and vibration stop at once, the notification disappears, and the phone stays locked |
| 7 | Don't touch it | It keeps ringing, then stops by itself after 20 minutes. The log says `unanswered`. |
| 8 | Android 14+ only: Settings > Apps > SomniAI > "Full screen notifications" (name varies) | It shows as allowed. If it isn't, check 1 shows only a heads-up: note that as a fail with this cause. |
| 9 | Reboot, don't unlock, alarm 5 minutes after boot | Rings over the lock screen before you ever unlock |
| 10 | Your phone's battery saver on | Rings as in check 1 |

Checks 1–3 and 6 are the ones the 2.3 gate asks for: rings on a locked screen,
in silent mode and with DND on, and stops cleanly.

## 2.4 Wake check and offline sync

Emulator: Medium Phone AVD, Android 17 (API 37), 2026-10-24.

| Condition | Result | Evidence |
| --- | --- | --- |
| On-device tests (14: ring service, ring screen, sync) | Pass, 14/14 | After the two fixes below. Two emulator ANR dialogs (dialer, System UI) had to be cleared first; they took window focus from the tests |
| **Airplane mode on**, screen off, alarm with a check (minConfidence 70) | Pass | Rang over the lock screen. A wrong answer gave "Not quite. Here's a new one." and a new problem, and it kept ringing. The right answer stopped it: `dismissed … wake check passed, score 74, 2 wrong answer(s)`. Three calls (fire, verify, dismiss) were queued, and WorkManager's job was waiting on `CONNECTIVITY` |
| Network back (airplane mode off) | Sync attempted, result kept | WorkManager ran the sync about 13 s after the network returned. No server was running at the dev address, so it timed out (`last status -1`) and kept everything for its retry |
| Result appears in history | **Not run on the emulator** | Needs a running server, a signed-in account and a real alarm id: phone checklist below. The server side is covered by `tests/api/alarm-actions.test.ts`, "a ring reported late", which records it at the real times and still counts it as verified |

Found by driving it on the emulator, both fixed, each with a test that failed
before the fix:

- **The keyboard covered the Check button.** Android 15+ draws edge to edge,
  so the window no longer shrank for the keyboard.
- **An alarm going off just as another was dismissed crashed the app**
  (`ForegroundServiceDidNotStartInTimeException`): the race test failed 3/3
  before the fix and passed 3/3 after.

CI emulators, run 40082801841 (2026-10-24):

| Android | Alarm check | On-device tests (14) |
| --- | --- | --- |
| 8.0 (API 26) | Pass | 12 passed, **2 skipped**: silent + DND (the image's shell can't set them), and the keyboard check, because "a system window lies over the ring screen" where the test touched Stop. **Not confirmed what that window is.** Most likely the alarm's own heads-up notification, which old Android can lay over the app. On an Android 8 or 9 phone, check whether anything covers Stop when the alarm rings (checklist step 8) |
| 12L (API 32) | Pass | 14/14 |
| 15 (API 35) | Pass | 14/14 |

### On your phone: checklist

You need the debug build installed (2.3 checklist), the dev server running
where the phone can reach it (`ANDROID.md`, "Running it"), and to be **signed in
in the SomniAI app** on the phone.

1. In the app, create an alarm (any time; it is only used for its id) and copy
   its id from the address bar or the API (`/api/alarms`).
2. From the computer:
   `adb shell am broadcast -a app.somniai.alarm.debug.SCHEDULE -n app.somniai.alarm/.alarms.DebugAlarmReceiver --ei minutes 2 --es id <that id>`
3. Turn on **airplane mode** and lock the phone.
4. When it rings, give one **wrong** answer.
   **Pass:** a new problem, and it keeps ringing.
5. Answer correctly.
   **Pass:** it stops.
6. Before reconnecting, send
   `adb shell am broadcast -a app.somniai.alarm.debug.LIST -n app.somniai.alarm/.alarms.DebugAlarmReceiver`
   and check `adb logcat -s SomniAlarm` says it is waiting to sync 3 calls for
   that id.
7. Turn airplane mode off and wait a minute.
   **Pass:** `sync: sent 3`, and in the app's history the alarm shows as
   verified at the time you stopped it, not the time it synced.
8. Android 8 or 9 phones only: when it rings with the phone unlocked, check
   that nothing (such as the alarm's notification) covers Stop or Check.

Record the date, phone model and Android version, and the result of each step.

## 2.5 One source of truth

Emulator: Medium Phone AVD, Android 17 (API 37), 2026-10-24.

| Condition | Result | Evidence |
| --- | --- | --- |
| On-device tests (19, including the 5 `ReconcileTest`) | Pass, 19/19 | The keyboard test first skipped behind an emulator System UI ANR dialog; passed once that was cleared |
| The page in the app reaches the plugin | Pass | A page served at the app's server URL saw `native=true`, `version {api: 2}`, and its `reconcile` put the alarm |
| Edit an alarm, lock the phone, it fires at the new time | Pass | Set for 15:47, then edited by an app restart to 15:46. On the restart, the force-stop's lost alarm was first restored from the phone's store (`app_start`, `BOOT_COMPLETED`), then the page's reconcile moved it. It fired at 15:46:00.37 (194 ms late) with the ring screen on top, and **did not fire at 15:47** |
| The full app with a signed-in account against the real server | **Not run on the emulator** | Too much for this machine's memory alongside the emulator, and the e2e server's sign-in is bound to localhost. Covered in parts: Playwright with the real page and server and a stand-in phone, plus the bridge run above. Phone checklist below |

CI emulators, run 40086641380 (2026-10-24): all jobs green; the 5
`ReconcileTest` tests pass on API 26, 32 and 35. Skips: API 26 as in 2.4
(silent + DND, keyboard), and **the keyboard test on API 35 this time** (it
passed there in the previous run). A system window lay over the ring screen
where the test touched Stop, so the unconfirmed overlay from 2.4 is
intermittent and not only on Android 8. The test now names the window in its
skip message.

**Identified** in the next run, 40087235278: on API 26 the window in the way was
`Application Error: com.android.systemui`, the emulator's own System UI crash
dialog, not the alarm's heads-up. API 32 and 35 passed 19/19 in that run. So the
"unconfirmed overlay" noted in 2.4 is the emulator's System UI misbehaving, as
seen locally all along, not something users would meet. Checklist item 8 in
2.4 stays as a cheap check on a real Android 8 or 9 phone.

### On your phone: checklist

Debug build installed, the dev server running where the phone reaches it, and
signed in to the app on the phone. Record the date, phone model and Android
version, and pass or fail for each:

| # | Do | Pass when |
| --- | --- | --- |
| 1 | Open the app | Under "Adaptive Alarms" it says "Alarms ring from this phone, even with the app closed." |
| 2 | Add an alarm 3 minutes ahead, then use **Edit** to move it to 2 minutes ahead. Lock the phone | It rings at the new time, not the old one (the gate) |
| 3 | Add an alarm 2 minutes ahead, then turn it **Off**. Lock the phone | It doesn't ring |
| 4 | Add an alarm 2 minutes ahead and **delete** it. Lock the phone | It doesn't ring |
| 5 | Add an alarm 3 minutes ahead and swipe the app away from recents | It rings (the phone, not the page, rings it) |
| 6 | With the app open and an alarm due | It rings once, natively. The page never shows its own ringing screen on top |
| 7 | Delete an alarm on a computer (signed in to the same account), then open the app on the phone | It's gone from the phone: set a test alarm for that minute and it doesn't ring |

## 2.6 Escalation ladder

Emulator: Medium Phone AVD, Android 17 (API 37), 2026-10-24.

| Condition | Result | Evidence |
| --- | --- | --- |
| On-device tests (22, including the 3 ladder tests) | Pass, 22/22 | |
| **A real alarm left ringing**, screen off, standard adaptive ladder (10, 22, 35, 75 s) | Pass | Fired 17:14:00.217. Levels logged at +10.4, +22.4, +35.5 and +75.2 s, each within one 0.5 s tick after its time. At level 5 the alarm stream went 6 → 7 of 7 and all three backups reported `not_configured`. The check was already open when I came to stop it, opened by the challenge level. Stopped after 109 s at level 5 with score 78; the stream was put back to 6 |
| Sound start | About 1.2 s after the alarm fired, on this emulator | The player prepares the alarm sound before the first level is logged; the phone will show the real figure |

### On your phone: checklist

Set a test alarm 2 minutes ahead (`ANDROID.md`, "Checking alarms on a device";
it has a wake check and the standard adaptive ladder), lock the phone, and
**don't touch it** until step 6. Note the time it starts ringing.

| # | At about | Pass when |
| --- | --- | --- |
| 1 | 0 s | It rings quietly at first, with one buzz |
| 2 | 10 s | Clearly louder |
| 3 | 22 s | It starts vibrating continuously |
| 4 | 35 s | The ring screen shows the first sum ("Sum 1 of 3") without you pressing Stop |
| 5 | 75 s | Louder still, at full alarm volume |
| 6 | then | Solve all three: it rings until the last, then stops. Your alarm volume is back to where it was |

For an unmissable alarm, set one linked to a task marked critical or
must-not-miss in the app. Once 2.5 has put it on the phone, it reaches level 5
by the standard time even if your personal ladder is slower.

## 3.1 Bedtime check

Before bed, the phone checks everything that can silently stop tomorrow's
alarm and, if anything needs fixing, posts one notification that opens
"Tonight's alarm check": a pass/fail list with a fix on each failure
(`ANDROID.md`, "The bedtime check"). The decisions are JVM-tested
(`PreflightTest`, `PreflightScheduleTest`); this section is what only a phone
shows: that each failing setting is detected, and that its fix works.

`bash scripts/preflight-device.sh` does it for every setting an adb shell can
change: make it fail, check the verdict, tap the fix on the check screen, see
what the fix did, put the setting back. CI runs it on the API 26, 32 and 35
emulators. It only ever taps the check screen: if anything else is in front, it
touches nothing.

### Phone, POCO M8 5G (Xiaomi), HyperOS 3.0, Android 16 (API 36), 2026-10-28

| Setting made to fail | Detected | The fix | Result |
| --- | --- | --- | --- |
| Alarm volume at its lowest | fail | "Turn up" raised it from 3 to 11 of 15; the check then passed | Pass |
| Do Not Disturb, total silence | fail | "Open settings" opened Android 16's Modes screen | Pass |
| Battery at 10 %, unplugged | fail | none to tap: plugged in (or at 30 %) it passed | Pass |
| Notifications off | fail | "Turn on" opened SomniAI's notification settings | Pass |
| Full-screen alarm not allowed | fail | "Allow" opened the full-screen permission page | Pass |
| Battery optimisation on | fail (a Xiaomi) | "Open settings" opened the battery-usage list | Pass |
| Xiaomi's own settings | check yourself | "Open settings" opened HyperOS's Autostart manager; "I've done these" turns it into "done, you said" and back | Pass |
| Exact alarms turned off | not applicable | Android 13+ grants USE_EXACT_ALARM; there's nothing to turn off | N/A |
| Bedtime notification | | battery at 10 %: "Before bed: 1 thing could stop your 4:10 am alarm", opening the check; with everything passing: none | Pass |

CI, the same script on emulators, 2026-10-28 (run 40592750553): every case
passes or doesn't apply. API 32 is the only one where exact alarms can be
turned off: detected, and "Allow" opened "Alarms & reminders". On API 26 the
volume was detected but its fix couldn't be tapped: the emulator's System UI
crash dialog covered the screen (as in 2.4), so that case is recorded as
skipped, naming the window; that image's shell also can't set Do Not Disturb.
Each emulator's results are in its CI artifact (`preflight-results.md`).

Full evidence: `device-results/poco-m8-preflight-2026-10-28.md`. Before the
test, the check on this phone as it was: everything passed except the alarm
volume (1 of 15 on the speaker) and Xiaomi's settings (not yet confirmed).

**Found on the phone and fixed:**

- **The alarm volume can't reach zero here.** This POCO's alarm slider stops
  at 1 of 15, and Android tells apps the minimum is 3. "Above zero" would never
  fail, so the check fails at the lowest volume Android reports, and says the
  actual number ("Turned right down (1 of 15)").
- **A fix's settings page opened in its own task**, so coming back could land
  somewhere other than the check. Fixes now open in the check's task: Back
  returns to the check, which checks again.

**Faults in the test script, fixed before these results:**

- It set the full-screen permission at the package level; Android reads the
  app-wide (uid) mode. SomniAI's reading was right all along.
- It couldn't open the check screen once the app was in the background (a
  revoked permission restarts it): Android blocks a background app from opening
  a screen. A debug-only, DUMP-guarded alias now lets `am start` open it.
- Once, the screen hadn't come up in time and it **tapped the home screen,
  which opened another app**. It now touches nothing unless the check screen
  is in front, and a fix that wasn't tapped can't count as a pass (one run had
  reported Pass that way).
- `top | grep -q` under `pipefail` read as "not in front" (grep closing the
  pipe early), the 2.2 lesson again.
- The shell's volume command sets the "default" output, not the speaker the
  alarm plays on (as on the emulator in 2.7), so the volume is now set and read
  through the app. One early run raised this phone's speaker alarm volume from
  1 to 11 and couldn't put it back; the tester chose to keep it at 11.
- The notification list puts `user=` between the package and the id, and
  doesn't name what a tap opens; the script reads the pending intents for that.

### On your phone by hand: checklist

What a shell can't change, or needs a particular phone:

| # | Do this | Pass when |
| --- | --- | --- |
| 1 | Settings > Do Not Disturb (Modes on Android 15+): under what can interrupt, turn **Alarms** off. Open the check (in the app: "Tonight's alarm check", or the notification) | "Do Not Disturb: FIX THIS" (or "CHECK YOURSELF" if Android won't let SomniAI read the setting); "Open settings" lands where Alarms can be turned back on; after that it passes |
| 2 | Set an alarm for tomorrow morning in the app, leave one check failing (Xiaomi's settings unconfirmed is enough), and use the phone as usual | About 8 h 30 min before the alarm (or 30 minutes before the bedtime you planned in the app), "Before bed: … could stop your … alarm" arrives; tapping it opens the check |
| 3 | The same with everything passing | No notification |
| 4 | On a Samsung, Oppo, Realme, Vivo or OnePlus phone: open the check and tap the manufacturer's "Open settings" | It opens that brand's autostart or battery screen, or SomniAI's own app info if this version has none of the known ones; note which |
| 5 | On an Android 12 or 12L phone: turn off Settings > Apps > Special app access > Alarms & reminders for SomniAI | "Alarms & reminders: FIX THIS", "Allow" opens that page (CI covers this on the API 32 emulator) |
| 6 | Signed in, with the dev server: the app's alarm list | "Tonight's alarm check: all clear" (or how many things), and "Check and fix" opens the check |

## 3.2 Wake buddy

The pairing, the trigger timing and the rate limit are tested without a phone
(`BUDDY.md`, "Tests"). What only phones show: the push arrives, and its button
calls. This needs Firebase set up (`BUDDY.md`, "Setup") and two phones signed
in to two accounts on the same dev server.

### Phone and emulator, 2026-10-28

POCO M8 5G (HyperOS 3.0, Android 16) as the sleeper (account name left out here); the
Android 17 emulator (Google Play image) as the buddy, account "Buddy". Both on
`npm run dev:phone` through `adb reverse`, `npm run buddy:cron` running,
Firebase project set up as in `BUDDY.md`.

| # | Step | Result |
| --- | --- | --- |
| 1-2 | Code on the POCO, asked on the emulator, accepted on the POCO | Paired, both ways; both phones registered a real FCM token |
| 3-4 | Critical alarm "Buddy test" at 16:44, alert after 5 min, number shared; not answered | Checks at 16:45-16:48: "not yet". At **16:49:43: sent**; on the emulator at 16:49:57: "<name> hasn't confirmed they're awake", "Their "Buddy test" alarm went off 6 minutes ago and SomniAI hasn't heard back.", actions **Call <name>** and **Open SomniAI** |
| 5 | "Call <name>" tapped on the emulator | The dialler opened (`ACTION_DIAL`, `tel:` with the number); no call placed |
| 6 | Kept ringing | Every later check: "already"; no second alert |
| 7 | Critical alarm "Answered" at 16:55, solved at once | **No alert**, but only because the result was sent by hand at 16:59: see below |
| 8 | Ordinary alarm at 17:00, not answered | **No alert**: every check "ordinary", through and past 17:05 |
| 9 | Unpaired on the POCO | Pairing "ended"; every check after: 0 pairs |

**Found and fixed:**

- **A fresh "I'm awake" waited behind an old failed sync** (step 7). The
  phone's queue scheduled its sync with KEEP, and a sync that had failed
  earlier (the previous build's server address, 2.7's test alarms) was in an
  exponential back-off; the new result waited behind it. Sent by hand at 16:59,
  a minute before the alert was due. A new result now replaces a waiting sync
  (`ANDROID.md`, "The offline queue"); the on-device test for it failed with
  the old policy and passes with the new.
- **The app's alarm form couldn't make an alarm critical**: only an alarm from
  a task marked critical, or one with a wake check of 80 % or more, was. The
  form now has "Critical: must not miss" (a wake check at 85 %).
- **Google answers a malformed token with 400 INVALID_ARGUMENT**, not
  UNREGISTERED (seen against the real service); such a token is now forgotten
  at once instead of retried.

Not exercised on the devices: an ordinary alarm with the opt-in on (it needed
30 minutes since the last alert, the rate limit) and the daily limit. Both are
covered against the database in `tests/api/buddy.test.ts`.

### On two phones: checklist

Both phones on the same Wi-Fi as the laptop; `npm run dev`, `npm run buddy:cron`
running; the app built with `CAP_SERVER_URL=http://<laptop's address>:3000` so
both phones reach it, and installed on both.

| # | Do this | Pass when |
| --- | --- | --- |
| 1 | Phone A, account A: Wake buddy > "Get a code". Phone B, account B: enter it, "Ask to pair" | B shows "Waiting for A to accept"; nothing is paired yet |
| 2 | Phone A: "Accept" | Both show the other as their wake buddy; both say "This phone receives your buddy's alerts" |
| 3 | On A: add a phone number and turn on "Put my number in my alerts"; set the delay to 5 minutes. Set a critical alarm (a task marked must-not-miss, or the wake check at 80 % or more) 2 minutes ahead | — |
| 4 | Let it ring on phone A. Don't answer it | 5 minutes after the alarm, phone B shows "A hasn't confirmed they're awake", with "Call A" and "Open SomniAI"; `buddy:cron` prints "1 sent" |
| 5 | Phone B: tap "Call A" | The dialler opens with A's number filled in; nothing is dialled until B presses call |
| 6 | Wait 10 more minutes | No second alert for that alarm |
| 7 | A sets another critical alarm and answers it within the 5 minutes | No alert |
| 8 | An ordinary alarm on A, not answered | No alert. Turn on "Ordinary alarms too", repeat: an alert (once 30 minutes have passed since the last) |
| 9 | Phone B: "Unpair" | Both show no buddy; an unanswered critical alarm on A alerts nobody |

## 3.3 Backups

The channels' decisions and the server are tested without a phone
(`BUDDY.md`, "Tests"); the on-device test checks the ring asks for backups
without waiting and stops a rung device. What only devices show: a second
device really rings, and stops; a real text arrives.

Device A: phone, POCO M8 5G (Xiaomi), HyperOS 3.0, Android 16 (API 36).
Device B: emulator, Medium Phone AVD, Android 17 (API 37). Both on
`npm run dev:phone` through `adb reverse`, signed in to the same account,
debug APK built from `6fdd2d1`, 2026-10-29. Steps 1-3 pass; 4 and 5 (the text)
not run yet: they need Twilio (`BUDDY.md`, "Twilio setup").

| # | Result |
| --- | --- |
| 1 | Pass. Critical alarm: A at the backup level 45 s in, logs `secondaryAlarm: delivered; smartwatch: not_configured (…no watch app…); emergencyContact: not_configured (No emergency contact is set)` 2.3 s later; B logs `backup ring for … started` 4 s after A's backup level, rings `backup-…` as "… (from your other device)", louder in steps (levels 1-4, no wake check); A keeps ringing |
| 2 | Pass. A answered (wake check passed); A's queue sent the stop 18 s later, B logged `stopped: stopped on the other device` and was dismissed 19 s after A |
| 3 | Pass. B unlocked, so its ring showed as a heads-up notification ("Tap to stop", as for any alarm on an unlocked screen); tapped, "Stop alarm": B dismissed, A kept ringing until answered |

**First attempt failed, truthfully.** The first time, A's backups request ran
out its 20 s: the dev server was compiling the new route on that first request
(8.4 s, then 5.9 s more) with 0.6 GB of memory free, and the request was still
unfinished when A gave up. A reported all three backups `failed (couldn't reach
the server)`, and B didn't ring. Once compiled, the route answered in 2.3 s. A
production server is built ahead, so it doesn't compile on a request.

| # | Do this | Pass when |
| --- | --- | --- |
| 1 | Two devices (a phone and the emulator, or two phones) signed in to the same account on `npm run dev:phone`, both with "This phone receives your buddy's alerts". On device A, an alarm 2 minutes ahead; don't answer it | At the backup level (75 s; 40 s for a critical alarm) device B rings, "… (from your other device)", louder in steps; A keeps ringing; A's ring log says `secondaryAlarm: delivered` |
| 2 | Stop the alarm on A | B stops within a minute (the stop goes through A's queue) |
| 3 | On B, Stop instead | B stops; A keeps ringing until answered |
| 4 | Twilio set up; an emergency contact (your own second number, verified on a trial) with agreement ticked; delay 5 minutes; a critical alarm, not answered | At the backup level A's ring screen says "Mum will be told at …"; at that time the text arrives; the panel lists "your emergency contact was texted"; `buddy:cron` prints `emergencyContact` sent |
| 5 | The same, answered within the delay | No text |

