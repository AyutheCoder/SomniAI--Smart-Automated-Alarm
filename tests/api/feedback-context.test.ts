import { beforeEach, describe, expect, it } from "vitest";
import { GET as listFeedback, POST as postFeedback } from "@/app/api/feedback/route";
import { GET as listContext, POST as postContext } from "@/app/api/context/route";
import { Alarm } from "@/models/Alarm";
import { ContextSnapshot } from "@/models/ContextSnapshot";
import { ModelFeedback } from "@/models/ModelFeedback";
import { RlPolicy } from "@/models/RlPolicy";
import { read, request, signInAs, twoUsers } from "./helpers";

let alice: string;
let bob: string;
beforeEach(async () => {
  ({ alice, bob } = await twoUsers());
});

describe("POST /api/feedback", () => {
  it("rejects an unauthenticated request without writing", async () => {
    expect((await postFeedback(request("POST", "/api/feedback", { outcome: "success" }))).status).toBe(401);
    expect(await ModelFeedback.countDocuments()).toBe(0);
  });

  it.each([
    ["no outcome (it used to be recorded as a success)", {}, /outcome must be one of success, snooze, missed/],
    ["an unknown outcome", { outcome: "great" }, /outcome must be one of/],
    ["a negative snooze count", { outcome: "snooze", snoozes: -1 }, /snoozes must be a non-negative whole number/],
    ["a non-numeric time to wake", { outcome: "success", ttwMin: "soon" }, /ttwMin must be a non-negative number/],
    ["satisfaction outside -1..1", { outcome: "success", satisfaction: 5 }, /satisfaction must be a number from -1 to 1/],
    ["a non-object context", { outcome: "success", context: "weekend" }, /context must be an object/],
  ])("rejects %s", async (_what, body, message) => {
    signInAs(alice);
    const res = await read(await postFeedback(request("POST", "/api/feedback", body)));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(message);
    expect(await ModelFeedback.countDocuments()).toBe(0);
  });

  it("records feedback and updates the caller's policy with the local learner", async () => {
    const alarm = await Alarm.create({ userId: alice, label: "x", scheduledTime: new Date() });
    signInAs(alice);
    const res = await read(await postFeedback(request("POST", "/api/feedback", {
      outcome: "snooze", snoozes: 2, alarmId: String(alarm._id), context: { isWeekend: false },
    })));
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe("fallback");
    expect(typeof res.body.data.reward).toBe("number");
    expect(await ModelFeedback.countDocuments({ userId: alice, outcome: "snooze" })).toBe(1);
    expect(await RlPolicy.countDocuments({ userId: alice })).toBe(1);
  });

  it("will not attach feedback to another user's alarm", async () => {
    const bobsAlarm = await Alarm.create({ userId: bob, label: "x", scheduledTime: new Date() });
    signInAs(alice);
    const res = await read(await postFeedback(request("POST", "/api/feedback", { outcome: "missed", alarmId: String(bobsAlarm._id) })));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/alarm was not found/);
    expect(await ModelFeedback.countDocuments()).toBe(0);
  });
});

describe("GET /api/feedback", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await listFeedback(request("GET", "/api/feedback"))).status).toBe(401);
  });

  it("shows only the caller's history and policy", async () => {
    await ModelFeedback.create({ userId: bob, outcome: "missed", reward: -1 });
    await RlPolicy.create({ userId: bob, updates: 9, meanReward: -0.5 });
    signInAs(alice);
    const res = await read(await listFeedback(request("GET", "/api/feedback")));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ history: [], policy: { updates: 0, meanReward: 0, summary: null } });
  });
});

describe("POST /api/context", () => {
  it("rejects an unauthenticated request without writing", async () => {
    expect((await postContext(request("POST", "/api/context", { simulate: true }))).status).toBe(401);
    expect(await ContextSnapshot.countDocuments()).toBe(0);
  });

  it.each([
    ["a latitude out of range", { lat: 123, lon: 10 }, /lat must be a number from -90 to 90/],
    ["a latitude without a longitude", { lat: 12 }, /lat and lon must be given together/],
    ["an override that is not an object", { override: "sunny" }, /override must be an object/],
    ["an override calendar entry without a valid start", {
      override: { calendar: [{ title: "Exam", start: "whenever" }] },
    }, /Each calendar entry needs a title and a valid start/],
  ])("rejects %s", async (_what, body, message) => {
    signInAs(alice);
    const res = await read(await postContext(request("POST", "/api/context", body)));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(message);
    expect(await ContextSnapshot.countDocuments()).toBe(0);
  });

  it("stores a simulated snapshot for the caller, labelled simulated", async () => {
    signInAs(alice);
    const res = await read(await postContext(request("POST", "/api/context", { simulate: true })));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ userId: alice, source: "simulated" });
  });

  it("never labels simulated data live, even when coordinates are sent", async () => {
    signInAs(alice);
    // simulate:true makes buildContextData simulate everything; this used to be stored as "live".
    const res = await read(await postContext(request("POST", "/api/context", { simulate: true, lat: 28.6, lon: 77.2 })));
    expect(res.body.data.source).toBe("simulated");
  });

  it("labels data the user supplied as manual", async () => {
    signInAs(alice);
    const res = await read(await postContext(request("POST", "/api/context", {
      override: { weather: { tempC: 21, condition: "Clear" }, calendar: [{ title: "Exam", start: "2026-11-02T09:00:00Z" }] },
    })));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ source: "manual", weather: { tempC: 21 } });
  });
});

describe("GET /api/context", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await listContext(request("GET", "/api/context"))).status).toBe(401);
  });

  it("lists only the caller's snapshots", async () => {
    await ContextSnapshot.create({ userId: alice, source: "manual" });
    await ContextSnapshot.create({ userId: bob, source: "manual" });
    signInAs(alice);
    const res = await read(await listContext(request("GET", "/api/context?limit=5")));
    expect(res.body.data.items.map((s: { userId: string }) => s.userId)).toEqual([alice]);
  });
});
