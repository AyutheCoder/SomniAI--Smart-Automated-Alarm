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
| 2 | Ringer switched to **silent** | It still rings out loud and vibrates |
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

Record the date, phone model and Android version, and the result of each step.
