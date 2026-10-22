// Read-only routes that summarise a user's own data. None takes a body; the
// metrics window is their only input.
import { beforeEach, describe, expect, it } from "vitest";
import { GET as metrics } from "@/app/api/metrics/route";
import { GET as weekly } from "@/app/api/analytics/weekly/route";
import { GET as recommendations } from "@/app/api/recommendations/route";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { SleepLog } from "@/models/SleepLog";
import { read, request, signInAs, twoUsers } from "./helpers";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

let alice: string;
let bob: string;
beforeEach(async () => {
  ({ alice, bob } = await twoUsers());
  // Bob has a rich history; Alice has none. Nothing of Bob's may leak into hers.
  for (let i = 1; i <= 5; i++) {
    await SleepLog.create({ userId: bob, date: ymd(daysAgo(i)), durationHours: 4, snoozeCount: 3 });
    await BehaviorEvent.create({ userId: bob, type: "escalation", value: 5, at: daysAgo(i) });
    await BehaviorEvent.create({ userId: bob, type: "snooze", value: 3, at: daysAgo(i) });
  }
});

describe("GET /api/metrics", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await metrics(request("GET", "/api/metrics"))).status).toBe(401);
  });

  it.each(["0", "abc", "365", "2.5"])("rejects days=%s", async (days) => {
    signInAs(alice);
    const res = await read(await metrics(request("GET", `/api/metrics?days=${days}`)));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/days must be a whole number from 1 to 180/);
  });

  it("computes from the caller's data only", async () => {
    signInAs(alice);
    const res = await read(await metrics(request("GET", "/api/metrics?days=14")));
    expect(res.status).toBe(200);
    expect(res.body.data.window.days).toBe(14);
    expect(res.body.data.escalationProfile.samples).toBe(0);

    signInAs(bob);
    const bobs = await read(await metrics(request("GET", "/api/metrics")));
    expect(bobs.body.data.escalationProfile.samples).toBe(5);
  });
});

describe("GET /api/analytics/weekly", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await weekly()).status).toBe(401);
  });

  it("reports no data for a user whose only neighbour has data", async () => {
    signInAs(alice);
    const res = await read(await weekly());
    expect(res.status).toBe(200);
    expect(res.body.data.hasData).toBe(false);
    expect(res.body.data.personalization.updates).toBe(0);
  });

  it("reports the caller's own nights", async () => {
    signInAs(bob);
    expect((await read(await weekly())).body.data.hasData).toBe(true);
  });
});

describe("GET /api/recommendations", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await recommendations()).status).toBe(401);
  });

  it("answers from local fallbacks, from the caller's data only", async () => {
    signInAs(alice);
    const res = await read(await recommendations());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ reportSource: "fallback", predictionSource: "fallback", recentSleepHours: null });
    expect(Array.isArray(res.body.data.recommendations)).toBe(true);
  });
});
