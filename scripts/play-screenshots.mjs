#!/usr/bin/env node
// Google Play screenshots and the foreground-service video (prompt 7.5), from the
// real app on an emulator or phone: nothing mocked, nothing drawn.
//
//   1. a debug build pointed at staging (demo data never goes to production):
//        CAP_SERVER_URL=https://somniai-staging.vercel.app CAP_RELEASE=1, then assembleDebug
//   2. one phone (or emulator) on adb, with USB debugging
//   3. node scripts/play-screenshots.mjs [--replace-app | --use-installed]
//      (--finish: only the last two screens, if the unlock after the ring timed out)
//
// If SomniAI is already on the device it stops, because it would replace the app
// and clear its data (the alarms stay on the account's server); --replace-app
// says to go ahead. This machine's emulator (Android 17, a 4 GB guest) didn't fit
// in its 8 GB with everything else running (7.5): use a phone.
//
// It installs the app, makes a demo account through the sign-up page, sets demo
// alarms and a week of sleep through the app's own forms and API, and captures
// the screen with adb at 1080 x 1920 (9:16, inside Play's 2:1 limit), with
// Android's demo-mode status bar (a fixed clock, full battery).
//
// The video records an alarm being set, the screen being locked, the alarm
// ringing over the lock screen, and the wake check that stops it: what Play's
// foreground-service declaration asks to see (play/DECLARATIONS.md).
//
// Writes play/listing/en-US/graphics/phoneScreenshots/*.jpg and, outside the
// repository, the video (the path is printed). Needs adb and the debug app's
// web view debugging (on in debug builds).
import { _android as android, chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEBUG_APK, findToolchain } from "./android.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "play", "listing", "en-US", "graphics", "phoneScreenshots");
const PKG = "app.somniai.alarm";
const t = findToolchain();
const ADB = t.sdkParts.adb;

const adb = (...args) => execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const shell = (cmd) => adb("shell", cmd);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The status bar's height in pixels, from the window manager's insets (0 if it can't tell). */
function statusBarHeight() {
  const m = /type=statusBars[^\n]*?frame=\[0,0\]\[\d+,(\d+)\]/.exec(shell("dumpsys window"));
  return m ? Number(m[1]) : 0;
}

/**
 * Android's screen capture is a PNG with an alpha channel, which Play refuses for
 * screenshots: each is redrawn as a JPEG at once, so a later failure keeps it.
 * The status bar is cropped off: phone makers' own icons (a USB link, a clock
 * that demo mode can't fix on every phone) aren't the app.
 */
let converter = null;

async function capture(name) {
  if (!/mWakefulness=Awake/.test(shell("dumpsys power"))) {
    throw new Error(`the screen is off: not capturing ${name}`);
  }
  const png =execFileSync(ADB, ["exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== 1080 || height !== 1920) {
    throw new Error(`the screen is ${width} x ${height}, not 1080 x 1920 (Play allows at most 2:1)`);
  }
  const top = statusBarHeight();
  converter ??= await (await chromium.launch()).newPage({ deviceScaleFactor: 1 });
  await converter.setViewportSize({ width, height: height - top });
  await converter.setContent(`<body style="margin:0;overflow:hidden"><img style="display:block;margin-top:-${top}px" src="data:image/png;base64,${png.toString("base64")}" width="${width}" height="${height}"></body>`);
  await converter.locator("img").evaluate((img) => img.decode());
  writeFileSync(join(OUT, `${name}.jpg`), await converter.screenshot({ type: "jpeg", quality: 92 }));
  console.log(`  ${name}.jpg (${width} x ${height - top})`);
}

/** Android's view tree as uiautomator sees it, or "" while it can't (screen off, mid-transition). */
function viewTree() {
  try {
    shell("uiautomator dump /sdcard/somniai-ui.xml");
    return adb("exec-out", "cat", "/sdcard/somniai-ui.xml");
  }
  catch {
    return "";
  }
}

function centreOf(xml, label) {
  const attr = `(?:content-desc|text)="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`;
  const m = new RegExp(`${attr}[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`).exec(xml);
  return m ? [(Number(m[1]) + Number(m[3])) >> 1, (Number(m[2]) + Number(m[4])) >> 1] : null;
}

/** Whether adb may inject taps (Xiaomi needs "USB debugging (Security settings)"). */
function canTap() {
  return !/SecurityException|INJECT_EVENTS/.test(shell("input keyevent KEYCODE_UNKNOWN 2>&1"));
}

async function waitFor(test, ms, every = 1500) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    const xml = viewTree();
    if (test(xml)) {
      return xml;
    }
    await sleep(every);
  }
  return null;
}

