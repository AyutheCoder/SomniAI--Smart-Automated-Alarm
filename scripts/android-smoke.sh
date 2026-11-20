#!/usr/bin/env bash
# Installs a debug APK on the running emulator, opens it, and checks the app's
# activity is the one in front. Used by CI; works locally with an emulator up.
#   scripts/android-smoke.sh path/to/app-debug.apk [screenshot.png]
set -euo pipefail

apk="$1"
shot="${2:-android-smoke.png}"
activity="app.somniai.alarm/.MainActivity"

adb wait-for-device
adb install -r "$apk"

start="$(adb shell am start -W -n "$activity")"
echo "$start"
echo "$start" | grep -q "Status: ok" || { echo "the activity did not start" >&2; exit 1; }

# Give the web view a moment to load (here: the offline page, as no server runs).
sleep 8
resumed="$(adb shell dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" || true)"
echo "$resumed"
echo "$resumed" | grep -q "$activity" || { echo "$activity is not in front" >&2; exit 1; }

adb exec-out screencap -p > "$shot"
echo "installed, opened, and in front; screenshot: $shot"
