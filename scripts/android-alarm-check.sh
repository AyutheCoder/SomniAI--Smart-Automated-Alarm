#!/usr/bin/env bash
# Native alarms on a running emulator or phone (debug APK), for the Android
# version it runs:
#   - the exact-alarm permission is the one this version uses, and granted;
#   - an alarm set ~2 minutes ahead fires with the app's process killed;
#   - Android 12/12L: with "Alarms & reminders" off the alarm waits, and turning
#     it on reschedules it.
# Results come from the app's own log (tag SomniAlarm) and AlarmManager's state.
#
#   bash scripts/android-alarm-check.sh path/to/app-debug.apk
#
# ADB defaults to adb on PATH. In Git Bash, export MSYS_NO_PATHCONV=1 first.
set -euo pipefail

APK="${1:?usage: android-alarm-check.sh app-debug.apk}"
ADB="${ADB:-adb}"
PKG=app.somniai.alarm
DEBUG="-n $PKG/.alarms.DebugAlarmReceiver"

say() { echo "alarm-check: $*"; }
fail() { echo "alarm-check: FAIL: $*" >&2; exit 1; }
sh_() { "$ADB" shell "$@" | tr -d '\r'; }
log() { "$ADB" logcat -d -s SomniAlarm:* | tr -d '\r'; }
wait_log() { # pattern, seconds
  for _ in $(seq 1 $(($2 / 2))); do
    if log | grep -q "$1"; then return 0; fi
    sleep 2
  done
  return 1
}
granted() { sh_ dumpsys package "$PKG" | grep -q "$1: granted=true"; }
requested() { sh_ dumpsys package "$PKG" | grep -A200 "requested permissions:" | grep -q "^ *$1\$"; }
kill_app() {
  sh_ input keyevent KEYCODE_HOME
  sleep 1
  local pid
  pid=$(sh_ pidof "$PKG" || true)
  if [ -n "$pid" ]; then sh_ run-as "$PKG" kill -9 "$pid" || true; fi
  sleep 1
  [ -z "$(sh_ pidof "$PKG" || true)" ] || fail "could not kill the app's process"
}

"$ADB" wait-for-device
SDK=$(sh_ getprop ro.build.version.sdk)
say "device API $SDK"
"$ADB" install -r "$APK" >/dev/null
if [ "$SDK" -ge 33 ]; then sh_ pm grant "$PKG" android.permission.POST_NOTIFICATIONS; fi

# The permission each version uses.
if [ "$SDK" -ge 33 ]; then
  granted android.permission.USE_EXACT_ALARM || fail "USE_EXACT_ALARM not granted"
  requested android.permission.SCHEDULE_EXACT_ALARM && fail "SCHEDULE_EXACT_ALARM requested on API $SDK; it is capped at 32"
  say "USE_EXACT_ALARM granted at install; SCHEDULE_EXACT_ALARM not requested"
elif [ "$SDK" -ge 31 ]; then
  requested android.permission.SCHEDULE_EXACT_ALARM || fail "SCHEDULE_EXACT_ALARM not requested on API $SDK"
  say "SCHEDULE_EXACT_ALARM requested"
else
  say "no exact-alarm permission exists on API $SDK"
fi

"$ADB" logcat -c
sh_ am start -W -n "$PKG/.MainActivity" >/dev/null
wait_log "after app_start" 60 || fail "plugin did not load (no app_start reschedule)"
say "plugin loaded"

# Android 12/12L: off means the alarm waits, on means it is scheduled.
if [ "$SDK" -ge 31 ] && [ "$SDK" -le 32 ]; then
  sh_ appops set "$PKG" SCHEDULE_EXACT_ALARM deny
  sleep 3   # turning it off stops the app
  "$ADB" logcat -c
  sh_ am broadcast -a app.somniai.alarm.debug.SCHEDULE $DEBUG --ei minutes 5 >/dev/null
  wait_log '"status":"waiting_for_permission"' 30 || fail "with access off the alarm was not reported waiting: $(log | tail -3)"
  say "access off: alarm saved and reported waiting_for_permission, not scheduled"
  sh_ appops set "$PKG" SCHEDULE_EXACT_ALARM allow
  wait_log "after android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" 60 || fail "no reschedule when access was turned on"
  say "access on: rescheduled on SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"
fi

# Fires with the process killed.
"$ADB" logcat -c
sh_ am broadcast -a app.somniai.alarm.debug.SCHEDULE $DEBUG --ei minutes 2 >/dev/null
wait_log '"status":"scheduled"' 30 || fail "alarm not scheduled: $(log | tail -3)"
sh_ dumpsys alarm | grep -q "$PKG/.alarms.AlarmFiredReceiver" || fail "AlarmManager has no alarm for the app"
kill_app
say "alarm set, app process killed; waiting for it to fire"
wait_log "fired device-test" 200 || fail "alarm did not fire within 200 s"
say "$(log | grep 'fired device-test' | sed 's/.*SomniAlarm: //')"
sh_ am broadcast -a app.somniai.alarm.debug.CANCEL $DEBUG >/dev/null
say "PASS on API $SDK"
