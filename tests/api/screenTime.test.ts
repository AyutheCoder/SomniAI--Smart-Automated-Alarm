import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as sendScreenTime } from "@/app/api/screen-time/route";
import { GET as context } from "@/app/api/context/route";
import { buildUserSignals } from "@/lib/aiFeatures";
import type { ScreenNightInput } from "@/lib/screenTime";
import { ScreenNight } from "@/models/ScreenNight";
import { makeUser, read, request, signInAs } from "./helpers";

// What the phone sends for the usage-event fixture (ScreenNightsTest checks it's the phone's real output).
const fixture = JSON.parse(readFileSync(join(__dirname, "../fixtures/screen-time/week-nights.json"), "utf8")) as { nights: ScreenNightInput[] };
const nights = () => structuredClone(fixture.nights);

const send = async (body: unknown) => read(await sendScreenTime(request("POST", "/api/screen-time", body)));
const sources = async () => (await read(await context(request("GET", "/api/context")))).body.data.sources;

describe("screen time before bed", () => {
  beforeEach(() => {
    // The fixture's "now": 10:00 on the 16th in India. Only Date is faked.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T04:30:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("each night is stored as that wake date's minutes, and nothing about apps", async () => {
    const me = await makeUser();
    signInAs(me);
    const r = await send({ nights: nights() });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ added: 4, updated: 0, unchanged: 0 });
    const stored = await ScreenNight.find({ userId: me }).sort({ date: 1 }).lean<Record<string, unknown>[]>();
    expect(stored.map((n) => [n.date, n.minutes, n.windowMinutes, n.bedtimeFrom])).toEqual([
      ["2026-11-13", 120, 180, "phone"],
      ["2026-11-14", 135, 180, "phone"],
      ["2026-11-15", 60, 180, "sleep_log"],
      ["2026-11-16", 5, 180, "phone"],
    ]);
    expect(new Date(stored[0].bedtime as Date).toISOString()).toBe("2026-11-12T17:10:00.000Z");
    expect(Object.keys(stored[0]).sort()).toEqual(["__v", "_id", "bedtime", "bedtimeFrom", "date", "minutes", "updatedAt", "userId", "windowMinutes"]);
  });

  it("measuring the same week again changes nothing; a night measured differently is updated", async () => {
    const me = await makeUser();
    signInAs(me);
    await send({ nights: nights() });
    expect((await send({ nights: nights() })).body.data).toEqual({ added: 0, updated: 0, unchanged: 4 });
    const later = nights();
    // The 16th's bed now comes from the sleep log, which Health Connect filled in.
    later[3] = { ...later[3], bedtime: "2026-11-15T17:00:00Z", minutes: 12, bedtimeFrom: "sleep_log" };
    expect((await send({ nights: later })).body.data).toEqual({ added: 0, updated: 1, unchanged: 3 });
    expect(await ScreenNight.findOne({ userId: me, date: "2026-11-16" }).lean()).toMatchObject({ minutes: 12, bedtimeFrom: "sleep_log" });
  });

  it("the last week's mean is the predictions' screen_minutes_before_bed, and the data sources say so", async () => {
    const me = await makeUser();
    signInAs(me);
    await send({ nights: nights() });
    const { features } = await buildUserSignals(me);
    // (120 + 135 + 60 + 5) / 4 = 80.
    expect(features.screen_minutes_before_bed).toBe(80);
    expect((await sources()).screenTime).toEqual({ source: "live", detail: "80 min in the 3 hours before bed, on average over the last 4 nights" });
  });

  it("not measured, not sent: without Usage access the feature is left out, never a default", async () => {
    const me = await makeUser();
    signInAs(me);
    const { features } = await buildUserSignals(me);
    expect(features).not.toHaveProperty("screen_minutes_before_bed");
    expect((await sources()).screenTime).toEqual({ source: "missing", detail: "Not measured in the last week" });
    // Nothing measured is an empty import, not an error, and still nothing to use.
    expect((await send({ nights: [] })).body.data).toEqual({ added: 0, updated: 0, unchanged: 0 });
    expect((await buildUserSignals(me)).features).not.toHaveProperty("screen_minutes_before_bed");
  });

  it("only the last week counts, and only nights measured over the model's 3 hours", async () => {
    const me = await makeUser();
    signInAs(me);
    await send({
      nights: [
        { date: "2026-11-01", bedtime: "2026-10-31T17:00:00Z", minutes: 170, windowMinutes: 180, bedtimeFrom: "phone" },
        { date: "2026-11-14", bedtime: "2026-11-13T17:00:00Z", minutes: 100, windowMinutes: 120, bedtimeFrom: "phone" },
      ],
    });
    expect((await buildUserSignals(me)).features).not.toHaveProperty("screen_minutes_before_bed");
    await send({ nights: [{ date: "2026-11-15", bedtime: "2026-11-14T17:00:00Z", minutes: 30, windowMinutes: 180, bedtimeFrom: "phone" }] });
    expect((await buildUserSignals(me)).features.screen_minutes_before_bed).toBe(30);
    expect((await sources()).screenTime.detail).toBe("30 min in the 3 hours before bed, on average over the last night");
  });

  it("only the signed-in user's, and only well-formed nights", async () => {
    signInAs(null);
    expect((await send({ nights: nights() })).status).toBe(401);
    const me = await makeUser();
    const other = await makeUser();
    signInAs(other);
    await send({ nights: nights() });
    signInAs(me);
    expect((await buildUserSignals(me)).features).not.toHaveProperty("screen_minutes_before_bed");
    const n = () => nights()[0];
    for (const bad of [
      { nights: "x" },
      { nights: [{ ...n(), date: "13/11/2026" }] },
      { nights: [n(), { ...n() }] },
      { nights: [{ ...n(), bedtime: "late" }] },
      { nights: [{ ...n(), minutes: 181 }] },
      { nights: [{ ...n(), minutes: -1 }] },
      { nights: [{ ...n(), minutes: 12.5 }] },
      { nights: [{ ...n(), windowMinutes: 0 }] },
      { nights: [{ ...n(), bedtimeFrom: "guess" }] },
      { nights: Array.from({ length: 32 }, (_, i) => ({ ...n(), date: `2026-10-${String(i % 28 + 1).padStart(2, "0")}` })) },
    ]) {
      expect((await send(bad)).status).toBe(422);
    }
    expect(await ScreenNight.countDocuments({ userId: me })).toBe(0);
  });
});
