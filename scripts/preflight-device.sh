#!/usr/bin/env bash
# The bedtime check on a connected phone (prompt 3.1, DEVICE_TESTS.md): for
# each setting that can stop an alarm, make it fail, check the bedtime check
# says so, tap its fix on the check screen, see what the fix did, and put the
# setting back as it was. Debug build installed; nothing else needed.
#
#   bash scripts/preflight-device.sh [case ...]
#
# Cases: volume dnd battery notifications fullscreen exact optimisation manufacturer
#        bedtime (default: all; bedtime takes about 3 minutes). Results are appended to preflight-results.md in the
#        current folder. ADB defaults to adb on PATH; in Git Bash, export
#        MSYS_NO_PATHCONV=1.
set -uo pipefail

ADB="${ADB:-adb}"
PKG=app.somniai.alarm
HOOK="-n $PKG/.alarms.DebugAlarmReceiver"
OUT="${OUT:-preflight-results.md}"

sh_() { "$ADB" shell "$@" 2>&1 | tr -d '\r'; }
say() { echo "preflight: $*"; }
FAILED=0
COVERED=""
row() {
  local result=$2
  # A fix that couldn't be tapped because a system window lay over the screen
  # (the API 26 emulator's System UI crash dialog) is the emulator's, not SomniAI's.
  # Only when the setting was still detected: a covering window never excuses a wrong verdict.
  if [[ "$result" == FAIL* ]] && [ -n "$COVERED" ] && [[ "$3" == "detected: fail;"* || "$3" == found:* ]]; then
    result="Skipped: $COVERED lies over the screen"
  fi
  COVERED=""
  set -- "$1" "$result" "$3"
  printf '| %s | %s | %s | %s |\n' "$1" "$2" "$3" "$(date '+%Y-%m-%d %H:%M')" >> "$OUT"
  say "$1: $2"
  [[ "$2" == FAIL* ]] && FAILED=$((FAILED + 1))
  return 0
}

# Every verdict now, "exact_alarm=pass notifications=pass ...", without opening the screen.
# Retried: taking a permission away (exact alarms on 12L) restarts the app, and a
# broadcast in that moment comes back empty.
verdicts() {
  local v
  for _ in 1 2 3 4 5 6 7 8; do
    v=$(sh_ am broadcast -a app.somniai.alarm.debug.PREFLIGHT $HOOK --ez open false | grep -o 'data="[^"]*"' | sed 's/data="//; s/"$//')
    [ -n "$v" ] && { echo "$v"; return; }
    sleep 1
  done
}
verdict() { verdicts | tr ' ' '\n' | grep "^$1=" | cut -d= -f2; }
# By am start: a receiver can't open a screen while the app is in the background.
# Fresh each time: an earlier task may still have a settings page on top.
top() { sh_ dumpsys activity activities | grep -m1 "topResumedActivity" | grep -o "[A-Za-z0-9_.]*/[A-Za-z0-9_.$]*" | head -1; }
# Not `top | grep -q`: under pipefail, grep -q closing the pipe early reads as "not in front".
in_front() { local t; t=$(top); [[ "$t" == *PreflightActivity* || "$t" == *DebugPreflightScreen* ]]; }
# Waits until the check screen is really in front (a cold start after a revoked
# permission takes a while); nothing is tapped anywhere else.
open_screen() {
  sh_ am start --activity-clear-task -n "$PKG/.alarms.DebugPreflightScreen" >/dev/null
  for _ in $(seq 1 15); do
    in_front && { sleep 1; return 0; }
    sleep 1
  done
  return 1
}
back_to_check() { sh_ input keyevent KEYCODE_BACK >/dev/null; sleep 1; }

# Taps the view with this content description on the check screen, scrolling to
# it. Only ever on the check screen: if anything else is in front, it touches
# nothing (once, it tapped the home screen and opened another app).
tap() {
  for _ in 1 2 3 4 5 6 7 8; do
    local focus; focus=$(sh_ dumpsys window | grep -m1 "mCurrentFocus")
    if [[ "$focus" == *"Application Error"* || "$focus" == *"Not Responding"* ]]; then
      COVERED=$(grep -o "Window{[^}]*}" <<<"$focus")
      return 1
    fi
    in_front || return 1
    sh_ uiautomator dump /sdcard/preflight-ui.xml >/dev/null
    local b; b=$(sh_ cat /sdcard/preflight-ui.xml | grep -o "content-desc=\"$1\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' | head -1)
    if [ -n "$b" ]; then
      local x1 y1 x2 y2
      read -r x1 y1 x2 y2 <<<"$(echo "$b" | tr '[],' '   ')"
      if [ $((y2 - y1)) -gt 40 ]; then
        sh_ input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2)) >/dev/null
        sleep 2
        return 0
      fi
    fi
    in_front || return 1
    # Sized to the screen: CI's emulators are smaller than a phone, and a swipe
    # starting below the screen scrolls nothing.
    sh_ input swipe $((WIDTH / 2)) $((HEIGHT * 3 / 4)) $((WIDTH / 2)) $((HEIGHT * 3 / 8)) 300 >/dev/null
    sleep 1
  done
  return 1
}

