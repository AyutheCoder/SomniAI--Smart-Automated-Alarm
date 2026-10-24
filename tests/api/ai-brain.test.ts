// The wake planner has no local fallback, so its success path needs the AI
// Brain. The Brain's URL must be set before lib/aiClient is first imported,
// and fetch is stubbed so the test never leaves the machine.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AI_BRAIN_URL = "http://ai-brain.test";
});

import { POST as wakePlan } from "@/app/api/ai/wake-plan/route";
import { makeUser, read, request, signInAs } from "./helpers";

const PLAN = {
  feasible: true,
  reachesTarget: true,
  targetReliability: 0.9,
  baselineReliability: 0.7,
  achievedReliability: 0.91,
  combinedReliability: 0.91,
  recommendedBedtime: "22:15",
  recommendedBedtimeHour: 22.25,
  currentBedtimeHour: 23.5,
  shiftMinutes: -75,
  predictedSleepHours: 7.4,
  combinedPlan: [],
  habitConstraints: [],
  levers: [],
  reliabilityCurve: [],
  summary: "Sleep by 22:15.",
};

const brain = vi.fn();
beforeEach(() => {
  brain.mockReset();
  vi.stubGlobal("fetch", brain);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/ai/wake-plan", () => {
  it("returns the Brain's plan, labelled as coming from it", async () => {
    brain.mockResolvedValue(new Response(JSON.stringify(PLAN), { status: 200 }));
    signInAs(await makeUser({ sleepGoalHours: 8 }));

    const res = await read(await wakePlan(request("POST", "/api/ai/wake-plan", { requiredReliability: 0.9, wakeTime: "05:40" })));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ source: "ai", plan: { recommendedBedtime: "22:15" } });

    const [url, init] = brain.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://ai-brain.test/plan/wake");
    expect(JSON.parse(String(init.body))).toMatchObject({ requiredReliability: 0.9, wakeTime: "05:40", minSleepHours: 6.5 });
  });

  it("reports the planner offline when the Brain answers with an error", async () => {
    brain.mockResolvedValue(new Response("boom", { status: 500 }));
    signInAs(await makeUser());
    const res = await read(await wakePlan(request("POST", "/api/ai/wake-plan", {})));
    expect(res.status).toBe(503);
  });
});
