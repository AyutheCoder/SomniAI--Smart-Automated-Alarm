#!/usr/bin/env bash
# The device test matrix (DEVICE_TESTS.md): runs each condition on the
# connected phone or emulator, with the debug build installed, and writes one
# result row per condition.
#
#   bash scripts/device-matrix.sh [condition ...]
#
# Conditions: locked silent dnd saver battery15 airplane timezone forcestop
#             doze restricted bucket reboot   (default: all but reboot)
# Results are appended to device-matrix-results.md in the current folder.
#
# Each condition: set it, set a test alarm about a minute ahead (no wake check,
# so it can be stopped from here), wait for it, collect the evidence (when it
# fired, the ring screen, whether alarm audio played unmuted, what the ring
# log says about volume, ringer and Do Not Disturb), stop it, and put the
# condition back as it was. It never sets a PIN, and it restores everything it
# changes. ADB defaults to adb on PATH; in Git Bash, export MSYS_NO_PATHCONV=1.
set -uo pipefail

ADB="${ADB:-adb}"
PKG=app.somniai.alarm
HOOK="-n $PKG/.alarms.DebugAlarmReceiver"
OUT="${OUT:-device-matrix-results.md}"

sh_() { "$ADB" shell "$@" 2>&1 | tr -d '\r'; }
say() { echo "matrix: $*"; }
# The default log buffer can be small (256 KB on the emulator): right after a
# boot, the system's own logging rotated the marks and the app's lines out
# before they were read, which read as "did not ring" for alarms that did.
big_log() { "$ADB" logcat -G 16M >/dev/null 2>&1 || true; }
# A bigger buffer was not enough on a Xiaomi phone (HyperOS 3): it logs about
# 1 MB a minute, and logd prunes the busiest sources' oldest lines first, which
# took the marks (adb's shell logs every command) and the app's lines within
# minutes, so an alarm that rang read as "did not ring". The app's lines are
# therefore copied to this computer as they are written, and read from there.
STREAM="${STREAM:-${OUT%.md}.somnialarm.log}"
STREAM_PID=""
follow_log() { # (re)start the copy; after a reboot the old one has ended. $1 "all": from the boot on
  [ -n "$STREAM_PID" ] && kill "$STREAM_PID" 2>/dev/null
  local from=(-T 1); [ "${1:-}" = all ] && from=()
  "$ADB" logcat "${from[@]}" -s 'SomniAlarm:*' >> "$STREAM" 2>/dev/null &
  STREAM_PID=$!
  sleep 2
}
trap '[ -n "$STREAM_PID" ] && kill "$STREAM_PID" 2>/dev/null' EXIT
MARK=0
mark() { MARK=$((MARK + 1)); sh_ log -t SomniAlarm "matrix mark $MARK" >/dev/null; sleep 1; }
log() { tr -d '\r' < "$STREAM" | sed -n "/matrix mark $MARK\$/,\$p"; }
has() { local out; out=$("${@:2}"); grep -q -- "$1" <<<"$out"; }
wait_log() { # pattern seconds
  for _ in $(seq 1 $(($2 / 3))); do
    if has "$1" log; then return 0; fi
    sleep 3
  done
  return 1
}

# Sets an alarm for the start of the minute $2 minutes from now.
schedule() { sh_ am broadcast -a app.somniai.alarm.debug.SCHEDULE $HOOK --es id "$1" --ei minutes "${2:-2}" --ez check false >/dev/null; }
dismiss() { sh_ am broadcast -a app.somniai.alarm.debug.DISMISS $HOOK >/dev/null; }
# Stops the ring and waits until the app says so: a stop that never arrived
# (held back until unlock, after a reboot) left the alarm ringing unseen.
stop_ring() { dismiss; wait_log "dismissed $1" 30; }
cancel() { sh_ am broadcast -a app.somniai.alarm.debug.CANCEL $HOOK --es id "$1" >/dev/null; }
scheduled_for() { log | grep -m1 "debug: set $1" | grep -o '"hour":[0-9]*,"minute":[0-9]*' | sed 's/"hour":\([0-9]*\),"minute":\([0-9]*\)/\1 \2/' | awk '{printf "%02d:%02d", $1, $2}'; }