SDK=$(sh_ getprop ro.build.version.sdk)
# "Physical size: 1080x2392" (an "Override size" line may follow; the first is the panel).
SIZE=$(sh_ wm size | grep -o "[0-9]*x[0-9]*" | head -1)
WIDTH=${SIZE%x*}
HEIGHT=${SIZE#*x}

# The alarm stream as the app sees and sets it: adb's shell sets the "default"
# output's volume, not the speaker's the alarm plays on.
volume() { sh_ am broadcast -a app.somniai.alarm.debug.VOLUME $HOOK ${1:+--ei index "$1"} | grep -o "volume=[0-9]*" | cut -d= -f2; }
volume_min() { sh_ am broadcast -a app.somniai.alarm.debug.VOLUME $HOOK | grep -o "min=[0-9]*" | cut -d= -f2; }

c_volume() {
  local before min after v1 v2 fixed
  before=$(volume)
  min=$(volume_min)
  volume "$min" >/dev/null
  v1=$(verdict alarm_volume)
  open_screen
  tap "fix:alarm_volume" && fixed=tapped || fixed="button not found"
  after=$(volume)
  v2=$(verdict alarm_volume)
  volume "$before" >/dev/null
  back_to_check
  [ "$v1" = fail ] && [ "$v2" = pass ] && [ "$fixed" = tapped ] && [ "$after" -gt "$min" ] && r=Pass || r=FAIL
  row "Alarm volume at its lowest ($min)" "$r" "detected: $v1; \"Turn up\" $fixed: volume $min -> $after, check now $v2; put back to $(volume)"
}

c_dnd() {
  sh_ cmd notification set_dnd none >/dev/null
  # 2 is "no interruptions"; some images' shells can't set it (Android 8's).
  if [ "$(sh_ settings get global zen_mode)" != 2 ]; then
    row "Do Not Disturb, total silence" "Not applicable" "this image's shell can't turn on Do Not Disturb"
    return
  fi
  local v1 v2 opened fixed
  v1=$(verdict dnd)
  open_screen
  tap "fix:dnd" && fixed=tapped || fixed="button not found"
  opened=$(top)
  back_to_check
  sh_ cmd notification set_dnd off >/dev/null
  v2=$(verdict dnd)
  [ "$v1" = fail ] && [ "$v2" = pass ] && [ "$fixed" = tapped ] && [[ "$opened" == *ettings* ]] && r=Pass || r=FAIL
  row "Do Not Disturb, total silence" "$r" "detected: $v1; \"Open settings\" $fixed: opened $opened; after turning it off: $v2"
}

c_battery() {
  sh_ dumpsys battery unplug >/dev/null
  sh_ dumpsys battery set level 10 >/dev/null
  local v1 v2 v3
  v1=$(verdict battery)
  sh_ dumpsys battery set level 30 >/dev/null
  v2=$(verdict battery)
  sh_ dumpsys battery reset >/dev/null
  v3=$(verdict battery)
  [ "$v1" = fail ] && [ "$v2" = pass ] && [ "$v3" = pass ] && r=Pass || r=FAIL
  row "Battery 10 %, unplugged" "$r" "detected: $v1; at 30 %: $v2; plugged in again: $v3 (no button: plugging in is the fix)"
}

c_notifications() {
  if [ "$SDK" -lt 33 ]; then row "Notifications off" "Not applicable" "Android $SDK has no runtime notification permission"; return; fi
  sh_ pm revoke "$PKG" android.permission.POST_NOTIFICATIONS >/dev/null
  local v1 v2 opened fixed
  v1=$(verdict notifications)
  open_screen
  tap "fix:notifications" && fixed=tapped || fixed="button not found"
  opened=$(top)
  back_to_check
  sh_ pm grant "$PKG" android.permission.POST_NOTIFICATIONS >/dev/null
  v2=$(verdict notifications)
  [ "$v1" = fail ] && [ "$v2" = pass ] && [ "$fixed" = tapped ] && [[ "$opened" == *ettings* ]] && r=Pass || r=FAIL
  row "Notifications off" "$r" "detected: $v1; \"Turn on\" $fixed: opened $opened; after allowing: $v2"
}

c_fullscreen() {
  if [ "$SDK" -lt 34 ]; then row "Full-screen alarm not allowed" "Not applicable" "always allowed below Android 14"; return; fi
  local before v1 v2 opened fixed
  # The app-wide (uid) mode is what Android reads; the package mode alone changed nothing.
  before=$(sh_ cmd appops get "$PKG" USE_FULL_SCREEN_INTENT | grep -m1 "Uid mode" | grep -o "allow\|deny\|ignore\|default")
  sh_ cmd appops set --uid "$PKG" USE_FULL_SCREEN_INTENT deny >/dev/null
  v1=$(verdict full_screen)
  open_screen
  tap "fix:full_screen" && fixed=tapped || fixed="button not found"
  opened=$(top)
  back_to_check
  sh_ cmd appops set --uid "$PKG" USE_FULL_SCREEN_INTENT "${before:-allow}" >/dev/null
  v2=$(verdict full_screen)
  [ "$v1" = fail ] && [ "$v2" = pass ] && [ "$fixed" = tapped ] && [[ "$opened" == *ettings* ]] && r=Pass || r=FAIL
  row "Full-screen alarm not allowed" "$r" "detected: $v1; \"Allow\" $fixed: opened $opened; put back ($before): $v2"
}

c_exact() {
  if [ "$SDK" -lt 31 ] || [ "$SDK" -gt 32 ]; then
    row "Exact alarms turned off" "Not applicable" "Android $SDK: nothing the user can turn off (USE_EXACT_ALARM from 13, no permission before 12)"
    return
  fi
  local v1 v2 opened fixed
  sh_ cmd appops set "$PKG" SCHEDULE_EXACT_ALARM deny >/dev/null
  v1=$(verdict exact_alarm)
  open_screen
  tap "fix:exact_alarm" && fixed=tapped || fixed="button not found"
  opened=$(top)
  back_to_check
  sh_ cmd appops set "$PKG" SCHEDULE_EXACT_ALARM default >/dev/null
  v2=$(verdict exact_alarm)
  [ "$v1" = fail ] && [ "$v2" = pass ] && [ "$fixed" = tapped ] && [[ "$opened" == *ettings* ]] && r=Pass || r=FAIL
  row "Exact alarms turned off" "$r" "detected: $v1; \"Allow\" $fixed: opened $opened; put back: $v2"
}

c_optimisation() {
  local listed v1 v2 opened fixed
  listed=$(sh_ dumpsys deviceidle whitelist | grep -c "$PKG")
  sh_ dumpsys deviceidle whitelist -"$PKG" >/dev/null
  v1=$(verdict battery_optimization)
  if [ "$v1" = pass ]; then
    row "Battery optimisation on" "Pass (not needed here)" "optimised, and this phone has no manufacturer manager: $v1"
  else
    open_screen
    tap "fix:battery_optimization" && fixed=tapped || fixed="button not found"
    opened=$(top)
    back_to_check
    sh_ dumpsys deviceidle whitelist +"$PKG" >/dev/null
    v2=$(verdict battery_optimization)
    [ "$v1" = fail ] && [ "$v2" = pass ] && [ "$fixed" = tapped ] && [[ "$opened" == *ettings* ]] && r=Pass || r=FAIL
    row "Battery optimisation on" "$r" "detected: $v1; \"Open settings\" $fixed: opened $opened; not optimised: $v2"
  fi
  [ "$listed" -eq 0 ] && sh_ dumpsys deviceidle whitelist -"$PKG" >/dev/null
}

c_manufacturer() {
  local v1 v2 v3 opened fixed
  v1=$(verdict manufacturer)
  if [ "$v1" = pass ]; then
    row "Manufacturer's battery manager" "Pass (none here)" "no manufacturer manager known on this phone"
    return
  fi
  open_screen
  tap "fix:manufacturer" && fixed=tapped || fixed="button not found"
  opened=$(top)
  back_to_check
  tap "confirm:manufacturer"
  v2=$(verdict manufacturer)
  tap "confirm:manufacturer"
  v3=$(verdict manufacturer)
  back_to_check
  # The toggle flips the user's answer and the second tap puts it back, whichever it was.
  local flipped=confirmed; [ "$v1" = confirmed ] && flipped=unverified
  [ "$fixed" = tapped ] && [[ "$opened" != *Preflight* ]] && [ "$v2" = "$flipped" ] && [ "$v3" = "$v1" ] && r=Pass || r=FAIL
  row "Manufacturer's battery manager" "$r" "found: $v1; \"Open settings\" $fixed: opened $opened; toggled: $v2; toggled back: $v3"
}

# The check before bed: an alarm 70 minutes ahead is past its usual check time
# (8.5 hours before), so the check runs a minute after it is set. Once with the
# battery failing (a notification that opens the check), once with everything
# passing (no notification).
# From the app's own active notifications: dumpsys's list kept removed ones on Android 8.
bedtime_notification() { verdict bedtime_notification; }
c_bedtime() {
  local posted opens quiet
  sh_ dumpsys battery unplug >/dev/null
  sh_ dumpsys battery set level 10 >/dev/null
  sh_ am broadcast -a app.somniai.alarm.debug.SCHEDULE $HOOK --es id preflight-test --ei minutes 70 --ez check false >/dev/null
  # It runs a minute later: wait for it rather than guess the moment.
  posted=0
  for _ in $(seq 1 20); do
    posted=$(bedtime_notification)
    [ "$posted" -ge 1 ] && break
    sleep 5
  done
  local record; record=$(sh_ dumpsys notification --noredact | grep -A60 "pkg=$PKG user=[^ ]* id=7002")
  local title; title=$(grep -m1 "android.title=" <<<"$record" | sed 's/.*android.title=String (//; s/)$//')
  # The notification list doesn't name what a tap opens; the pending intents do.
  opens=$(sh_ dumpsys activity intents | grep -o "$PKG/.alarms.PreflightActivity" | head -1 || true)
  sh_ dumpsys battery reset >/dev/null
  sh_ am broadcast -a app.somniai.alarm.debug.CANCEL $HOOK --es id preflight-test >/dev/null
  sh_ am broadcast -a app.somniai.alarm.debug.PREFLIGHT $HOOK --ez open false --ez clear true >/dev/null
  # Removal isn't instant: counted at once, the old one was still listed (CI, API 26 and 32).
  for _ in $(seq 1 10); do [ "$(bedtime_notification)" = 0 ] && break; sleep 1; done
  # Everything passing: nothing posted. (A different minute, so it's a new alarm to check for.)
  local before; before=$(bedtime_notification)
  sh_ am broadcast -a app.somniai.alarm.debug.SCHEDULE $HOOK --es id preflight-quiet --ei minutes 75 --ez check false >/dev/null
  sleep 90
  local all; all=$(verdicts)
  quiet=$(bedtime_notification)
  sh_ am broadcast -a app.somniai.alarm.debug.CANCEL $HOOK --es id preflight-quiet >/dev/null
  if grep -q "=fail\|=unverified" <<<"$all"; then
    quiet="n/a (something else needs attention here: $all)"
  fi
  [ "$posted" -ge 1 ] && [ -n "$opens" ] && [ "$before" = 0 ] && { [ "$quiet" = 0 ] || [[ "$quiet" == n/a* ]]; } && r=Pass || r=FAIL
  row "Bedtime notification" "$r" "battery 10 %: posted $posted (\"$title\"), opens ${opens:-NOT the check}; all passing: $quiet posted after, $before before"
}

"$ADB" wait-for-device
has() { local out; out=$("${@:2}"); grep -q -- "$1" <<<"$out"; }
has "$PKG" sh_ pm list packages "$PKG" || { say "install the debug build first (npm run android:build, then npm run android:run)"; exit 1; }
# A fresh install has no notification permission (13+); the "notifications" case takes it away itself.
[ "$SDK" -ge 33 ] && sh_ pm grant "$PKG" android.permission.POST_NOTIFICATIONS >/dev/null
MODEL=$(sh_ getprop ro.product.manufacturer)" "$(sh_ getprop ro.product.model)
[ -f "$OUT" ] || printf '| Case | Result | Evidence | When |\n| --- | --- | --- | --- |\n' > "$OUT"
printf '| **%s, Android %s (API %s)** | | | |\n' "$MODEL" "$(sh_ getprop ro.build.version.release)" "$SDK" >> "$OUT"
say "before: $(verdicts)"

CASES=("$@")
[ ${#CASES[@]} -eq 0 ] && CASES=(volume dnd battery notifications fullscreen exact optimisation manufacturer bedtime)
for c in "${CASES[@]}"; do
  "c_$c"
done
sh_ input keyevent KEYCODE_HOME >/dev/null
say "after: $(verdicts)"
say "results in $OUT"
[ "$FAILED" -eq 0 ] || { say "$FAILED case(s) failed"; exit 1; }