const SUM = /text="(\d+) × (\d+) \+ (\d+) × (\d+) = \?"/;
const ringing = () => /RingActivity/.test(shell("dumpsys window | grep mCurrentFocus"));

function setUpScreen() {
  shell("wm size 1080x1920");
  shell("wm density 420");
  shell("settings put global sysui_demo_allowed 1");
  const demo = (args) => shell(`am broadcast -a com.android.systemui.demo ${args}`);
  demo("-e command enter");
  demo("-e command clock -e hhmm 2215");
  demo("-e command battery -e level 100 -e plugged false");
  demo("-e command network -e wifi show -e level 4 -e fully true");
  demo("-e command network -e mobile hide");
  demo("-e command notifications -e visible false");
  shell("settings put system screen_off_timeout 600000");
  // An emulator short of host memory shows "<some app> isn't responding" over
  // everything (CLAUDE.md); those dialogs are the emulator's, not the app's.
  shell("settings put global hide_error_dialogs 1");
}

function restoreScreen() {
  shell("settings put global hide_error_dialogs 0");
  shell("am broadcast -a com.android.systemui.demo -e command exit");
  shell("wm size reset");
  shell("wm density reset");
}

/**
 * Solves the ring screen's sums as a person would: read, type, Check. With
 * uiautomator and adb input, not Playwright's device driver: that needs a helper
 * app installed over USB, which some phones refuse. Where adb may not tap, a
 * person solves them, and this waits.
 */
async function solveNativeSums(tap) {
  if (!tap) {
    console.log("  solve the sums on the phone to stop the alarm…");
    for (let i = 0; i < 120 && ringing(); i++) {
      await sleep(1500);
    }
    return;
  }
  for (let i = 0; i < 6 && ringing(); i++) {
    const xml = await waitFor((x) => SUM.test(x), 15_000);
    const m = xml && SUM.exec(xml);
    if (!m) {
      return;
    }
    const answer = centreOf(xml, "Answer");
    shell(`input tap ${answer[0]} ${answer[1]}`);
    await sleep(500);
    shell(`input text ${Number(m[1]) * Number(m[2]) + Number(m[3]) * Number(m[4])}`);
    await sleep(1200); // Readable in the video.
    const check = centreOf(viewTree(), "Check");
    shell(`input tap ${check[0]} ${check[1]}`);
    await sleep(2500);
  }
}

