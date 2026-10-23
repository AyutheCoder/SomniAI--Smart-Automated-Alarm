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

CI emulators (`scripts/android-alarm-check.sh`, each push):

| Android | What it checks | Result |
| --- | --- | --- |
| 8.0 (API 26) | no permission needed; fires with process killed | see the latest CI run |
| 12L (API 32) | access off: alarm waits; on: rescheduled on `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`; fires with process killed | see the latest CI run |
| 15 (API 35) | `USE_EXACT_ALARM` granted; fires with process killed | see the latest CI run |

### On your phone (not run yet)

Record date, phone model and Android version for each.

| Condition | Result |
| --- | --- |
| Alarm set 2 minutes ahead fires after swiping the app away from recents | |
| Alarm set 2 minutes ahead fires with the screen off and the phone locked | |
| Alarm set ~5 minutes ahead fires after a reboot, without unlocking the phone | |
| After force-stop, the alarm is restored as soon as the app is opened again | |