# What the phone showed and played while ringing.
evidence() {
  local id=$1 fired ringing playing awake top
  fired=$(log | grep -m1 "fired $id" | sed 's/.*SomniAlarm: //; s/ scheduled for [^,]*,//')
  ringing=$(log | grep -m1 "ringing $id" | sed 's/.*ringing [^:]*: //')
  playing=$(sh_ dumpsys audio | grep "usage=USAGE_ALARM" | grep "state:started" | grep -o "mutedState:[a-z_]*" | head -1)
  awake=$(sh_ dumpsys power | grep -m1 -o "mWakefulness=[A-Za-z]*")
  # What is in front, by name: "not in front" alone didn't say what covered it.
  top=$(sh_ dumpsys activity activities | grep -m1 "topResumedActivity" | grep -o "[A-Za-z0-9_.]*/[A-Za-z0-9_.]*" | head -1)
  local keyguard; keyguard=$(sh_ dumpsys window | grep -m1 -o "isKeyguardShowing=[a-z]*")
  case "$top" in
    *RingActivity) top="RingActivity" ;;
    "") top="not in front (nothing resumed)" ;;
    *) top="not in front ($top)" ;;
  esac
  echo "fired: ${fired:-NO}; ringing: ${ringing:-NO}; alarm audio: ${playing:-not playing}; ${awake}; ${keyguard}; ring screen: ${top}"
}

row() { # condition, result, evidence
  printf '| %s | %s | %s | %s |\n' "$1" "$2" "$3" "$(date '+%Y-%m-%d %H:%M')" >> "$OUT"
  say "$1: $2"
}

# Runs one alarm under whatever condition is set; $1 id, $2 minutes ahead, $3 seconds to wait.
# Not in a subshell (the log marks must reach the caller): the result is in RES.
RES=""
ring_once() {
  local id=$1
  mark
  schedule "$id" "${2:-2}"
  if ! wait_log "debug: set $id" 15; then
    RES="NOT SET: $(log | tail -2 | tr '\n' ' ')"
    return 1
  fi
  local at; at=$(scheduled_for "$id")
  sh_ input keyevent KEYCODE_SLEEP >/dev/null
  if ! wait_log "ringing $id" "${3:-200}"; then
    # Keep the evidence: what the app logged, and what AlarmManager holds for it.
    local pending; pending=$(sh_ dumpsys alarm | grep -cE "RTC_WAKEUP #[0-9]+: Alarm\{.* $PKG\}")
    RES="did not ring by $(date +%H:%M:%S) (set for $at); $pending pending alarm(s) for the app; log: $(log | grep -v 'matrix mark' | tail -4 | sed 's/.*SomniAlarm: //' | tr '\n' ' ')"
    "$ADB" logcat -d -v time > "matrix-fail-$id.log" 2>/dev/null
    # Stop it too, in case it rang unseen: left ringing, it ran into the next condition.
    dismiss
    cancel "$id"
    return 1
  fi
  sleep 4
  local ev; ev=$(evidence "$id")
  dismiss
  wait_log "dismissed $id" 20 || ev="$ev; NOT STOPPED"
  cancel "$id"
  RES="set for $at; $ev"
  return 0
}

# Each condition: set it, ring, put it back. Prints nothing itself; writes a row.

c_locked() {
  local r; ring_once matrix-locked && { r=$RES; row "Screen locked (off)" "Pass" "$r"; } || { r=$RES; row "Screen locked (off)" "FAIL" "$r"; }
}

c_silent() {
  local set; set=$(sh_ cmd audio set-ringer-mode SILENT)
  if grep -qiE "error|unknown|not found|exception" <<<"$set"; then
    row "Silent mode" "Manual" "this phone's shell can't set the ringer mode ($set): switch to silent by hand and run: bash scripts/device-matrix.sh locked"
    return
  fi
  local before=NORMAL
  local r; ring_once matrix-silent && { r=$RES; row "Silent mode" "$(grep -q 'ringer silent' <<<"$r" && grep -q 'mutedState:none' <<<"$r" && echo Pass || echo CHECK)" "$r"; } || { r=$RES; row "Silent mode" "FAIL" "$r"; }
  sh_ cmd audio set-ringer-mode "${before:-NORMAL}" >/dev/null
}

