import { beforeEach, describe, expect, it } from "vitest";
import { GET as list, POST as record } from "@/app/api/events/route";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { read, request, signInAs, twoUsers } from "./helpers";

let alice: string;
let bob: string;
beforeEach(async () => {
  ({ alice, bob } = await twoUsers());
});

describe("POST /api/events", () => {
  it("rejects an unauthenticated request without writing", async () => {
    expect((await record(request("POST", "/api/events", { type: "motion" }))).status).toBe(401);
    expect(await BehaviorEvent.countDocuments()).toBe(0);
  });

  it.each([
    ["malformed JSON", "{{", 400, /Invalid JSON/],
    ["no events", {}, 422, /No events provided/],
    ["an unknown type", { type: "teleport" }, 422, /Unknown event type: teleport/],
    ["a bad timestamp", { type: "motion", at: "dawn" }, 422, /Invalid event timestamp/],
    ["a null entry in a batch", { events: [{ type: "motion", source: "live" }, null] }, 422, /Each event must be an object/],
    ["a non-numeric value", { type: "motion", value: "lots" }, 422, /value must be a number/],
    ["a batch over 200", { events: Array.from({ length: 201 }, () => ({ type: "motion" })) }, 422, /max 200/],
    ["an event without a source", { type: "motion", value: 1 }, 422, /Each event needs a source: live or simulated/],
    ["an unknown source", { type: "motion", source: "probably" }, 422, /Each event needs a source/],
    ["a batch where one event lacks a source", {
      events: [{ type: "motion", source: "live" }, { type: "motion" }],
    }, 422, /Each event needs a source/],
  ])("rejects %s with a clear error and writes nothing", async (_what, body, status, message) => {
    signInAs(alice);
    const res = await read(await record(request("POST", "/api/events", body)));
    expect(res.status).toBe(status);
    expect(res.body.error).toMatch(message);
    expect(await BehaviorEvent.countDocuments()).toBe(0);
  });

  it("records a single event and a batch for the caller", async () => {
    signInAs(alice);
    const one = await read(await record(request("POST", "/api/events", { type: "screen_on", source: "live", userId: bob })));
    expect(one).toEqual({ status: 201, body: { ok: true, data: { inserted: 1 } } });
    const batch = await read(await record(request("POST", "/api/events", {
      events: [{ type: "motion", value: 0.4 }, { type: "ambient_noise", value: 41, at: "2026-10-21T06:00:00Z" }],
      source: "simulated",
    })));
    expect(batch.body.data.inserted).toBe(2);
    expect(await BehaviorEvent.countDocuments({ userId: alice })).toBe(3);
    expect(await BehaviorEvent.countDocuments({ userId: bob })).toBe(0);
  });

  it("stores each event's source; an event's own source overrides the batch's", async () => {
    signInAs(alice);
    await record(request("POST", "/api/events", {
      source: "simulated",
      events: [{ type: "motion", value: 1 }, { type: "ambient_noise", value: 40, source: "live" }],
    }));
    const stored = await BehaviorEvent.find({ userId: alice }).sort({ type: 1 }).lean<{ type: string; source: string }[]>();
    expect(stored.map((e) => [e.type, e.source])).toEqual([["ambient_noise", "live"], ["motion", "simulated"]]);
  });
});

describe("GET /api/events", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await list(request("GET", "/api/events"))).status).toBe(401);
  });

  it("lists only the caller's events, filtered by type and time", async () => {
    await BehaviorEvent.create([
      { userId: alice, type: "motion", at: new Date("2026-10-21T06:00:00Z") },
      { userId: alice, type: "snooze", at: new Date("2026-10-21T06:05:00Z") },
      { userId: alice, type: "motion", at: new Date("2026-10-19T06:00:00Z") },
      { userId: bob, type: "motion", at: new Date("2026-10-21T06:00:00Z") },
    ]);
    signInAs(alice);
    const all = await read(await list(request("GET", "/api/events")));
    expect(all.body.data.total).toBe(3);
    const recentMotion = await read(await list(request("GET", "/api/events?type=motion&since=2026-10-20T00:00:00Z")));
    expect(recentMotion.body.data.items).toHaveLength(1);
    expect(recentMotion.body.data.items[0].userId).toBe(alice);
  });

  it.each([
    ["an unknown type", "type=teleport", /Unknown event type: teleport/],
    ["an unparseable since", "since=lately", /since must be a date/],
  ])("rejects %s instead of silently returning everything", async (_what, query, message) => {
    signInAs(alice);
    const res = await read(await list(request("GET", `/api/events?${query}`)));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(message);
  });
});
