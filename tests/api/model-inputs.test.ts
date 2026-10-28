// A production prediction request never contains a simulated value.
//
// Two users get the same live data; one also gets simulated data of every
// kind (simulator nights, simulated and old synthetic events, a simulated
// wearable snapshot, a snapshot from before sources existed). Every route that
// calls the AI Brain is run for both, and what reaches the Brain is captured.
// In production the two must be identical, i.e. the simulated data changes
// nothing. A development run with SOMNIAI_SIMULATED_INPUTS=allow shows the
// same data does leak when allowed, so the check is not passing vacuously.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AI_BRAIN_URL = "http://ai-brain.test";
});

import { POST as sleepPrediction } from "@/app/api/ai/sleep-prediction/route";
import { POST as wakePlan } from "@/app/api/ai/wake-plan/route";
import { POST as schedule } from "@/app/api/ai/schedule/route";
import { GET as recommendations } from "@/app/api/recommendations/route";
import { GET as weekly } from "@/app/api/analytics/weekly/route";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { ContextSnapshot } from "@/models/ContextSnapshot";
import { SleepLog } from "@/models/SleepLog";
import { makeUser, request, signInAs } from "./helpers";

/** Distinctive values that exist only in the simulated data. */
const SIMULATED = { restingHr: 187, steps: 98765, legacyHr: 177, legacySteps: 87654, responseMs: 54321, noise: 97 };

const DAY = 86_400_000;
const at = (daysAgo: number, hour = 7) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function seedLive(userId: string) {
  for (const [daysAgo, hours, snoozes] of [[1, 7.5, 0], [2, 6.8, 1], [3, 7.2, 0]] as const) {
    const wake = at(daysAgo);
    await SleepLog.create({
      userId, date: ymd(wake), source: "manual",
      sleepTime: new Date(wake.getTime() - hours * 3_600_000), wakeTime: wake,
      durationHours: hours, snoozeCount: snoozes, alarmResponseMs: 9000,
    });
  }
  await BehaviorEvent.create([
    { userId, type: "ambient_noise", value: 40, source: "live", at: at(1, 2) },
    { userId, type: "snooze", value: 1, at: at(2, 7) },
  ]);
  await ContextSnapshot.create({
    userId, at: at(1, 6), weather: { tempC: 18, condition: "Clear" },
    sources: { weather: "live", calendar: "missing", wearable: "missing" },
  });
}

async function seedSimulated(userId: string) {
  for (const daysAgo of [4, 5, 6]) {
    await SleepLog.create({
      userId, date: ymd(at(daysAgo)), source: "simulated",
      durationHours: 3.1, snoozeCount: 9, alarmResponseMs: SIMULATED.responseMs, sleepTime: at(daysAgo, 4),
    });
  }
  await BehaviorEvent.create([
    { userId, type: "ambient_noise", value: SIMULATED.noise, source: "simulated", at: at(1, 3) },
    { userId, type: "escalation", value: 5, source: "simulated", at: at(1, 7) },
    // Written by the simulator before sources existed.
    { userId, type: "ambient_noise", value: SIMULATED.noise, meta: { synthetic: true }, at: at(2, 3) },
  ]);
  await ContextSnapshot.create({
    userId, at: at(0, 1), wearable: { restingHr: SIMULATED.restingHr, steps: SIMULATED.steps, lastSleepHours: 3 },
    sources: { weather: "missing", calendar: "simulated", wearable: "simulated" },
  });
  // The newest snapshot predates sources: its values must count as missing.
  await ContextSnapshot.create({
    userId, at: new Date(), wearable: { restingHr: SIMULATED.legacyHr, steps: SIMULATED.legacySteps },
    source: "simulated",
  });
}

const brain = vi.fn();

