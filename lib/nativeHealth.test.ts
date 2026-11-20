import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { HealthNight, HealthState } from "./nativeAlarm";
import { HEALTH_API, hasHealth, importFromHealthConnect, importText } from "./nativeHealth";

const fixture = JSON.parse(readFileSync(join(__dirname, "../tests/fixtures/health-connect/fortnight-nights.json"), "utf8")) as { nights: HealthNight[]; skipped: string[] };
const SLEEP = "android.permission.health.READ_SLEEP";
const HR = "android.permission.health.READ_RESTING_HEART_RATE";

function phone(state: Partial<HealthState>, read: { nights: HealthNight[]; skipped: string[] } = fixture) {
  return {
    healthStatus: vi.fn(async () => ({ status: "available", granted: [SLEEP, HR], allGranted: true, ...state }) as HealthState),
    readSleep: vi.fn(async () => ({ status: "available" as const, ...read })),
  };
}
const server = (data: unknown = { added: 3, updated: 0, unchanged: 0, keptManual: [] }) =>
  vi.fn(async () => ({ ok: true, status: 200, data }));

describe("Health Connect from the app's page", () => {
  it("is there only in an app with plugin API 5", () => {
    expect(HEALTH_API).toBe(5);
    expect(hasHealth({ reason: "browser" })).toBe(false);
    expect(hasHealth({ api: 4 } as never)).toBe(false);
    expect(hasHealth({ api: 5 } as never)).toBe(true);
  });

  it("reads the phone's folded nights and sends them to the sleep log as they are", async () => {
    const p = phone({});
    const post = server();
    const r = await importFromHealthConnect(p, post);
    expect(post).toHaveBeenCalledWith("/api/sleep-logs/import", { nights: fixture.nights });
    expect(r).toEqual({ state: "imported", nights: 3, added: 3, updated: 0, unchanged: 0, keptManual: [], inProgress: 1, heartRate: true });
    expect(importText(r)).toBe("Read 3 nights from Health Connect: 3 added, 0 updated, 0 unchanged. A sleep still being recorded is read next time.");
  });

  it("not installed, needing an update, or not allowed: nothing is read", async () => {
    for (const [state, text] of [
      [{ status: "not_installed" }, "Health Connect isn't on this phone. Install it, then connect."],
      [{ status: "update_required" }, "Health Connect needs an update before SomniAI can read it."],
      [{ granted: [], allGranted: false }, "SomniAI isn't allowed to read sleep from Health Connect yet."],
    ] as const) {
      const p = phone(state as Partial<HealthState>);
      const post = server();
      const r = await importFromHealthConnect(p, post);
      expect(importText(r)).toBe(text);
      expect(p.readSleep).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    }
  });

  it("an empty fortnight sends nothing and says so", async () => {
    const post = server();
    const r = await importFromHealthConnect(phone({}, { nights: [], skipped: [] }), post);
    expect(post).not.toHaveBeenCalled();
    expect(importText(r)).toBe("No sleep recorded in Health Connect in the last two weeks.");
  });

  it("says what was kept, and what wasn't allowed", async () => {
    const r = await importFromHealthConnect(phone({ granted: [SLEEP], allGranted: false }, { ...fixture, skipped: [] }),
      server({ added: 2, updated: 0, unchanged: 0, keptManual: ["2026-11-15"] }));
    expect(importText(r)).toBe("Read 3 nights from Health Connect: 2 added, 0 updated, 0 unchanged. "
      + "1 night you entered yourself was kept as you wrote it. Resting heart rate isn't allowed, so it's left out.");
  });

  it("a failure is reported, never a success", async () => {
    const offline = vi.fn(async () => { throw new Error("offline"); });
    expect(await importFromHealthConnect(phone({}), offline)).toEqual({ state: "failed", reason: "Couldn't reach the server. It's tried again next time the app opens." });
    const refused = vi.fn(async () => ({ ok: false, status: 422, error: "nights[0].date must be a date like 2026-11-15" }));
    expect(importText(await importFromHealthConnect(phone({}), refused))).toBe("Couldn't read Health Connect: nights[0].date must be a date like 2026-11-15");
    const broken = { ...phone({}), readSleep: vi.fn(async () => { throw new Error("Couldn't read Health Connect: SecurityException"); }) };
    expect(await importFromHealthConnect(broken, server())).toMatchObject({ state: "failed" });
  });
});
