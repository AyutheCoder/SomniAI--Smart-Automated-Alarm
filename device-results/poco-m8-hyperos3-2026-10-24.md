# Device matrix: POCO M8 5G, HyperOS 3.0, Android 16 (API 36), 2026-10-24

Output of `scripts/device-matrix.sh` on the phone, unedited except that the
home time zone and the regional model code are left out. SomniAI was not
exempted from anything. Summary and context in `DEVICE_TESTS.md`.

## First run, all conditions but reboot

The script still searched the phone's log here. "Screen locked: FAIL" is that
search failing: the app's own ring log has the alarm firing at the set time
(58 ms late) and ringing at alarm volume 15/15 until the script's next stop,
1122 s later. "Silent mode" joined that ring, and was re-run.

| Condition | Result | Evidence | When |
| --- | --- | --- | --- |
| **POCO M8 5G (Xiaomi), Android 16 (API 36)** | | | |
| Screen locked (off) | FAIL | did not ring by 21:53:18 (set for 21:37); 0 pending alarm(s) for the app; log:  | 2026-10-24 21:53 |
| Silent mode | Pass | set for 21:55; fired: fired matrix-silent 71 ms late; next DONE; ringing: joined an alarm already ringing; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer silent, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; ring screen: not in front | 2026-10-24 21:56 |
| Do Not Disturb (priority, Android's default exceptions) | Pass | set for 21:58; fired: fired matrix-dnd 70 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 6/15, ringer silent, do not disturb priority only, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; ring screen: RingActivity | 2026-10-24 21:59 |
| Battery Saver on (unplugged) | Pass | low_power=1; set for 22:01; fired: fired matrix-saver 34 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer normal, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; ring screen: RingActivity | 2026-10-24 22:01 |
| Battery under 15 % (reported 10 %, unplugged) | Pass | set for 22:03; fired: fired matrix-battery15 42 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer normal, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; ring screen: not in front | 2026-10-24 22:03 |
| Airplane mode | Pass | airplane_mode_on=1; set for 22:05; fired: fired matrix-airplane 86 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer normal, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; ring screen: RingActivity; queued 3 call(s) for the server; 18 waiting | 2026-10-24 22:05 |
| Time zone changed (to Europe/London and back) | Pass | set for 22:09 in the home zone; in Europe/London: matrix-timezone -> (time); back in the home zone: matrix-timezone -> (time); fired: fired matrix-timezone 54 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer normal, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; ring screen: RingActivity | 2026-10-24 22:09 |
| App force-stopped, then opened | Pass (as designed: rings once reopened) | after force-stop: alarm deleted by Android (0 AlarmManager entries for the app); on opening: matrix-forcestop -> 2026-10-24T16:42:00Z; fired: fired matrix-forcestop 40 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer normal, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; ring screen: not in front | 2026-10-24 22:12 |
| Doze (deep idle, forced) | Pass | Now forced in to deep idle mode; deep state IDLE when the alarm was set, IDLE just after; fired: fired matrix-doze 57 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer normal, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; ring screen: RingActivity | 2026-10-24 22:15 |
| Battery usage set to Restricted (Android setting) | Pass | set for 22:17; fired: fired matrix-restricted 27 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer normal, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; ring screen: RingActivity | 2026-10-24 22:17 |
| Standby bucket restricted | Not applicable: Android kept the app at bucket 20 | asked for 45 (restricted), got 20; set for 22:19; fired: fired matrix-bucket 27 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer normal, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; ring screen: RingActivity | 2026-10-24 22:19 |

## Re-run, with the log copied to the computer as it is written

| Condition | Result | Evidence | When |
| --- | --- | --- | --- |
| **POCO M8 5G (Xiaomi), Android 16 (API 36)** | | | |
| Screen locked (off) | Pass | set for 22:22; fired: fired matrix-locked 39 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer normal, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; isKeyguardShowing=true; ring screen: RingActivity | 2026-10-24 22:22 |
| Silent mode | Pass | set for 22:24; fired: fired matrix-silent 32 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer silent, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; isKeyguardShowing=true; ring screen: RingActivity | 2026-10-24 22:24 |
| Battery under 15 % (reported 10 %, unplugged) | Pass | set for 22:26; fired: fired matrix-battery15 27 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer normal, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; isKeyguardShowing=true; ring screen: RingActivity | 2026-10-24 22:26 |
| App force-stopped, then opened | Pass (as designed: rings once reopened) | after force-stop: alarm deleted by Android (0 AlarmManager entries for the app); on opening: matrix-forcestop -> 2026-10-24T16:59:00Z; fired: fired matrix-forcestop 29 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer normal, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; isKeyguardShowing=true; ring screen: RingActivity | 2026-10-24 22:29 |
| **POCO M8 5G (Xiaomi), Android 16 (API 36)** | | | |
| Rebooted (not unlocked afterwards) | Pass | set for 22:34; booted at 22:30:38, before the alarm time; rescheduled after android.intent.action.BOOT_COMPLETED after android.intent.action.LOCKED_BOOT_COMPLETED ; isKeyguardShowing=true; fired: fired matrix-reboot 336 ms late; next DONE; ringing: sound ALARM_SOUND; ladder standard adaptive (no ladder in the plan); alarm volume 15/15, ringer normal, do not disturb off, full-screen allowed; alarm audio: mutedState:none; mWakefulness=Awake; isKeyguardShowing=true; ring screen: RingActivity | 2026-10-24 22:34 |

## By hand

| Condition | Result | Evidence | When |
| --- | --- | --- | --- |
| Nobody answers | Pass | alarm set for 23:15 by the debug receiver, no wake check; fired 24 ms late; level 2 at 10 s, 3 at 22 s, 4 at 35 s, 5 at 75 s; "unanswered: rang 1200 s, reached level 5"; queued for the server | 2026-10-24 23:35 |
| Swiped away, then "clear all" | Pass | alarm set for 23:58; at 23:52:39 `ActivityManager: Killing … app.somniai.alarm … SwipeUpClean`; package not stopped (`stopped=false`), alarm still in `dumpsys alarm`; 23:58:00 `Start proc … for broadcast … AlarmFiredReceiver`; fired 415 ms late; another app in front and the phone unlocked, so the alarm showed as a heads-up notification, which popped up by itself; tapped, the ring screen opened; "Stop alarm": dismissed after 166 s at level 5 | 2026-10-24 23:58 |