/** Runs every Brain-calling route as `userId`; returns what the Brain was sent, by endpoint. */
async function brainInputs(userId: string) {
  brain.mockClear();
  signInAs(userId);
  await sleepPrediction(request("POST", "/api/ai/sleep-prediction", {}));
  await wakePlan(request("POST", "/api/ai/wake-plan", { requiredReliability: 0.9, wakeTime: "06:30" }));
  await schedule(request("POST", "/api/ai/schedule", { mode: "assisted" }));
  await recommendations();
  await weekly();
  return brain.mock.calls.map(([url, init]) => ({
    endpoint: String(url).replace("http://ai-brain.test", ""),
    body: JSON.parse(String((init as RequestInit).body)),
  }));
}

let mixed: string;
let liveOnly: string;
beforeEach(async () => {
  brain.mockReset();
  // The Brain refuses everything, so routes fall back locally; what was sent is what counts.
  brain.mockImplementation(async () => new Response("unavailable", { status: 503 }));
  vi.stubGlobal("fetch", brain);
  mixed = await makeUser({ sleepGoalHours: 8 });
  liveOnly = await makeUser({ sleepGoalHours: 8 });
  await seedLive(mixed);
  await seedLive(liveOnly);
  await seedSimulated(mixed);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("in production", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    // Production ignores the development switch.
    vi.stubEnv("SOMNIAI_SIMULATED_INPUTS", "allow");
  });

  it("every Brain-calling route sends exactly what it would with the simulated data absent", async () => {
    const withSimulated = await brainInputs(mixed);
    const without = await brainInputs(liveOnly);
    // sleep-prediction and schedule: predict x2; wake-plan: plan; recommendations
    // and weekly: predict x2 + recommend (which sends metrics, not features).
    expect(withSimulated.map((c) => c.endpoint).sort()).toEqual([
      "/plan/wake",
      ...Array(4).fill("/predict/sleep"),
      ...Array(4).fill("/predict/wake-success"),
      "/recommend", "/recommend",
    ].sort());
    expect(withSimulated).toEqual(without);
  });

  it("no request contains a simulated value, and wearable and noise come only from live data", async () => {
    const sent = await brainInputs(mixed);
    const text = JSON.stringify(sent);
    for (const value of Object.values(SIMULATED)) {
      expect(text).not.toMatch(new RegExp(`[^\\d.]${value}[^\\d.]`));
    }
    const withFeatures = sent.filter((c) => c.body.features);
    expect(withFeatures).toHaveLength(9);
    for (const { body } of withFeatures) {
      expect(body.features).not.toHaveProperty("resting_hr");
      expect(body.features).not.toHaveProperty("steps");
      expect(body.features.ambient_noise_db).toBe(40);
      expect(body.features.alarm_response_ms).toBe(9000);
    }
  });

  it("refuses caller-supplied features, which have no checkable source", async () => {
    signInAs(mixed);
    const res = await sleepPrediction(request("POST", "/api/ai/sleep-prediction", { features: { resting_hr: 187 } }));
    expect(res.status).toBe(422);
    expect(brain).not.toHaveBeenCalled();
  });
});

describe("the check is not vacuous", () => {
  it("in development with SOMNIAI_SIMULATED_INPUTS=allow, the same simulated data does reach the Brain", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SOMNIAI_SIMULATED_INPUTS", "allow");
    const sent = await brainInputs(mixed);
    const features = sent.find((c) => c.endpoint === "/predict/sleep")!.body.features;
    // The simulated nights now count: their 54 s responses pull the mean up
    // from the live 9 s, and the simulated noise reading joins the live one.
    expect(features.alarm_response_ms).toBeGreaterThan(9000);
    expect(features.ambient_noise_db).toBeGreaterThan(40);
    expect(sent).not.toEqual(await brainInputs(liveOnly));
  });

  it("in development without the switch, simulated data stays out as in production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SOMNIAI_SIMULATED_INPUTS", "");
    expect(await brainInputs(mixed)).toEqual(await brainInputs(liveOnly));
  });
});