c_dnd() {
  sh_ cmd notification set_dnd priority >/dev/null
  local r; ring_once matrix-dnd && { r=$RES; row "Do Not Disturb (priority, Android's default exceptions)" "$(grep -q 'do not disturb priority' <<<"$r" && grep -q 'mutedState:none' <<<"$r" && echo Pass || echo CHECK)" "$r"; } || { r=$RES; row "Do Not Disturb (priority, Android's default exceptions)" "FAIL" "$r"; }
  sh_ cmd notification set_dnd off >/dev/null
}

c_saver() {
  # Battery Saver only restricts apps on battery, so the cable is "unplugged" for the test.
  sh_ dumpsys battery unplug >/dev/null
  sh_ settings put global low_power 1 >/dev/null
  local on; on=$(sh_ settings get global low_power)
  local r; ring_once matrix-saver && { r=$RES; row "Battery Saver on (unplugged)" "Pass" "low_power=$on; $r"; } || { r=$RES; row "Battery Saver on (unplugged)" "FAIL" "low_power=$on; $r"; }
  sh_ settings put global low_power 0 >/dev/null
  sh_ dumpsys battery reset >/dev/null
}

c_battery15() {
  sh_ dumpsys battery unplug >/dev/null
  sh_ dumpsys battery set level 10 >/dev/null
  local r; ring_once matrix-battery15 && { r=$RES; row "Battery under 15 % (reported 10 %, unplugged)" "Pass" "$r"; } || { r=$RES; row "Battery under 15 % (reported 10 %, unplugged)" "FAIL" "$r"; }
  sh_ dumpsys battery reset >/dev/null
}

c_airplane() {
  sh_ cmd connectivity airplane-mode enable >/dev/null
  local state; state=$(sh_ settings get global airplane_mode_on)
  local r ok; ring_once matrix-airplane; ok=$?; r=$RES
  local queued; queued=$(log | grep -m1 "queued .* call(s)" | sed 's/.*SomniAlarm: //')
  sh_ cmd connectivity airplane-mode disable >/dev/null
  [ $ok -eq 0 ] && row "Airplane mode" "Pass" "airplane_mode_on=$state; $r; ${queued:-nothing queued}" || row "Airplane mode" "FAIL" "airplane_mode_on=$state; $r"
}

c_timezone() {
  local tz auto
  tz=$(sh_ getprop persist.sys.timezone)
  auto=$(sh_ settings get global auto_time_zone)
  # A zone with a different offset, so the same wall-clock time is a different instant.
  local other="Europe/London"; [ "$tz" = "$other" ] && other="Asia/Kolkata"
  mark
  schedule matrix-timezone 4
  wait_log "debug: set matrix-timezone" 15
  local at; at=$(scheduled_for matrix-timezone)
  sh_ settings put global auto_time_zone 0 >/dev/null
  sh_ cmd alarm set-timezone "$other" >/dev/null
  local moved=""; wait_log "TIMEZONE_CHANGED in $other" 30 && moved=$(log | grep -m1 "TIMEZONE_CHANGED in $other" | grep -o "matrix-timezone -> [^],]*")
  sleep 20
  mark
  sh_ cmd alarm set-timezone "$tz" >/dev/null
  wait_log "TIMEZONE_CHANGED in" 30
  local back; back=$(log | grep -m1 "TIMEZONE_CHANGED in" | grep -o "matrix-timezone -> [^],]*")
  sh_ settings put global auto_time_zone "$auto" >/dev/null
  sh_ input keyevent KEYCODE_SLEEP >/dev/null
  if wait_log "ringing matrix-timezone" 300; then
    sleep 4
    local ev; ev=$(evidence matrix-timezone)
    stop_ring matrix-timezone || ev="$ev; NOT STOPPED"; cancel matrix-timezone
    row "Time zone changed (to $other and back)" "$([ -n "$moved" ] && [ -n "$back" ] && echo Pass || echo CHECK)" "set for $at in $tz; in $other: ${moved:-NOT RESCHEDULED}; back in $tz: ${back:-NOT RESCHEDULED}; $ev"
  else
    cancel matrix-timezone
    row "Time zone changed (to $other and back)" "FAIL" "set for $at; in $other: ${moved:-none}; back: ${back:-none}; did not ring"
  fi
}

