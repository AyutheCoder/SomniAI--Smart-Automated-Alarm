import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listFeedback, POST as postFeedback } from "@/app/api/feedback/route";
import { GET as listContext, POST as postContext } from "@/app/api/context/route";
import { Alarm } from "@/models/Alarm";
import { ContextSnapshot } from "@/models/ContextSnapshot";
import { ModelFeedback } from "@/models/ModelFeedback";
import { RlPolicy } from "@/models/RlPolicy";
import { SleepLog } from "@/models/SleepLog";
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
    ["simulate as text", { simulate: "yes" }, /simulate must be true or false/],
    // Removed in 1.2: caller-typed values are neither live nor simulated.
    ["an override of any kind", { override: { weather: { tempC: 21, condition: "Clear" } } }, /override is no longer accepted/],
  ])("rejects %s", async (_what, body, message) => {
    signInAs(alice);
    const res = await read(await postContext(request("POST", "/api/context", body)));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(message);
    expect(await ContextSnapshot.countDocuments()).toBe(0);
  });

  it("stores nothing made up by default: every group missing", async () => {
    signInAs(alice);
    const res = await read(await postContext(request("POST", "/api/context", {})));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ userId: alice, sources: { weather: "missing", calendar: "missing", wearable: "missing" } });
    expect(res.body.data.wearable).toBeUndefined();
    expect(res.body.data.source).toBeUndefined();
  });

  it("labels each simulated group simulated", async () => {
    signInAs(alice);
    const res = await read(await postContext(request("POST", "/api/context", { simulate: true })));
    expect(res.body.data.sources).toEqual({ weather: "simulated", calendar: "simulated", wearable: "simulated" });
  });

  describe("with a location", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("fetches live weather by default and labels only it live", async () => {
      const weather = vi.fn<(url: string) => Promise<Response>>(async () =>
        new Response(JSON.stringify({ current: { temperature_2m: 24.5, weather_code: 2 } })));
      vi.stubGlobal("fetch", weather);
      signInAs(alice);
      const res = await read(await postContext(request("POST", "/api/context", { lat: 28.6, lon: 77.2 })));
      expect(res.body.data).toMatchObject({
        weather: { tempC: 24.5, condition: "Partly cloudy" },
        sources: { weather: "live", calendar: "missing", wearable: "missing" },
      });
      expect(String(weather.mock.calls[0][0])).toMatch(/latitude=28\.6&longitude=77\.2/);
    });

    it("stores weather as missing when the weather service fails, never as simulated", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 502 })));
      signInAs(alice);
      const res = await read(await postContext(request("POST", "/api/context", { lat: 28.6, lon: 77.2, simulate: true })));
      expect(res.body.data.sources.weather).toBe("missing");
      expect(res.body.data.weather).toBeUndefined();
    });
  });
});

describe("GET /api/context", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await listContext(request("GET", "/api/context"))).status).toBe(401);
  });

  it("lists only the caller's snapshots", async () => {
    await ContextSnapshot.create({ userId: alice, sources: { weather: "missing", calendar: "missing", wearable: "missing" } });
    await ContextSnapshot.create({ userId: bob, sources: { weather: "missing", calendar: "missing", wearable: "missing" } });
    signInAs(alice);
    const res = await read(await listContext(request("GET", "/api/context?limit=5")));
    expect(res.body.data.items.map((s: { userId: string }) => s.userId)).toEqual([alice]);
  });

  it("says which sources are connected, from the caller's data only", async () => {
    await ContextSnapshot.create({ userId: bob, sources: { weather: "live", calendar: "live", wearable: "live" } });
    await SleepLog.create({ userId: bob, date: "2026-10-20", durationHours: 7 });
    signInAs(alice);
    const none = await read(await listContext(request("GET", "/api/context")));
    expect(none.body.data.sources).toEqual({
      sleepLogs: { source: "missing", detail: "No nights logged yet" },
      weather: { source: "missing", detail: "Not connected: allow location for live weather" },
      calendar: { source: "missing", detail: "Not connected" },
      wearable: { source: "missing", detail: "Not connected" },
    });
  });

  it("shows live weather as connected, and simulated groups and nights as simulated and unused", async () => {
    await ContextSnapshot.create({ userId: alice, sources: { weather: "live", calendar: "simulated", wearable: "simulated" } });
    await SleepLog.create({ userId: alice, date: "2026-10-20", durationHours: 7, source: "manual" });
    await SleepLog.create({ userId: alice, date: "2026-10-19", durationHours: 3, source: "simulated" });
    signInAs(alice);
    const { body } = await read(await listContext(request("GET", "/api/context")));
    expect(body.data.sources).toEqual({
      sleepLogs: { source: "live", detail: "1 night logged; 1 simulated night not used" },
      weather: { source: "live", detail: "Live, from your location" },
      calendar: { source: "simulated", detail: "Simulated: not used for predictions" },
      wearable: { source: "simulated", detail: "Simulated: not used for predictions" },
    });
  });

  it("treats a snapshot from before sources existed as connecting nothing", async () => {
    await ContextSnapshot.create({ userId: alice, source: "live", wearable: { restingHr: 60 } });
    signInAs(alice);
    const { body } = await read(await listContext(request("GET", "/api/context")));
    expect(body.data.sources.wearable.source).toBe("missing");
  });
});
