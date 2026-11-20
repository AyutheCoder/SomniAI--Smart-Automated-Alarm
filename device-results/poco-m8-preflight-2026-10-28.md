# Bedtime check (prompt 3.1): POCO M8 5G, HyperOS 3.0, Android 16 (API 36), 2026-10-28

Output of `bash scripts/preflight-device.sh` on the phone, unedited except that the regional model
code is left out. Earlier runs that day failed on faults in the script itself (`DEVICE_TESTS.md`,
3.1, lists them); these are the runs after the fixes.

| Case | Result | Evidence | When |
| --- | --- | --- | --- |
| Alarm volume at its lowest (3) | Pass | detected: fail; "Turn up" tapped: volume 3 -> 11, check now pass; put back to 11 | 2026-10-28 02:47 |
| Do Not Disturb, total silence | Pass | detected: fail; "Open settings" tapped: opened com.android.settings/.Settings$ModesSettingsActivity; after turning it off: pass | 2026-10-28 02:48 |
| Battery 10 %, unplugged | Pass | detected: fail; at 30 %: pass; plugged in again: pass (no button: plugging in is the fix) | 2026-10-28 02:48 |
| Notifications off | Pass | detected: fail; "Turn on" tapped: opened com.android.settings/.Settings$AppNotificationSettingsActivity; after allowing: pass | 2026-10-28 02:48 |
| Full-screen alarm not allowed | Pass | detected: fail; "Allow" tapped: opened com.android.settings/.spa.SpaActivity; put back (allow): pass | 2026-10-28 02:48 |
| Exact alarms turned off | Not applicable | Android 36: nothing the user can turn off (USE_EXACT_ALARM from 13, no permission before 12) | 2026-10-28 02:48 |
| Battery optimisation on | Pass | detected: fail; "Open settings" tapped: opened com.android.settings/.Settings$AppBatteryUsageActivity; not optimised: pass | 2026-10-28 02:48 |
| Manufacturer's battery manager | Pass | found: confirmed; "Open settings" tapped: opened com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity; toggled: unverified; toggled back: confirmed | 2026-10-28 02:49 |
| Bedtime notification | Pass | battery 10 %: posted 1 ("Before bed: 1 thing could stop your 4:10 am alarm"), opens app.somniai.alarm/.alarms.PreflightActivity; all passing: 0 posted after, 0 before | 2026-10-28 03:03 |
