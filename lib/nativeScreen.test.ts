import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ScreenNightReading } from "./nativeAlarm";
import { bedtimesFrom, hasScreenTime, importScreenTime, SCREEN_API, SCREEN_WHY, screenText } from "./nativeScreen";

const fixture = JSON.parse(readFileSync(join(__dirname, "../tests/fixtures/screen-time/week-nights.json"), "utf8")) as { nights: ScreenNightReading[]; skipped: string[] };

function phone(allowed: boolean, read: { allowed?: boolean; nights: ScreenNightReading[]; skipped: string[] } = fixture) {
  return {
    screenTimeStatus: vi.fn(async () => ({ allowed })),
    readScreenTime: vi.fn(async () => ({ allowed: true, ...read })),
  };
}
const logs = (items: unknown[] = []) => vi.fn(async () => ({ ok: true, data: { items } }));
const server = (data: unknown = { added: 4, updated: 0, unchanged: 0 }) => vi.fn(async () => ({ ok: true, status: 200, data }));

describe("screen time from the app's page", () => {
  it("is there only in an app with plugin API 6", () => {
    expect(SCREEN_API).toBe(6);
    expect(hasScreenTime({ reason: "browser" })).toBe(false);
    expect(hasScreenTime({ api: 5 } as never)).toBe(false);
    expect(hasScreenTime({ api: 6 } as never)).toBe(true);
  });

  it("without Usage access nothing is read, fetched or sent", async () => {
    const p = phone(false);
    const get = logs();
    const post = server();
    const r = await importScreenTime(p, get, post);
    expect(r).toEqual({ state: "not_allowed" });
    expect(p.readScreenTime).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(screenText(r)).toBe("Usage access is off, so screen time isn't measured. Predictions leave it out.");
  });

  it("access turned off after nights were measured: says those still count, not that predictions leave it out", () => {
    // Found on the phone 2026-11-14: the old wording claimed predictions left it out while the row still showed 114 min.
    expect(screenText({ state: "not_allowed" }, true))
      .toBe("Usage access is off, so no more screen time is measured. The nights already measured count until they're a week old.");
  });

  it("access turned off between the check and the read: still nothing sent", async () => {
    const post = server();
    const r = await importScreenTime(phone(true, { allowed: false, nights: [], skipped: [] }), logs(), post);
    expect(r).toEqual({ state: "not_allowed" });
    expect(post).not.toHaveBeenCalled();
  });

  it("passes the sleep log's bedtimes, and sends the phone's nights as they are", async () => {
    const p = phone(true);
    const post = server();
    const get = logs([
      { date: "2026-11-15", sleepTime: "2026-11-14T16:30:00.000Z", source: "health_connect" },
      { date: "2026-11-14", sleepTime: "2026-11-13T18:00:00.000Z", source: "simulated" },
      { date: "2026-11-13" },
    ]);
    const r = await importScreenTime(p, get, post);
    expect(get).toHaveBeenCalledWith("/api/sleep-logs?limit=14");
    expect(p.readScreenTime).toHaveBeenCalledWith({ bedtimes: { "2026-11-15": "2026-11-14T16:30:00.000Z" } });
    expect(post).toHaveBeenCalledWith("/api/screen-time", { nights: fixture.nights });
    expect(r).toEqual({ state: "measured", nights: 4, added: 4, updated: 0, unchanged: 0, inProgress: false });
    expect(screenText(r)).toBe("Measured 4 nights: 4 added, 0 updated, 0 unchanged.");
  });

  it("no sleep log to hand: the phone reads bed itself", async () => {
    const p = phone(true);
    await importScreenTime(p, vi.fn(async () => { throw new Error("offline"); }), server());
    expect(p.readScreenTime).toHaveBeenCalledWith({ bedtimes: {} });
  });

  it("nothing measurable sends nothing, and says why when last night isn't over", async () => {
    const post = server();
    const r = await importScreenTime(phone(true, { nights: [], skipped: ["2026-11-16: in_progress"] }), logs(), post);
    expect(post).not.toHaveBeenCalled();
    expect(screenText(r)).toBe("No night in the last week could be measured yet. Last night is measured once you're up.");
  });

  it("a failure is reported, never a success", async () => {
    const offline = vi.fn(async () => { throw new Error("offline"); });
    expect(await importScreenTime(phone(true), logs(), offline)).toEqual({ state: "failed", reason: "Couldn't reach the server. It's tried again next time the app opens." });
    const refused = vi.fn(async () => ({ ok: false, status: 422, error: "nights[0].minutes must be whole minutes, no more than the window" }));
    expect(screenText(await importScreenTime(phone(true), logs(), refused))).toBe("Couldn't measure screen time: nights[0].minutes must be whole minutes, no more than the window");
    const broken = { ...phone(true), readScreenTime: vi.fn(async () => { throw new Error("Couldn't read screen time: SecurityException"); }) };
    expect(await importScreenTime(broken, logs(), server())).toMatchObject({ state: "failed" });
  });

  it("bedtimes leave out simulated and unreadable nights", () => {
    expect(bedtimesFrom([{ date: "2026-11-15", sleepTime: "2026-11-14T22:00:00+05:30" }, { date: "2026-11-14", sleepTime: "late" }, null, "x"]))
      .toEqual({ "2026-11-15": "2026-11-14T16:30:00.000Z" });
    expect(bedtimesFrom(undefined)).toEqual({});
  });

  it("says why it's asked for before Settings opens: what is measured, what never leaves the phone, how to stop", () => {
    const text = SCREEN_WHY.join(" ");
    expect(text).toMatch(/3 hours before you went to bed/);
    expect(text).toMatch(/Only that number leaves your phone: never which apps/);
    expect(text).toMatch(/turn it off there at any time: then nothing more is measured, and nights already measured stop counting once they're a week old/);
    expect(text).toMatch(/Without it, predictions simply leave screen time out/);
  });
});
