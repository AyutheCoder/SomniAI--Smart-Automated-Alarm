#!/usr/bin/env bash
# Runs the on-device tests (android/app/src/androidTest) on the connected
# emulator or phone: installs the debug APK and its test APK, runs them with
# AndroidJUnitRunner, prints the counts, and fails on any failure or if no
# test ran.
#
#   bash scripts/android-instrument.sh [app-debug.apk] [app-debug-androidTest.apk]
#
# Defaults to the build outputs of `npm run android:build`. ADB defaults to adb
# on PATH. In Git Bash, export MSYS_NO_PATHCONV=1 first.
set -euo pipefail

APK="${1:-android/app/build/outputs/apk/debug/app-debug.apk}"
TEST_APK="${2:-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk}"
ADB="${ADB:-adb}"

"$ADB" wait-for-device
"$ADB" install -r "$APK" >/dev/null
"$ADB" install -r -t "$TEST_APK" >/dev/null
SDK=$("$ADB" shell getprop ro.build.version.sdk | tr -d '\r')
echo "instrument: API $SDK"

OUT=$("$ADB" shell am instrument -w -r app.somniai.alarm.test/androidx.test.runner.AndroidJUnitRunner | tr -d '\r')
# Print each test's result, and every failure in full.
awk '
  /^INSTRUMENTATION_STATUS: test=/ { test = substr($0, index($0, "=") + 1) }
  /^INSTRUMENTATION_STATUS: stack=/ { stack = 1 }
  /^INSTRUMENTATION_STATUS_CODE: / {
    code = $2
    if (code == "0") print "  pass   " test
    else if (code == "-2") print "  FAIL   " test
    else if (code == "-3" || code == "-4") print "  skip   " test
    stack = 0
  }
  stack { print "         " $0 }
' <<<"$OUT"

TOTAL=$(grep -c '^INSTRUMENTATION_STATUS_CODE: 1$' <<<"$OUT" || true)
FAILED=$(grep -c '^INSTRUMENTATION_STATUS_CODE: -2$' <<<"$OUT" || true)
SKIPPED=$(grep -cE '^INSTRUMENTATION_STATUS_CODE: -(3|4)$' <<<"$OUT" || true)
PASSED=$((TOTAL - FAILED - SKIPPED))
echo "On-device tests (API $SDK): $PASSED passed, $FAILED failed, $SKIPPED skipped, $TOTAL total"

if [ "$TOTAL" -eq 0 ] || [ "$FAILED" -gt 0 ] || ! grep -q '^OK (' <<<"$OUT"; then
  grep -E '^INSTRUMENTATION_(RESULT|CODE)|^FAILURES|^Tests run' <<<"$OUT" || true
  exit 1
fi
