import { describe, expect, it } from "vitest";
import { localDate, nightFindings, nightWindow, parseAccounts, renderNight, SYNC_GRACE_MS } from "./dogfood.mjs";

const TZ = "Asia/Kolkata";
const at = (iso: string) => new Date(iso);
const report = (alarmId: string, ringAt: string, extra: Record<string, unknown> = {}) => ({
  alarmId, label: "Work", ringAt: at(ringAt), outcome: "woke", level: 4, levelLabel: "Wake challenge", rang: true,
  verification: { required: true, passed: true, seconds: 34, steps: 3, score: 95 }, ...extra,
});
const fire = (alarmId: string, when: string) => ({ type: "alarm_fire", meta: { alarmId }, at: at(when) });
const NOW = at("2026-11-21T06:00:00Z"); // 11:30 in India, the morning after

describe("the dogfooding night report (8.1)", () => {
  it("reads testers as label=address, and refuses anything else", () => {
    expect(parseAccounts("A=one@example.com, B=Two@Example.com")).toEqual([
      { label: "A", email: "one@example.com" }, { label: "B", email: "two@example.com" },
    ]);
    expect(() => parseAccounts("")).toThrow(/DOGFOOD_ACCOUNTS/);
    expect(() => parseAccounts("A one@example.com")).toThrow(/label=address/);
  });

  it("runs a night from noon to noon in the testers' time zone", () => {
    const w = nightWindow("2026-11-21", TZ);
    expect(w.start.toISOString()).toBe("2026-11-20T06:30:00.000Z"); // 12:00 IST the day before
    expect(w.end.toISOString()).toBe("2026-11-21T06:30:00.000Z");
    expect(localDate(at("2026-11-20T20:00:00Z"), TZ)).toBe("2026-11-21");
    expect(() => nightWindow("21/11/2026", TZ)).toThrow(/--night/);
  });

  it("reports a ring that fired on time and was stopped by the check, without its label", () => {
    const { rings, flags } = nightFindings({
      reports: [report("aaaa1111", "2026-11-21T01:30:00Z")],
      fires: [fire("aaaa1111", "2026-11-21T01:30:00.050Z")],
      alarms: [], now: NOW, tz: TZ,
    });
    expect(rings).toEqual(["07:00 #1111, woke, level 4 (Wake challenge), check passed in 34 s, score 95, on time"]);
    expect(flags).toEqual([]);
    expect(rings.join()).not.toContain("Work");
  });

  it("flags a late fire and a ring nobody stopped as misses", () => {
    const { flags } = nightFindings({
      reports: [report("aaaa1111", "2026-11-21T01:30:00Z"), report("bbbb2222", "2026-11-21T02:00:00Z", { outcome: "missed", level: 5 })],
      fires: [fire("aaaa1111", "2026-11-21T01:32:30Z"), fire("bbbb2222", "2026-11-21T02:00:00Z")],
      alarms: [], now: NOW, tz: TZ,
    });
    expect(flags).toEqual([
      "MISS: 07:00 #1111 fired 150 s late",
      "MISS: 07:30 #2222 rang and nobody stopped it",
    ]);
  });

  it("flags an alarm that was due with nothing on record: the silent miss", () => {
    const { rings, flags } = nightFindings({
      reports: [], fires: [], now: NOW, tz: TZ,
      alarms: [{ _id: "cccc3333", label: "Flight", scheduledTime: at("2026-11-21T01:00:00Z") }],
    });
    expect(rings).toEqual(["06:30 #3333, NO RING ON RECORD"]);
    expect(flags[0]).toMatch(/^MISS\?: 06:30 #3333 was due and nothing was recorded/);
  });

  it("waits for a phone to sync before calling an alarm missing", () => {
    const due = new Date(NOW.getTime() - SYNC_GRACE_MS + 60_000);
    const { flags } = nightFindings({ reports: [], fires: [], now: NOW, tz: TZ, alarms: [{ _id: "dddd4444", scheduledTime: due }] });
    expect(flags).toEqual([]);
  });

  it("flags a ring whose ending never reached the server", () => {
    const { flags } = nightFindings({ reports: [], fires: [fire("eeee5555", "2026-11-21T01:00:00Z")], alarms: [], now: NOW, tz: TZ });
    expect(flags[0]).toMatch(/^CHECK: 06:30 #5555 rang but how it ended never reached the server/);
  });

  it("shows labels only when asked, for reading locally", () => {
    const { rings } = nightFindings({ reports: [report("aaaa1111", "2026-11-21T01:30:00Z")], fires: [], alarms: [], now: NOW, tz: TZ, labels: true });
    expect(rings[0]).toMatch(/^07:00 Work #1111/);
  });

  it("renders Markdown for the log, and says when nothing was flagged", () => {
    const lines = renderNight("2026-11-21", [{ label: "A", rings: ["07:00 #1111, woke"], flags: [] }, { label: "B", rings: [], flags: [] }]);
    expect(lines[0]).toBe("### Night ending 2026-11-21");
    expect(lines).toContain("- 07:00 #1111, woke");
    expect(lines).toContain("**Tester B:** no alarm was due.");
    expect(lines.at(-1)).toMatch(/Nothing flagged/);
  });
});
