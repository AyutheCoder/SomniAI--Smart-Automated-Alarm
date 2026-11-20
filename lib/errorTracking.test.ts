import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { clean, fingerprint, recordError, reportOf, scrub, type ErrorReport, type ErrorStore } from "./errorTracking";
import { ErrorReporter, MAX_PER_PAGE, installErrorReporting } from "./errorReporter";

// The same cases are run against ai-brain/errors.py (ai-brain/tests/test_errors.py).
const CASES = JSON.parse(readFileSync("tests/fixtures/error-scrub/cases.json", "utf8")) as { in: string; out: string }[];

describe("what an error report may contain", () => {
  it.each(CASES.map((c) => [c.in, c.out]))("%s", (input, output) => {
    expect(scrub(input)).toBe(output);
  });

  it("keeps a stack's frames only, scrubbed and clipped, and the place without its query", () => {
    const err = new TypeError("no alarm for someone@example.org");
    err.stack = "TypeError: no alarm\n    at load (app/page.tsx:12:5)\n    at fetch (https://x.example/a?token=1:3:9)\nnoise";
    const c = clean({ ...reportOf(err, "browser"), where: "/alarms?id=64f0a1b2c3d4e5f601234567" });
    expect(c).toEqual({
      source: "browser", kind: "TypeError", message: "no alarm for <email>",
      stack: "at load (app/page.tsx:12:5)\nat fetch (https://x.example/a?<query>", where: "/alarms",
    });
    expect(clean({ source: "server", kind: "E", message: "m".repeat(900) }).message).toHaveLength(500);
  });
});

describe("grouping", () => {
  const base: ErrorReport = { source: "server", kind: "TypeError", message: "x is undefined in 3 places", stack: "at f (lib/a.ts:10:2)", where: "/api/alarms" };

  it("counts the same error as one, across rebuilds and changing numbers", () => {
    expect(fingerprint({ ...base, stack: "at f (lib/a.ts:99:7)", message: "x is undefined in 12 places" })).toBe(fingerprint(base));
  });

  it("keeps different errors apart", () => {
    for (const other of [{ kind: "RangeError" }, { where: "/api/tasks" }, { source: "browser" as const }, { stack: "at g (lib/b.ts:1:1)" }]) {
      expect(fingerprint({ ...base, ...other })).not.toBe(fingerprint(base));
    }
  });
});

describe("recording", () => {
  it("stores the cleaned report under its fingerprint", async () => {
    const store: ErrorStore = { record: vi.fn(async () => {}) };
    expect(await recordError({ source: "server", kind: "Error", message: "for a@b.example" }, new Date(0), store)).toBe("recorded");
    expect(store.record).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: "for <email>" }), new Date(0));
  });

  it("falls back to one scrubbed log line when the database can't take it, and never throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const store: ErrorStore = { record: async () => { throw new Error("database down"); } };
    expect(await recordError({ source: "server", kind: "Error", message: "for a@b.example" }, new Date(), store)).toBe("logged");
    const line = JSON.parse(log.mock.calls[0][0] as string);
    expect(line).toMatchObject({ event: "error-not-recorded", why: "database down", message: "for <email>" });
    log.mockRestore();
  });
});

describe("the page's reporter", () => {
  it("sends each distinct error once, and at most a page's allowance", () => {
    const send = vi.fn();
    const r = new ErrorReporter(send);
    expect(r.report(new Error("a"), "/")).toBe(true);
    expect(r.report(new Error("a"), "/")).toBe(false);
    for (let i = 0; i < MAX_PER_PAGE + 5; i++) {
      r.report(new Error(`e${i}`), "/");
    }
    expect(send).toHaveBeenCalledTimes(MAX_PER_PAGE);
    expect(send.mock.calls[0][0]).toMatchObject({ kind: "Error", message: "a", where: "/" });
  });

  it("listens for uncaught errors and rejections, and stops when asked", () => {
    const listeners = new Map<string, EventListener>();
    const win = {
      addEventListener: (t: string, f: EventListener) => void listeners.set(t, f),
      removeEventListener: (t: string) => void listeners.delete(t),
    };
    const stop = installErrorReporting(win as unknown as Window);
    expect([...listeners.keys()].sort()).toEqual(["error", "unhandledrejection"]);
    stop();
    expect(listeners.size).toBe(0);
  });
});
