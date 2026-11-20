import { beforeEach, describe, expect, it } from "vitest";
import { GET as list, POST as upsert } from "@/app/api/sleep-logs/route";
import { SleepLog } from "@/models/SleepLog";
import { read, request, signInAs, twoUsers } from "./helpers";

let alice: string;
let bob: string;
beforeEach(async () => {
  ({ alice, bob } = await twoUsers());
});

describe("GET /api/sleep-logs", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await list(request("GET", "/api/sleep-logs"))).status).toBe(401);
  });

  it("lists only the caller's nights, newest first", async () => {
    await SleepLog.create({ userId: alice, date: "2026-10-20", durationHours: 7 });
    await SleepLog.create({ userId: alice, date: "2026-10-21", durationHours: 6 });
    await SleepLog.create({ userId: bob, date: "2026-10-21", durationHours: 9 });
    signInAs(alice);
    const res = await read(await list(request("GET", "/api/sleep-logs")));
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((l: { date: string }) => l.date)).toEqual(["2026-10-21", "2026-10-20"]);
  });
});

describe("POST /api/sleep-logs", () => {
  it("rejects an unauthenticated request without writing", async () => {
    expect((await upsert(request("POST", "/api/sleep-logs", { date: "2026-10-21" }))).status).toBe(401);
    expect(await SleepLog.countDocuments()).toBe(0);
  });

  it.each([
    ["malformed JSON", "nope", 400, /Invalid JSON/],
    ["a missing date", { durationHours: 7 }, 422, /date is required/],
    ["a date that is not a date", { date: "yesterday" }, 422, /date must be a date like 2026-10-22/],
    ["an unparseable bedtime", { date: "2026-10-21", sleepTime: "late" }, 422, /sleepTime is not a valid date/],
    ["waking before falling asleep", {
      date: "2026-10-21", sleepTime: "2026-10-21T07:00:00Z", wakeTime: "2026-10-20T23:00:00Z",
    }, 422, /wakeTime must be after sleepTime/],
    ["a negative duration", { date: "2026-10-21", durationHours: -3 }, 422, /durationHours must be a number from 0 to 24/],
    ["a duration over a day", { date: "2026-10-21", durationHours: 30 }, 422, /durationHours must be a number from 0 to 24/],
    ["a negative snooze count", { date: "2026-10-21", snoozeCount: -1 }, 422, /snoozeCount must be a non-negative whole number/],
    ["an unknown source", { date: "2026-10-21", source: "dreams" }, 422, /Source is not one of the allowed values/],
  ])("rejects %s with a clear error", async (_what, body, status, message) => {
    signInAs(alice);
    const res = await read(await upsert(request("POST", "/api/sleep-logs", body)));
    expect(res.status).toBe(status);
    expect(res.body.error).toMatch(message);
    expect(await SleepLog.countDocuments()).toBe(0);
  });

  it("derives the duration and a quality score, and updates the same night in place", async () => {
    signInAs(alice);
    const first = await read(await upsert(request("POST", "/api/sleep-logs", {
      date: "2026-10-21", sleepTime: "2026-10-20T23:00:00Z", wakeTime: "2026-10-21T06:30:00Z", snoozeCount: 1,
    })));
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ userId: alice, durationHours: 7.5, snoozeCount: 1, source: "manual" });
    expect(typeof first.body.data.qualityScore).toBe("number");

    await upsert(request("POST", "/api/sleep-logs", { date: "2026-10-21", durationHours: 8 }));
    expect(await SleepLog.countDocuments({ userId: alice })).toBe(1);
    expect((await SleepLog.findOne({ userId: alice }).lean<{ durationHours: number }>())?.durationHours).toBe(8);
  });

  it("stores a simulator night as simulated, so it never reaches a model", async () => {
    signInAs(alice);
    const res = await read(await upsert(request("POST", "/api/sleep-logs", { date: "2026-10-21", durationHours: 5, source: "simulated" })));
    expect(res.status).toBe(201);
    expect(res.body.data.source).toBe("simulated");
  });

  it("cannot overwrite another user's night, even for the same date or with their userId", async () => {
    await SleepLog.create({ userId: bob, date: "2026-10-21", durationHours: 9 });
    signInAs(alice);
    const res = await read(await upsert(request("POST", "/api/sleep-logs", { date: "2026-10-21", durationHours: 4, userId: bob })));
    expect(res.body.data.userId).toBe(alice);
    expect((await SleepLog.findOne({ userId: bob }).lean<{ durationHours: number }>())?.durationHours).toBe(9);
  });
});
