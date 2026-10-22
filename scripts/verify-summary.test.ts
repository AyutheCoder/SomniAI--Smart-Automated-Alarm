import { describe, expect, it } from "vitest";
import {
  formatSummary,
  judge,
  summarizeEslint,
  summarizeJunit,
  summarizeVitest,
} from "./verify-summary.mjs";

const PYTEST_XML =
  '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests">' +
  '<testsuite name="pytest" errors="1" failures="2" skipped="28" tests="311" time="56.3">' +
  '<testcase classname="tests.a" name="t" time="0.001" /></testsuite></testsuites>';

describe("report parsing", () => {
  it("sums ESLint errors and warnings across files", () => {
    expect(summarizeEslint([
      { errorCount: 0, warningCount: 2 },
      { errorCount: 1, warningCount: 0 },
      { errorCount: 0, warningCount: 0 },
    ])).toEqual({ files: 3, errors: 1, warnings: 2 });
  });

  it("reads vitest's JSON report, counting todo as skipped", () => {
    expect(summarizeVitest({
      numPassedTests: 70,
      numFailedTests: 1,
      numPendingTests: 2,
      numTodoTests: 1,
      numTotalTests: 74,
      testResults: [{}, {}, {}],
    })).toEqual({ files: 3, passed: 70, failed: 1, skipped: 3, total: 74 });
  });

  it("derives passed from pytest's JUnit totals", () => {
    expect(summarizeJunit(PYTEST_XML)).toEqual({
      passed: 280, failed: 2, errors: 1, skipped: 28, total: 311,
    });
  });

  it("sums several <testsuite> elements without counting the <testsuites> wrapper", () => {
    const xml = '<testsuites tests="99"><testsuite tests="3" failures="0" errors="0" skipped="1">'
      + '</testsuite><testsuite tests="2" failures="1" errors="0" skipped="0"></testsuite></testsuites>';
    expect(summarizeJunit(xml)).toEqual({ passed: 3, failed: 1, errors: 0, skipped: 1, total: 5 });
  });

  it("refuses a report it cannot read rather than returning zeros", () => {
    expect(() => summarizeJunit("<html>not junit</html>")).toThrow();
    expect(() => summarizeJunit('<testsuite tests="3">')).toThrow(/failures/);
  });
});

describe("judge never reports a success that did not happen", () => {
  const ranTests = (c: Record<string, number>) => c.total > 0;

  it("fails a non-zero exit even when the counts look clean", () => {
    expect(judge({ name: "tsc", exitCode: 2, counts: { errors: 0 } }).ok).toBe(false);
  });

  it("fails a step killed by a signal", () => {
    expect(judge({ name: "build", exitCode: null, needsCounts: false }).reason).toMatch(/signal/);
  });

  it("fails a step that could not start", () => {
    const r = judge({ name: "pytest", exitCode: null, error: "could not start: spawn python ENOENT" });
    expect(r).toEqual({ ok: false, reason: "could not start: spawn python ENOENT" });
  });

  it("fails exit 0 when the report could not be read", () => {
    expect(judge({ name: "vitest", exitCode: 0, counts: null }).reason).toMatch(/could not be read/);
  });

  it("fails exit 0 when nothing ran", () => {
    const r = judge({ name: "vitest", exitCode: 0, counts: { total: 0 }, ranSomething: ranTests });
    expect(r).toEqual({ ok: false, reason: "exited 0 but ran nothing" });
  });

  it("fails on lint warnings even with no errors", () => {
    const r = judge({
      name: "lint",
      exitCode: 0,
      counts: { files: 90, errors: 0, warnings: 1 },
      extraFailure: (c) => (c.warnings > 0 ? `${c.warnings} warnings (none allowed)` : null),
    });
    expect(r).toEqual({ ok: false, reason: "1 warnings (none allowed)" });
  });

  it("passes a clean step, and a count-less step like the build on exit 0", () => {
    expect(judge({ name: "vitest", exitCode: 0, counts: { total: 70 }, ranSomething: ranTests }).ok).toBe(true);
    expect(judge({ name: "build", exitCode: 0, needsCounts: false }).ok).toBe(true);
  });
});

describe("formatSummary", () => {
  it("names every failed step in the banner and reports not ok", () => {
    const { ok, text } = formatSummary([
      { name: "lint", exitCode: 0, counts: { files: 90, errors: 0, warnings: 0 } },
      { name: "tsc", exitCode: 2, counts: { errors: 3 } },
      { name: "build", exitCode: 1, needsCounts: false, detail: "production build" },
    ]);
    expect(ok).toBe(false);
    expect(text).toMatch(/^PASS {2}lint {5}90 files, 0 errors, 0 warnings$/m);
    expect(text).toMatch(/^FAIL {2}tsc .*<- exited with 2$/m);
    expect(text.trim().split("\n").at(-1)).toBe("VERIFY FAILED: tsc, build");
  });

  it("says VERIFY PASSED only when every step passed", () => {
    const { ok, text } = formatSummary([{ name: "build", exitCode: 0, needsCounts: false, seconds: 41.25 }]);
    expect(ok).toBe(true);
    expect(text).toMatch(/^PASS {2}build +\(41\.3s\)$/m);
    expect(text.trim().split("\n").at(-1)).toBe("VERIFY PASSED");
  });
});
