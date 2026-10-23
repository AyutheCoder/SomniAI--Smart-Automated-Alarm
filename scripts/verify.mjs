#!/usr/bin/env node
// One command that checks everything (DEVELOPMENT_PLAN.md, Part 4).
//
//   npm run verify       lint (zero warnings), tsc, vitest, next build
//   npm run verify:all   all of the above, plus the AI Brain pytest suite, the
//                        Android unit tests and the debug APK build
//
// Every step runs even after an earlier one fails, so one run shows everything
// that is wrong. Counts come from each tool's machine-readable report, not from
// scraping its console output, and the exit code is non-zero if any step failed.
//
// The AI Brain step uses ai-brain/.venv when it exists, otherwise `python` on PATH.
// The Android steps need JDK 21 and the Android SDK (npm run android:doctor);
// without them they fail and say what is missing.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatSummary,
  summarizeEslint,
  summarizeJunit,
  summarizeVitest,
} from "./verify-summary.mjs";
import { DEBUG_APK, UNIT_TEST_RESULTS, findToolchain, gradle } from "./android.mjs";

const all = process.argv.includes("--all");
const tmp = mkdtempSync(join(tmpdir(), "somniai-verify-"));

/** Runs a command through the shell so `npx` resolves on Windows too. */
function sh(command, opts = {}) {
  return spawnSync(command, { shell: true, stdio: "inherit", ...opts });
}

function spawnError(res) {
  return res.error ? `could not start: ${res.error.message}` : undefined;
}

async function lint() {
  const { ESLint } = await import("eslint");
  const eslint = new ESLint();
  const results = await eslint.lintFiles(["."]);
  const formatter = await eslint.loadFormatter("stylish");
  const out = await formatter.format(results);
  if (out) {
    console.log(out);
  }
  return {
    exitCode: 0,
    counts: summarizeEslint(results),
    ranSomething: (c) => c.files > 0,
    extraFailure: (c) =>
      c.errors > 0 ? `${c.errors} errors` : c.warnings > 0 ? `${c.warnings} warnings (none allowed)` : null,
  };
}

function tsc() {
  const res = sh("npx --no-install tsc --noEmit", { stdio: ["inherit", "pipe", "pipe"], encoding: "utf8" });
  process.stdout.write(res.stdout ?? "");
  process.stderr.write(res.stderr ?? "");
  const errors = ((res.stdout ?? "").match(/error TS\d+/g) ?? []).length;
  return {
    exitCode: res.status,
    error: spawnError(res),
    counts: { errors },
    extraFailure: (c) => (c.errors > 0 ? `${c.errors} type errors` : null),
  };
}

function vitest() {
  const report = join(tmp, "vitest.json");
  const res = sh(`npx --no-install vitest run --reporter=default --reporter=json --outputFile.json="${report}"`);
  let counts = null;
  if (existsSync(report)) {
    try {
      counts = summarizeVitest(JSON.parse(readFileSync(report, "utf8")));
    }
    catch {
      counts = null;
    }
  }
  return {
    exitCode: res.status,
    error: spawnError(res),
    counts,
    ranSomething: (c) => c.total > 0,
    extraFailure: (c) => (c.failed > 0 ? `${c.failed} tests failed` : null),
  };
}

function build() {
  const res = sh("npx --no-install next build");
  return { exitCode: res.status, error: spawnError(res), needsCounts: false, detail: "production build" };
}

function pytest() {
  const venv = process.platform === "win32"
    ? join("ai-brain", ".venv", "Scripts", "python.exe")
    : join("ai-brain", ".venv", "bin", "python");
  const python = existsSync(venv) ? join(process.cwd(), venv) : "python";
  const report = join(tmp, "pytest.xml");
  const res = spawnSync(python, ["-m", "pytest", "-p", "no:warnings", `--junitxml=${report}`], {
    cwd: "ai-brain",
    stdio: "inherit",
  });
  let counts = null;
  if (existsSync(report)) {
    try {
      counts = summarizeJunit(readFileSync(report, "utf8"));
    }
    catch {
      counts = null;
    }
  }
  return {
    exitCode: res.status,
    error: spawnError(res),
    counts,
    ranSomething: (c) => c.total > 0,
    extraFailure: (c) => (c.failed + c.errors > 0 ? `${c.failed} failed, ${c.errors} errors` : null),
  };
}

/** Fails, naming the fix, when the Android toolchain isn't there: never a quiet skip. */
function androidToolchain() {
  const t = findToolchain();
  return t.missing.length === 0
    ? { t }
    : { error: `Android toolchain incomplete: ${t.missing.map((m) => m.split(":")[0]).join(", ")}. Run npm run android:doctor` };
}

function androidTests() {
  const { t, error } = androidToolchain();
  if (error) {
    return { exitCode: null, error };
  }
  // Last run's reports must not be counted as this run's.
  rmSync(UNIT_TEST_RESULTS, { recursive: true, force: true });
  const status = gradle("testDebugUnitTest", t);
  let counts = null;
  if (existsSync(UNIT_TEST_RESULTS)) {
    try {
      const xml = readdirSync(UNIT_TEST_RESULTS)
        .filter((f) => f.endsWith(".xml"))
        .map((f) => readFileSync(join(UNIT_TEST_RESULTS, f), "utf8"))
        .join("\n");
      counts = summarizeJunit(xml);
    }
    catch {
      counts = null;
    }
  }
  return {
    exitCode: status,
    counts,
    ranSomething: (c) => c.total > 0,
    extraFailure: (c) => (c.failed + c.errors > 0 ? `${c.failed} failed, ${c.errors} errors` : null),
  };
}

function androidApk() {
  const { t, error } = androidToolchain();
  if (error) {
    return { exitCode: null, error };
  }
  rmSync(DEBUG_APK, { force: true });
  const status = gradle("assembleDebug", t);
  if (status === 0 && !existsSync(DEBUG_APK)) {
    return { exitCode: 0, needsCounts: false, error: "assembleDebug exited 0 but produced no APK" };
  }
  const size = existsSync(DEBUG_APK) ? `${Math.round(statSync(DEBUG_APK).size / 1024)} KB` : "";
  return { exitCode: status, needsCounts: false, detail: `debug APK ${size}`.trim() };
}

const steps = [
  ["lint", lint],
  ["tsc", tsc],
  ["vitest", vitest],
  ["build", build],
  ...(all ? [["pytest", pytest], ["android", androidTests], ["apk", androidApk]] : []),
];

const outcomes = [];
for (const [name, run] of steps) {
  console.log(`\n==> ${name}`);
  const started = Date.now();
  let outcome;
  try {
    outcome = await run();
  }
  catch (e) {
    outcome = { exitCode: null, error: e instanceof Error ? e.message : String(e) };
  }
  outcomes.push({ name, ...outcome, seconds: (Date.now() - started) / 1000 });
}
rmSync(tmp, { recursive: true, force: true });

const { ok, text } = formatSummary(outcomes);
console.log(`\n==> summary (${all ? "verify:all" : "verify"})\n${text}`);
process.exit(ok ? 0 : 1);
