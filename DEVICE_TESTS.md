# Device tests

Behaviour that only a device can show, with the date, the device and its
Android version. Emulator results are labelled as such: they show the code
works, not that a given phone's battery manager leaves it alone. Prompt 2.7
turns this into the full condition matrix (silent mode, Do Not Disturb, battery
saver, manufacturer battery managers and so on).

How to run the alarm checks: `ANDROID.md`, "Checking alarms on a device".

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
| 4 | 35 s | The ring screen shows the maths problem without you pressing Stop |
| 5 | 75 s | Louder still, at full alarm volume |
| 6 | then | Solve it: it stops. Your alarm volume is back to where it was |

For an unmissable alarm, set one linked to a task marked critical or
must-not-miss in the app. Once 2.5 has put it on the phone, it reaches level 5
by the standard time even if your personal ladder is slower.
