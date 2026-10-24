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
# Output is captured before it is searched: `cmd | grep -q` under pipefail
# fails when grep exits early and cmd gets SIGPIPE, even though it matched.
has() { local out; out=$("${@:2}"); grep -q -- "$1" <<<"$out"; }
# `logcat -c` fails on some images (API 26: "failed to clear the 'main' log"),
# so instead of clearing, write a marker and read only what comes after it.
MARK=0
mark() { MARK=$((MARK + 1)); sh_ log -t SomniAlarm "alarm-check mark $MARK" >/dev/null; }
log() { "$ADB" logcat -d -s SomniAlarm:* | tr -d '\r' | sed -n "/alarm-check mark $MARK\$/,\$p"; }
wait_log() { # pattern, seconds
  for _ in $(seq 1 $(($2 / 2))); do
    if has "$1" log; then return 0; fi
    sleep 2
  done
  return 1
}
granted() { has "$1: granted=true" sh_ dumpsys package "$PKG"; }
requested() {
  local out
  out=$(sh_ dumpsys package "$PKG")
  out=$(sed -n '/requested permissions:/,/install permissions:/p' <<<"$out")
  grep -q "^ *$1\$" <<<"$out"
}
kill_app() {
  sh_ input keyevent KEYCODE_HOME
  # A broadcast still queued for the app (12L sends several around the
  # permission change) can start it again at once, so retry for a while.
  local pid
  for _ in $(seq 1 10); do
    sleep 2
    pid=$(sh_ pidof "$PKG" || true)
    if [ -z "$pid" ]; then return 0; fi
    KILLED="$KILLED $pid"
    # shellcheck disable=SC2086
    sh_ run-as "$PKG" kill -9 $pid || true
  done
  sh_ dumpsys activity broadcasts | grep -B2 -A6 "$PKG" | head -40 || true
  fail "the app's process kept coming back (killed:$KILLED)"
}
KILLED=""

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

mark
sh_ am start -W -n "$PKG/.MainActivity" >/dev/null
wait_log "after app_start" 60 || fail "plugin did not load (no app_start reschedule)"
say "plugin loaded"

# Android 12/12L: off means the alarm waits, on means it is scheduled.
if [ "$SDK" -ge 31 ] && [ "$SDK" -le 32 ]; then
  sh_ appops set "$PKG" SCHEDULE_EXACT_ALARM deny
  sleep 3   # turning it off stops the app
  mark
  sh_ am broadcast -a app.somniai.alarm.debug.SCHEDULE $DEBUG --ei minutes 5 >/dev/null
  wait_log '"status":"waiting_for_permission"' 30 || fail "with access off the alarm was not reported waiting: $(log | tail -3)"
  say "access off: alarm saved and reported waiting_for_permission, not scheduled"
  sh_ appops set "$PKG" SCHEDULE_EXACT_ALARM allow
  wait_log "after android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" 60 || fail "no reschedule when access was turned on"
  say "access on: rescheduled on SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"
fi

# Fires with the process killed.
mark
sh_ am broadcast -a app.somniai.alarm.debug.SCHEDULE $DEBUG --ei minutes 2 >/dev/null
wait_log '"status":"scheduled"' 30 || fail "alarm not scheduled: $(log | tail -3)"
has "$PKG/.alarms.AlarmFiredReceiver" sh_ dumpsys alarm || fail "AlarmManager has no alarm for the app"
kill_app
say "alarm set, app process killed; waiting for it to fire"
wait_log "fired device-test" 200 || fail "alarm did not fire within 200 s"
FIRED=$(log | grep 'fired device-test')
say "$(sed 's/.*SomniAlarm: //' <<<"$FIRED")"
# logcat's third column is the pid that logged it.
FIRED_PID=$(awk '{print $3}' <<<"$FIRED")
for p in $KILLED; do [ "$p" != "$FIRED_PID" ] || fail "fired in pid $p, which was supposedly killed"; done
say "fired in pid $FIRED_PID; killed before it fired:$KILLED"
sh_ am broadcast -a app.somniai.alarm.debug.CANCEL $DEBUG >/dev/null
say "PASS on API $SDK"
