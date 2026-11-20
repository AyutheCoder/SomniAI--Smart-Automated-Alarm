import { describe, expect, it } from "vitest";
import { summarise } from "./errors.mjs";

describe("npm run errors", () => {
  it("lists each kind of error with its count, place and when, newest first as given", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    const lines = summarise([
      { source: "browser", kind: "TypeError", message: "x is undefined", where: "/", count: 3, lastAt: new Date("2026-11-16T11:50:00Z"), firstAt: new Date("2026-11-14T12:00:00Z"), stack: "at a (b.ts:1:1)" },
      { source: "ai-brain", kind: "ValueError", message: "bad row", where: "/plan/wake", count: 1, lastAt: new Date("2026-11-16T09:00:00Z"), firstAt: new Date("2026-11-16T09:00:00Z") },
    ], now, { stack: true });
    expect(lines[0]).toBe("2 kind(s) of error, 4 time(s) in all:");
    expect(lines[2]).toBe("    3x  browser  TypeError: x is undefined");
    expect(lines[3]).toBe("        /, last 10 min ago, first 2 days ago");
    expect(lines[4]).toBe("          at a (b.ts:1:1)");
    expect(lines[6]).toBe("        /plan/wake, last 3 h ago, first 3 h ago");
    expect(summarise([], now)).toEqual(["No errors recorded in this period."]);
  });
});