c_forcestop() {
  mark
  schedule matrix-forcestop 3
  wait_log "debug: set matrix-forcestop" 15
  sh_ am force-stop "$PKG"
  sleep 2
  # Pending alarms only ("RTC_WAKEUP #n: Alarm{... package}"), not the removal history.
  local count; count=$(sh_ dumpsys alarm | grep -cE "RTC_WAKEUP #[0-9]+: Alarm\{.* $PKG\}")
  local gone="kept"; [ "$count" -eq 0 ] && gone="deleted by Android"
  # The user opens the app again.
  sh_ am start -n "$PKG/.MainActivity" >/dev/null
  local restored=""; wait_log "after app_start" 60 && restored=$(log | grep -m1 "after app_start" | grep -o "matrix-forcestop -> [^],]*")
  sh_ input keyevent KEYCODE_HOME >/dev/null
  sh_ input keyevent KEYCODE_SLEEP >/dev/null
  if wait_log "ringing matrix-forcestop" 240; then
    sleep 4
    local ev; ev=$(evidence matrix-forcestop)
    stop_ring matrix-forcestop || ev="$ev; NOT STOPPED"; cancel matrix-forcestop
    row "App force-stopped, then opened" "Pass (as designed: rings once reopened)" "after force-stop: alarm $gone ($count AlarmManager entries for the app); on opening: ${restored:-NOT RESTORED}; $ev"
  else
    cancel matrix-forcestop
    row "App force-stopped, then opened" "FAIL" "after force-stop: alarm $gone; restored: ${restored:-no}"
  fi
}

c_doze() {
  # Into deep idle first, then set the alarm: Android won't enter deep idle
  # with an alarm clock this close (seen here: "Unable to go deep idle"). The
  # question is whether an alarm set while the phone dozes still rings on time.
  sh_ dumpsys battery unplug >/dev/null
  sh_ input keyevent KEYCODE_SLEEP >/dev/null
  sleep 3
  local forced; forced=$(sh_ dumpsys deviceidle force-idle)
  local state; state=$(sh_ dumpsys deviceidle get deep)
  mark
  schedule matrix-doze 3
  wait_log "debug: set matrix-doze" 15
  local after; after=$(sh_ dumpsys deviceidle get deep)
  if wait_log "ringing matrix-doze" 240; then
    sleep 4
    local ev; ev=$(evidence matrix-doze)
    stop_ring matrix-doze || ev="$ev; NOT STOPPED"; cancel matrix-doze
    row "Doze (deep idle, forced)" "$([ "$state" = IDLE ] && echo Pass || echo CHECK)" "$forced; deep state $state when the alarm was set, $after just after; $ev"
  else
    cancel matrix-doze
    row "Doze (deep idle, forced)" "FAIL" "deep idle state: $state, then $after; did not ring"
  fi
  sh_ dumpsys deviceidle unforce >/dev/null
  sh_ dumpsys battery reset >/dev/null
}

c_restricted() {
  # Settings > Apps > SomniAI > App battery usage > Restricted.
  local before; before=$(sh_ cmd appops get "$PKG" RUN_ANY_IN_BACKGROUND | grep -o "allow\|ignore\|deny\|default" | head -1)
  sh_ dumpsys battery unplug >/dev/null
  sh_ cmd appops set "$PKG" RUN_ANY_IN_BACKGROUND ignore >/dev/null
  local r; ring_once matrix-restricted && { r=$RES; row "Battery usage set to Restricted (Android setting)" "Pass" "$r"; } || { r=$RES; row "Battery usage set to Restricted (Android setting)" "FAIL" "$r"; }
  sh_ cmd appops set "$PKG" RUN_ANY_IN_BACKGROUND "${before:-allow}" >/dev/null
  sh_ dumpsys battery reset >/dev/null
}

