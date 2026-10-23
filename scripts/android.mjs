#!/usr/bin/env node
// The Android toolchain: find it, say what is missing, and run the build.
//
//   npm run android:doctor   what is installed, what is missing, what to install
//   npm run android:test     sync, then the JVM unit tests (testDebugUnitTest)
//   npm run android:build    sync, then the debug APK (assembleDebug)
//   npm run android:run      install the debug APK on the running emulator or
//                            phone, and open it
//
// Nothing here assumes where things are installed: every location is checked
// for existence, and the JDK's version is read from the JDK itself.
//
// Versions come from the generated project, not memory:
//   - Capacitor's Android library compiles for Java 21 (sourceCompatibility).
//   - Gradle 8.14.3 (gradle-wrapper.properties) runs on Java up to 24; on JDK 26
//     it fails with "Unsupported class file major version 70" (seen here).
//   - compileSdk and targetSdk are 36 (android/variables.gradle).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeJunit } from "./verify-summary.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ANDROID = join(ROOT, "android");
const WIN = process.platform === "win32";
const exe = (name) => (WIN ? `${name}.exe` : name);

export const JDK_MIN = 21;
export const JDK_MAX = 24;
export const PLATFORM = "android-36";

function javaMajor(javaHome) {
  const java = join(javaHome, "bin", exe("java"));
  if (!existsSync(java)) {
    return null;
  }
  const res = spawnSync(java, ["-version"], { encoding: "utf8" });
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${res.stderr}${res.stdout}`);
  if (!m) {
    return null;
  }
  // Java 8 and earlier report "1.8"; anything this project accepts reports its major.
  return m[1] === "1" ? Number(m[2]) : Number(m[1]);
}

/** The JDK behind the `java` on PATH, as the JVM itself reports its home. */
function javaOnPath() {
  const res = spawnSync("java", ["-XshowSettings:properties", "-version"], { encoding: "utf8", shell: WIN });
  const m = /java\.home = (.+)/.exec(`${res.stderr}${res.stdout}`);
  return m ? m[1].trim() : null;
}

/** Where Android Studio puts its bundled JDK, for installs that exist. */
function androidStudioJdks() {
  const dirs = WIN
    ? [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs")]
      .filter(Boolean)
      .flatMap((base) => [join(base, "Android", "Android Studio", "jbr"), join(base, "Android Studio", "jbr")])
    : process.platform === "darwin"
      ? ["/Applications/Android Studio.app/Contents/jbr/Contents/Home"]
      : ["/opt/android-studio/jbr", join(homedir(), "android-studio", "jbr")];
  return dirs.filter((d) => existsSync(d));
}

function sdkCandidates() {
  const defaults = WIN
    ? [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk")]
    : process.platform === "darwin"
      ? [join(homedir(), "Library", "Android", "sdk")]
      : [join(homedir(), "Android", "Sdk")];
  return [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, ...defaults]
    .filter((d) => d && existsSync(d));
}

const listDir = (d) => (existsSync(d) ? readdirSync(d) : []);

/** Everything found, and a line for everything missing. */
export function findToolchain() {
  const missing = [];
  const notes = [];

  const jdkCandidates = [...new Set([process.env.JAVA_HOME, ...androidStudioJdks(), javaOnPath()].filter(Boolean))];
  let jdk = null;
  for (const home of jdkCandidates) {
    const major = javaMajor(home);
    if (major !== null && major >= JDK_MIN && major <= JDK_MAX) {
      jdk = { home, major };
      break;
    }
    if (major !== null) {
      notes.push(`JDK ${major} at ${home} is outside ${JDK_MIN}-${JDK_MAX}, which this Gradle can use`);
    }
  }
  if (!jdk) {
    missing.push(`JDK ${JDK_MIN}: install Android Studio (it bundles one) or a JDK ${JDK_MIN}, then set JAVA_HOME to it`);
  }

  const sdk = sdkCandidates()[0] ?? null;
  const sdkParts = {};
  if (!sdk) {
    missing.push("Android SDK: install Android Studio and run its setup wizard, or set ANDROID_HOME");
  }
  else {
    sdkParts.platform = existsSync(join(sdk, "platforms", PLATFORM));
    sdkParts.buildTools = listDir(join(sdk, "build-tools")).sort().pop() ?? null;
    sdkParts.adb = existsSync(join(sdk, "platform-tools", exe("adb"))) ? join(sdk, "platform-tools", exe("adb")) : null;
    sdkParts.emulator = existsSync(join(sdk, "emulator", exe("emulator"))) ? join(sdk, "emulator", exe("emulator")) : null;
    sdkParts.systemImages = listDir(join(sdk, "system-images"));
    if (!sdkParts.platform) {
      missing.push(`SDK platform ${PLATFORM} (Android 16): SDK Manager > SDK Platforms`);
    }
    if (!sdkParts.buildTools) {
      missing.push("Android SDK Build-Tools: SDK Manager > SDK Tools");
    }
    if (!sdkParts.adb) {
      missing.push("Android SDK Platform-Tools (adb): SDK Manager > SDK Tools");
    }
  }
  return { jdk, sdk, sdkParts, missing, notes };
}

/** The emulator's own view: its virtual devices, for the doctor report. */
function avds(emulator) {
  if (!emulator) {
    return [];
  }
  const res = spawnSync(emulator, ["-list-avds"], { encoding: "utf8" });
  return (res.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("INFO"));
}

function doctor() {
  const t = findToolchain();
  const line = (ok, what, detail) => console.log(`${ok ? "OK     " : "MISSING"} ${what}${detail ? `: ${detail}` : ""}`);
  line(Boolean(t.jdk), `JDK ${JDK_MIN}-${JDK_MAX}`, t.jdk ? `${t.jdk.major} at ${t.jdk.home}` : undefined);
  line(Boolean(t.sdk), "Android SDK", t.sdk ?? undefined);
  if (t.sdk) {
    line(t.sdkParts.platform, `SDK platform ${PLATFORM}`);
    line(Boolean(t.sdkParts.buildTools), "Build-Tools", t.sdkParts.buildTools ?? undefined);
    line(Boolean(t.sdkParts.adb), "Platform-Tools (adb)", t.sdkParts.adb ?? undefined);
    line(Boolean(t.sdkParts.emulator), "Emulator", t.sdkParts.emulator ?? undefined);
    line(t.sdkParts.systemImages.length > 0, "Emulator system image", t.sdkParts.systemImages.join(", ") || undefined);
    const devices = avds(t.sdkParts.emulator);
    line(devices.length > 0, "Virtual device (AVD)", devices.join(", ") || undefined);
  }
  for (const n of t.notes) {
    console.log(`note    ${n}`);
  }
  if (t.missing.length > 0) {
    console.log("\nTo install:");
    for (const m of t.missing) {
      console.log(`  - ${m}`);
    }
    console.log("\nSee ANDROID.md for the full steps.");
  }
  return t.missing.length === 0 ? 0 : 1;
}

/** Runs a command with the toolchain on its environment. */
export function withToolchain(t) {
  return {
    ...process.env,
    JAVA_HOME: t.jdk.home,
    ANDROID_HOME: t.sdk,
    // This network's IPv6 route times Java's downloads out; curl was fine.
    GRADLE_OPTS: [process.env.GRADLE_OPTS, "-Djava.net.preferIPv4Stack=true"].filter(Boolean).join(" "),
  };
}

/** `npx cap sync android`, then a Gradle task. Returns the exit status. */
export function gradle(task, t = findToolchain(), stdio = "inherit") {
  const env = withToolchain(t);
  const sync = spawnSync("npx --no-install cap sync android", { cwd: ROOT, env, stdio, shell: true });
  if (sync.status !== 0) {
    return sync.status ?? 1;
  }
  const res = spawnSync(WIN ? "gradlew.bat" : "./gradlew", [task, "--console=plain"], { cwd: ANDROID, env, stdio, shell: WIN });
  return res.status ?? 1;
}

export const DEBUG_APK = join(ANDROID, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
export const UNIT_TEST_RESULTS = join(ANDROID, "app", "build", "test-results", "testDebugUnitTest");

function install(t) {
  if (!existsSync(DEBUG_APK)) {
    console.error("No debug APK yet: run npm run android:build first.");
    return 1;
  }
  const adb = t.sdkParts.adb;
  const devices = spawnSync(adb, ["devices"], { encoding: "utf8" }).stdout ?? "";
  if (!/\tdevice\b/.test(devices)) {
    console.error("No emulator or phone connected. Start the emulator (or plug in a phone with USB debugging), then retry.");
    return 1;
  }
  const steps = [
    ["install", "-r", DEBUG_APK],
    ["shell", "am", "start", "-W", "-n", "app.somniai.alarm/.MainActivity"],
  ];
  for (const args of steps) {
    const res = spawnSync(adb, args, { stdio: "inherit" });
    if (res.status !== 0) {
      return res.status ?? 1;
    }
  }
  console.log(`Installed ${Math.round(statSync(DEBUG_APK).size / 1024)} KB debug APK and opened it.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2];
  if (command === "doctor") {
    process.exit(doctor());
  }
  const t = findToolchain();
  if (t.missing.length > 0) {
    console.error("The Android toolchain is incomplete; run npm run android:doctor for what to install.");
    process.exit(1);
  }
  if (command === "test") {
    // Last run's reports must not count, and a run with no tests is a failure.
    rmSync(UNIT_TEST_RESULTS, { recursive: true, force: true });
    const status = gradle("testDebugUnitTest", t);
    const reports = existsSync(UNIT_TEST_RESULTS) ? readdirSync(UNIT_TEST_RESULTS).filter((f) => f.endsWith(".xml")) : [];
    const c = reports.length > 0
      ? summarizeJunit(reports.map((f) => readFileSync(join(UNIT_TEST_RESULTS, f), "utf8")).join("\n"))
      : { passed: 0, failed: 0, errors: 0, skipped: 0, total: 0 };
    console.log(`Android unit tests: ${c.passed} passed, ${c.failed} failed, ${c.errors} errors, ${c.skipped} skipped, ${c.total} total`);
    process.exit(status !== 0 ? status : c.total === 0 ? 1 : 0);
  }
  if (command === "build") {
    process.exit(gradle("assembleDebug", t));
  }
  if (command === "run") {
    process.exit(install(t));
  }
  console.error("usage: node scripts/android.mjs doctor|test|build|run");
  process.exit(2);
}
