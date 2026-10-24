// Pure helpers for scripts/verify.mjs: turn each tool's machine-readable report
// into counts, and decide pass or fail from the counts as well as the exit code.
//
// A step only passes when it exited 0 AND its counts could be read AND it
// actually ran something. A suite that silently collected zero tests, or a
// report that could not be parsed, is a failure, never a quiet green.

/**
 * @param {Array<{ errorCount: number, warningCount: number, fatalErrorCount?: number }>} results
 */
export function summarizeEslint(results) {
  return {
    files: results.length,
    errors: results.reduce((n, r) => n + r.errorCount, 0),
    warnings: results.reduce((n, r) => n + r.warningCount, 0),
  };
}

/**
 * @param {{ numPassedTests: number, numFailedTests: number, numPendingTests?: number,
 *   numTodoTests?: number, numTotalTests: number, testResults: unknown[] }} report
 */
export function summarizeVitest(report) {
  return {
    files: report.testResults.length,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    total: report.numTotalTests,
  };
}

/**
 * Sums every <testsuite> element of a JUnit XML report (pytest writes one).
 * @param {string} xml
 */
export function summarizeJunit(xml) {
  const suites = [...xml.matchAll(/<testsuite\b([^>]*)>/g)];
  if (suites.length === 0) {
    throw new Error("no <testsuite> element in JUnit report");
  }
  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  for (const [, attrs] of suites) {
    for (const key of Object.keys(totals)) {
      const m = attrs.match(new RegExp(`\\b${key}="(\\d+)"`));
      if (!m) {
        throw new Error(`<testsuite> has no ${key} attribute`);
      }
      totals[/** @type {keyof typeof totals} */ (key)] += Number(m[1]);
    }
  }
  return {
    passed: totals.tests - totals.failures - totals.errors - totals.skipped,
    failed: totals.failures,
    errors: totals.errors,
    skipped: totals.skipped,
    total: totals.tests,
  };
}

/**
 * @typedef {{ name: string, exitCode: number | null, counts?: Record<string, number> | null,
 *   ranSomething?: (counts: Record<string, number>) => boolean,
 *   extraFailure?: (counts: Record<string, number>) => string | null,
 *   needsCounts?: boolean, detail?: string, error?: string, seconds?: number }} StepOutcome
 */

/**
 * @param {StepOutcome} step
 * @returns {{ ok: boolean, reason: string }}
 */
export function judge(step) {
  if (step.error) {
    return { ok: false, reason: step.error };
  }
  if (step.exitCode !== 0) {
    return { ok: false, reason: `exited with ${step.exitCode ?? "a signal"}` };
  }
  if (step.needsCounts !== false) {
    if (!step.counts) {
      return { ok: false, reason: "exited 0 but its report could not be read" };
    }
    if (step.ranSomething && !step.ranSomething(step.counts)) {
      return { ok: false, reason: "exited 0 but ran nothing" };
    }
    const extra = step.extraFailure?.(step.counts);
    if (extra) {
      return { ok: false, reason: extra };
    }
  }
  return { ok: true, reason: "" };
}

/**
 * @param {Record<string, number> | null | undefined} counts
 */
export function formatCounts(counts) {
  if (!counts) {
    return "";
  }
  return Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
}

/**
 * @param {StepOutcome[]} steps
 */
export function formatSummary(steps) {
  const rows = steps.map((s) => {
    const { ok, reason } = judge(s);
    const what = s.counts ? formatCounts(s.counts) : (s.detail ?? "");
    const time = s.seconds === undefined ? "" : ` (${s.seconds.toFixed(1)}s)`;
    return { ok, line: `${ok ? "PASS" : "FAIL"}  ${s.name.padEnd(8)} ${what}${time}${ok ? "" : `  <- ${reason}`}` };
  });
  const failed = steps.filter((_, i) => !rows[i].ok).map((s) => s.name);
  const banner = failed.length === 0
    ? "VERIFY PASSED"
    : `VERIFY FAILED: ${failed.join(", ")}`;
  return { ok: failed.length === 0, text: [...rows.map((r) => r.line), "", banner].join("\n") };
}