/** The page's local "YYYY-MM-DDTHH:mm" for a time `ms` from now, as the alarm form takes it. */
const localAt = (page, ms) => page.evaluate((ms) => {
  const d = new Date(Date.now() + ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}, ms);

async function addAlarm(page, label, at) {
  const form = page.locator("form", { has: page.getByPlaceholder(/Alarm label/) });
  await form.getByPlaceholder(/Alarm label/).fill(label);
  await form.locator('input[type="datetime-local"]').fill(at);
  await form.getByRole("button", { name: "Add alarm" }).click();
  await page.locator("li", { hasText: label }).getByText("scheduled").waitFor({ timeout: 60_000 });
}

/**
 * Scrolls so `locator` sits near the top of the screen, below the status bar
 * (the web view draws under it, and `capture` crops it off), and lets it settle.
 */
async function show(locator, offset = 12) {
  const bar = statusBarHeight();
  await locator.evaluate((el, [offset, bar]) => window.scrollTo({
    top: el.getBoundingClientRect().top + window.scrollY - offset - bar / window.devicePixelRatio,
    behavior: "instant",
  }), [offset, bar]);
  await sleep(1200);
}

async function main() {
  if (!ADB) {
    throw new Error("no adb: npm run android:doctor");
  }
  // On a phone, SomniAI may already hold someone's real alarms: this replaces the
  // app with a staging build and clears its data, so it asks to be told first.
  const installed = shell(`pm list packages ${PKG}`).includes(PKG);
  // --use-installed: the staging debug build is already on the phone, put there by
  // hand (Xiaomi phones can refuse installs over USB: INSTALL_FAILED_USER_RESTRICTED).
  const useInstalled = process.argv.includes("--use-installed");
  if (installed && !useInstalled && !process.argv.includes("--replace-app")) {
    throw new Error(`SomniAI is installed on this device. This would replace it with a staging build and clear its data `
      + `(its alarms; they stay on the account's server). Run again with --replace-app to go ahead.`);
  }
  if (useInstalled && !/versionName=dev\b/.test(shell(`dumpsys package ${PKG}`))) {
    throw new Error("--use-installed needs the debug build on the phone, not a release");
  }
  // Staging's AI Brain is on a free plan and sleeps; wake it before the plan is asked for.
  const brain = JSON.parse(readFileSync(join(ROOT, "deploy", "environments.json"), "utf8")).staging.brain;
  await fetch(`${brain}/health`, { signal: AbortSignal.timeout(120_000) }).catch(() => null);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  if (useInstalled) {
    shell(`pm clear ${PKG}`);
  }
  else {
    if (installed) {
      shell(`pm uninstall ${PKG}`); // A Play build is signed differently: install can't go over it.
    }
    adb("install", DEBUG_APK);
  }
  // What a first start asks for, granted as a person would, so screens show the app rather than prompts.
  try {
    shell(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`);
  }
  catch {
    console.log("  couldn't grant notifications over adb (Xiaomi: \"USB debugging (Security settings)\"); allow them on the phone if asked");
  }
  setUpScreen();

  const [device] = await android.devices();
  if (!device) {
    throw new Error("no device on adb");
  }
  shell(`am start -W -n ${PKG}/.MainActivity`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 60_000 });
  const page = await webview.page();
  page.setDefaultTimeout(90_000);

  // A demo account, through the app's own sign-up page.
  const email = `play-demo-${Date.now()}@example.com`;
  await page.waitForURL(/^https:/);
  await page.goto(new URL("/sign-up", page.url()).href);
  await page.getByLabel("Name").fill("Sam");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(`demo-${Date.now()}-password`);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Adaptive Alarms" }).waitFor();

  // A week of sleep, as a person would have logged it.
  await page.evaluate(async () => {
    const hours = [7.2, 6.4, 7.8, 6.9, 7.5, 8.1, 6.7, 7.3];
    for (let i = 1; i <= hours.length; i++) {
      const wake = new Date();
      wake.setDate(wake.getDate() - i + 1);
      wake.setHours(7, [5, 20, 0, 40, 10, 55, 15, 0][i - 1], 0, 0);
      const sleep = new Date(wake.getTime() - hours[i - 1] * 3600_000 - 15 * 60_000);
      const date = `${wake.getFullYear()}-${String(wake.getMonth() + 1).padStart(2, "0")}-${String(wake.getDate()).padStart(2, "0")}`;
      await fetch("/api/sleep-logs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, sleepTime: sleep.toISOString(), wakeTime: wake.toISOString(), durationHours: hours[i - 1] }),
      });
    }
  });

  // Tomorrow's alarms.
  await page.reload();
  await page.getByRole("heading", { name: "Adaptive Alarms" }).waitFor();
  await addAlarm(page, "Work", (await localAt(page, 86_400_000)).slice(0, 11) + "07:00");
  await addAlarm(page, "Flight to Delhi", (await localAt(page, 2 * 86_400_000)).slice(0, 11) + "04:45");

  // 1. The alarms, once the phone has them (a fresh page: an empty form).
  await page.reload();
  await page.getByText("Alarms ring from this phone, even with the app closed.").waitFor();
  await show(page.getByRole("heading", { name: "Adaptive Alarms" }));
  await capture("1-alarms");

  // 2. Tonight's plan, from the AI Brain (staging's; it may need a minute to wake).
  const tonight = page.getByRole("region", { name: "Tonight" });
  await tonight.getByLabel("Must be up at").fill("06:30");
  const answer = tonight.getByRole("alert").or(tonight.getByRole("status")).or(tonight.getByText(/bed by|Go to bed|planner is offline/i)).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    await tonight.getByRole("button", { name: "Plan my night" }).click();
    await answer.waitFor({ timeout: 150_000 });
    if (!(await tonight.getByText(/planner is offline/i).isVisible())) {
      break;
    }
    // A free AI Brain still waking: the app says so honestly; ask again once it's up.
    await sleep(20_000);
  }
  await show(tonight.getByText("Must be up at"), 24);
  await capture("2-tonight");

  // 3. Insights.
  await show(page.getByRole("region", { name: "Sleep score and coaching" }));
  await capture("3-insights");

  // 4. Wake buddy, with an invite code to give a friend.
  const buddy = page.getByRole("region", { name: "Wake buddy" });
  await buddy.getByRole("button", { name: "Get a code" }).click();
  await buddy.getByLabel("Invite code").waitFor();
  await show(buddy);
  await capture("4-buddy");

  // 5-6. An alarm ringing over the lock screen, recorded for the declaration.
  const video = join(ROOT, "android", "app", "build", "play-video", "alarm-rings.mp4");
  mkdirSync(join(video, ".."), { recursive: true });
  await show(page.getByRole("heading", { name: "Adaptive Alarms" }));
  const tap = canTap();
  shell("rm -f /sdcard/alarm-rings.mp4");
  // At the screen's (1080 x 1920) size: some phones' encoders refuse their native one ("Encoder failed").
  const rec = spawn(ADB, ["shell", "screenrecord", "--size", "1080x1920", "--time-limit", "180", "--bit-rate", "6000000", "/sdcard/alarm-rings.mp4"]);
  let recording = true;
  rec.on("exit", () => {
    recording = false;
  });
  await sleep(1500);
  await addAlarm(page, "Workout", await localAt(page, 60_000));
  await sleep(2500);
  shell("input keyevent KEYCODE_SLEEP");
  // Rings at the start of the next minute.
  for (let i = 0; i < 100 && !ringing(); i++) {
    await sleep(1500);
  }
  if (!ringing()) {
    throw new Error("the alarm didn't ring within 150 s");
  }
  await sleep(3000);
  await capture("5-ringing");
  // "Stop alarm" leads to the wake check.
  const stop = centreOf(await waitFor((x) => /Stop alarm/.test(x), 10_000) ?? "", "Stop alarm");
  if (tap && stop) {
    shell(`input tap ${stop[0]} ${stop[1]}`);
  }
  else {
    console.log("  tap Stop alarm on the phone…");
  }
  if (await waitFor((x) => SUM.test(x), 60_000)) {
    await capture("6-wake-check");
  }
  await solveNativeSums(tap);
  await sleep(3000);
  rec.kill("SIGINT");
  shell("pkill -INT screenrecord");
  await sleep(3000);
  if (recording || shell("ls -l /sdcard/alarm-rings.mp4").includes(" 0 ")) {
    console.log("  no video: the phone's screen recorder failed; record one with the phone's own recorder (play/README.md)");
  }
  else {
    adb("pull", "/sdcard/alarm-rings.mp4", video);
    console.log(`  video: ${video}`);
  }

  await finish(page);
  console.log(`screenshots in ${OUT}; demo account on staging: ${email}`);
}

const locked = () => /(mKeyguardShowing|isKeyguardShowing|mShowingLockscreen|mDreamingLockscreen)=true/.test(shell("dumpsys window"));
const awake = () => /mWakefulness=Awake/.test(shell("dumpsys power"));

/**
 * 7-8: the morning report and the bedtime check, which need the phone unlocked:
 * a phone with a PIN needs a person. Stops rather than capture a dark screen.
 */
async function finish(page) {
  shell("input keyevent KEYCODE_WAKEUP");
  shell("wm dismiss-keyguard");
  for (let i = 0; i < 90 && (locked() || !awake()); i++) {
    if (i === 0) {
      console.log("  unlock the phone to go on…");
    }
    if (!awake()) {
      shell("input keyevent KEYCODE_WAKEUP");
    }
    await sleep(2000);
  }
  if (locked() || !awake()) {
    throw new Error("the phone is still locked; unlock it and run again with --finish for the last two screens");
  }
  shell(`am start -W -n ${PKG}/.MainActivity`);
  await page.reload();
  const report = page.getByRole("region", { name: "Morning report" });
  await report.waitFor({ timeout: 90_000 });
  await show(report);
  await capture("7-morning-report");

  // The bedtime check (debug builds open it for adb; the same screen the app shows before bed).
  shell(`am start -W -n ${PKG}/.alarms.DebugPreflightScreen`);
  await sleep(4000);
  await capture("8-bedtime-check");
  restoreScreen();
  await converter?.context().browser()?.close();
}

/** --finish: only the last two screens, from the app as it is (after an unlock timed out). */
async function finishOnly() {
  mkdirSync(OUT, { recursive: true });
  setUpScreen();
  const [device] = await android.devices();
  shell(`am start -W -n ${PKG}/.MainActivity`);
  const page = await (await device.webView({ pkg: PKG }, { timeout: 60_000 })).page();
  page.setDefaultTimeout(90_000);
  await finish(page);
  console.log(`screenshots in ${OUT}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Playwright's connection to the phone keeps Node running: exit when done.
  (process.argv.includes("--finish") ? finishOnly() : main()).then(() => process.exit(0), (e) => {
    console.error(`play-screenshots: ${e.message}`);
    try {
      restoreScreen();
    }
    catch {
      // The device may be gone.
    }
    process.exit(1);
  });
}