c_bucket() {
  # The "restricted" app standby bucket: Android allows one alarm a day there.
  local before; before=$(sh_ am get-standby-bucket "$PKG")
  sh_ dumpsys battery unplug >/dev/null
  sh_ am set-standby-bucket "$PKG" restricted >/dev/null
  local now; now=$(sh_ am get-standby-bucket "$PKG")
  local verdict="Pass"
  # Android floors exact-alarm apps at the working-set bucket (20), so a request
  # for restricted (45) is clamped (AppStandbyController.getAppMinBucket).
  [ "$now" != "45" ] && verdict="Not applicable: Android kept the app at bucket $now"
  local r; ring_once matrix-bucket && { r=$RES; row "Standby bucket restricted" "$verdict" "asked for 45 (restricted), got $now; $r"; } || { r=$RES; row "Standby bucket restricted" "FAIL" "bucket $now; $r"; }
  sh_ am set-standby-bucket "$PKG" active >/dev/null
  sh_ dumpsys battery reset >/dev/null
  say "standby bucket was $before; set back to active (Android moves it on as the app is used)"
}

c_reboot() {
  mark
  schedule matrix-reboot 5
  wait_log "debug: set matrix-reboot" 15
  local at; at=$(scheduled_for matrix-reboot)
  say "rebooting; the alarm is set for $at"
  "$ADB" reboot
  # Wait until it is really down: a slow shutdown can outlast the alarm.
  for _ in $(seq 1 60); do
    [ "$("$ADB" get-state 2>/dev/null | tr -d '\r')" != "device" ] && break
    sleep 2
  done
  "$ADB" wait-for-device
  # The reboot cleared the log and reset its size: a big buffer again and a new
  # mark as soon as adb is back, before the boot broadcasts reach the app, so
  # the evidence below reads from here and boot's own logging can't rotate it out.
  big_log
  follow_log all
  mark
  for _ in $(seq 1 60); do [ "$(sh_ getprop sys.boot_completed)" = "1" ] && break; sleep 5; done
  local booted; booted=$(date +%H:%M:%S)
  # If the phone was still down at the alarm time, it should ring late, at
  # once after boot (within 2.2's 15-minute grace) rather than be lost.
  local when="booted at $booted, before the alarm time"
  [ "$(date +%H:%M)" \> "$at" ] && when="booted at $booted, after the alarm time: it should ring late, at once"
  sleep 5
  local fired=""
  wait_log "ringing matrix-reboot" 300 && fired=yes
  local resched; resched=$(log | grep "rescheduled .* after .*BOOT_COMPLETED" | grep -o "after [A-Za-z_.]*" | sort -u | tr '\n' ' ')
  local locked; locked=$(sh_ dumpsys window | grep -m1 -o "isKeyguardShowing=[a-z]*")
  if [ -n "$fired" ]; then
    sleep 3
    local ev; ev=$(evidence matrix-reboot)
    stop_ring matrix-reboot || ev="$ev; NOT STOPPED"; cancel matrix-reboot
    row "Rebooted (not unlocked afterwards)" "Pass" "set for $at; $when; rescheduled ${resched:-?}; $locked; $ev"
  else
    cancel matrix-reboot
    row "Rebooted (not unlocked afterwards)" "FAIL" "set for $at; $when; rescheduled ${resched:-NOT}; did not ring"
  fi
}

"$ADB" wait-for-device
big_log
follow_log
MODEL=$(sh_ getprop ro.product.manufacturer)" "$(sh_ getprop ro.product.model)
SDK=$(sh_ getprop ro.build.version.sdk)
RELEASE=$(sh_ getprop ro.build.version.release)
if [ ! -f "$OUT" ]; then
  printf '| Condition | Result | Evidence | When |\n| --- | --- | --- | --- |\n' > "$OUT"
fi
printf '| **%s, Android %s (API %s)** | | | |\n' "$MODEL" "$RELEASE" "$SDK" >> "$OUT"
say "device: $MODEL, Android $RELEASE (API $SDK)"
has "$PKG" sh_ pm list packages "$PKG" || { say "install the debug build first (npm run android:build, then npm run android:run)"; exit 1; }
if [ "$SDK" -ge 33 ]; then sh_ pm grant "$PKG" android.permission.POST_NOTIFICATIONS >/dev/null; fi

CONDITIONS=("$@")
[ ${#CONDITIONS[@]} -eq 0 ] && CONDITIONS=(locked silent dnd saver battery15 airplane timezone forcestop doze restricted bucket)
for c in "${CONDITIONS[@]}"; do
  say "--- $c"
  "c_$c"
done
say "results in $OUT"
