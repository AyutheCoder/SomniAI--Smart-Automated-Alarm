import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POST as importSleep } from "@/app/api/sleep-logs/import/route";
import { POST as logSleep } from "@/app/api/sleep-logs/route";
import { GET as context } from "@/app/api/context/route";
import { buildUserSignals } from "@/lib/aiFeatures";
import type { ImportedNight } from "@/lib/sleepImport";
import { SleepLog } from "@/models/SleepLog";
import { makeUser, read, request, signInAs } from "./helpers";

// What the phone sends for the Health Connect fixture (HealthNightsTest checks it's the phone's real output).
const fixture = JSON.parse(readFileSync(join(__dirname, "../fixtures/health-connect/fortnight-nights.json"), "utf8")) as { nights: ImportedNight[] };
const nights = () => structuredClone(fixture.nights);

const send = async (body: unknown) => read(await importSleep(request("POST", "/api/sleep-logs/import", body)));
const logs = (userId: string) => SleepLog.find({ userId }).sort({ date: 1 }).lean<Record<string, unknown>[]>();

describe("nights from Health Connect", () => {
  it("each night becomes that date's sleep log, with what it was made of", async () => {
    const me = await makeUser();
    signInAs(me);
    const r = await send({ nights: nights() });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ added: 3, updated: 0, unchanged: 0, keptManual: [] });
    const stored = await logs(me);
    expect(stored.map((l) => [l.date, l.durationHours, l.inBedHours, l.stagesRecorded, l.sessions, l.restingHr ?? null, l.source])).toEqual([
      ["2026-11-14", 7.5, 8, true, 1, 58, "health_connect"],
      // The split night: the longest session's 4 h 30, not the 7 h of all three.
      ["2026-11-15", 4.5, 4.5, false, 3, 62, "health_connect"],
      // No resting heart rate that date: none stored.
      ["2026-11-16", 7.17, 7.5, true, 2, null, "health_connect"],
    ]);
    expect(stored[1]).toMatchObject({ externalId: "phone-night-15-second", origin: "com.example.sleepapp" });
    expect(new Date(stored[0].sleepTime as Date).toISOString()).toBe("2026-11-13T17:30:00.000Z");
    expect(new Date(stored[0].wakeTime as Date).toISOString()).toBe("2026-11-14T01:30:00.000Z");
    expect(typeof stored[0].qualityScore).toBe("number");
  });

  it("reading the same fortnight again changes nothing; a watch that synced late updates the night", async () => {
    const me = await makeUser();
    signInAs(me);
    await send({ nights: nights() });
    expect((await send({ nights: nights() })).body.data).toEqual({ added: 0, updated: 0, unchanged: 3, keptManual: [] });

    const later = nights();
    // The 16th: the watch's fuller record now has a resting heart rate too.
    later[2] = { ...later[2], asleepMinutes: 445, restingHr: 57 };
    // The 15th: the heart rate reading was removed in Health Connect.
    delete later[1].restingHr;
    expect((await send({ nights: later })).body.data).toEqual({ added: 0, updated: 2, unchanged: 1, keptManual: [] });
    const stored = await logs(me);
    expect(stored[1].restingHr).toBeUndefined();
    expect(stored[2]).toMatchObject({ durationHours: 7.42, restingHr: 57 });
  });

  it("a night entered by hand is kept as the user wrote it", async () => {
    const me = await makeUser();
    signInAs(me);
    await logSleep(request("POST", "/api/sleep-logs", { date: "2026-11-15", sleepTime: "2026-11-14T17:00:00Z", source: "manual" }));
    const r = await send({ nights: nights() });
    expect(r.body.data).toEqual({ added: 2, updated: 0, unchanged: 0, keptManual: ["2026-11-15"] });
    expect((await SleepLog.findOne({ userId: me, date: "2026-11-15" }).lean<{ source: string; sessions?: number }>())).toMatchObject({ source: "manual" });
  });

  it("nothing recorded is an empty import, not an error", async () => {
    const me = await makeUser();
    signInAs(me);
    expect((await send({ nights: [] })).body.data).toEqual({ added: 0, updated: 0, unchanged: 0, keptManual: [] });
    expect(await SleepLog.countDocuments({ userId: me })).toBe(0);
  });

  it("the nights feed the data sources and the predictions' resting heart rate", async () => {
    const me = await makeUser();
    signInAs(me);
    await send({ nights: nights() });
    const sources = (await read(await context(request("GET", "/api/context")))).body.data.sources;
    expect(sources.sleepLogs).toEqual({ source: "live", detail: "3 nights logged, 3 from Health Connect" });
    const { features } = await buildUserSignals(me);
    // The latest night with a reading is the 15th's (62); the 16th had none.
    expect(features.resting_hr).toBe(62);
    expect(features.bedtime_hour).toBeDefined();
  });

  it("only the signed-in user's, and only well-formed nights", async () => {
    signInAs(null);
    expect((await send({ nights: nights() })).status).toBe(401);
    const me = await makeUser();
    signInAs(me);
    const n = () => nights()[0];
    for (const bad of [
      { nights: "x" },
      { nights: [{ ...n(), date: "14/11/2026" }] },
      { nights: [n(), { ...n(), sessionId: "again" }] },
      { nights: [{ ...n(), wakeTime: n().sleepTime }] },
      { nights: [{ ...n(), asleepMinutes: 500, inBedMinutes: 480 }] },
      { nights: [{ ...n(), asleepMinutes: 1.5 }] },
      { nights: [{ ...n(), restingHr: 400 }] },
      { nights: [{ ...n(), sessions: 0 }] },
      { nights: [{ ...n(), sessionId: "" }] },
      { nights: Array.from({ length: 32 }, (_, i) => ({ ...n(), date: `2026-10-${String(i % 28 + 1).padStart(2, "0")}` })) },
    ]) {
      expect((await send(bad)).status).toBe(422);
    }
    expect(await SleepLog.countDocuments({})).toBe(0);
  });
});
