// The AI routes with no AI Brain configured: each must use its local
// fallback and say so, or, for the wake planner, refuse plainly.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as schedule } from "@/app/api/ai/schedule/route";
import { POST as semantic } from "@/app/api/ai/semantic/route";
import { POST as sleepPrediction } from "@/app/api/ai/sleep-prediction/route";
import { POST as wakePlan } from "@/app/api/ai/wake-plan/route";
import { Alarm } from "@/models/Alarm";
import { Task } from "@/models/Task";
import { read, request, signInAs, twoUsers } from "./helpers";

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let alice: string;
let bob: string;
beforeEach(async () => {
  ({ alice, bob } = await twoUsers());
});

describe("POST /api/ai/semantic", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await semantic(request("POST", "/api/ai/semantic", { text: "exam" }))).status).toBe(401);
  });

  it.each([
    ["no text", {}, /Text is required/],
    ["blank text", { text: "   " }, /Text is required/],
    ["text that is not a string", { text: 42 }, /Text is required/],
    ["text over 2000 characters", { text: "a".repeat(2001) }, /2000 characters or fewer/],
  ])("rejects %s", async (_what, body, message) => {
    signInAs(alice);
    const res = await read(await semantic(request("POST", "/api/ai/semantic", body)));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(message);
  });

  it("analyses text with the local fallback and says so", async () => {
    signInAs(alice);
    const res = await read(await semantic(request("POST", "/api/ai/semantic", { text: "Final exam tomorrow at 9am" })));
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe("fallback");
    expect(res.body.data.analysis.suggestedPriority).toMatch(/^(low|medium|high|critical)$/);
  });
});

describe("POST /api/ai/sleep-prediction", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await sleepPrediction(request("POST", "/api/ai/sleep-prediction", {}))).status).toBe(401);
  });

  it.each([
    ["features that are not an object", { features: "rested" }],
    ["a feature that is not a number", { features: { sleepDebt: "lots" } }],
  ])("rejects %s", async (_what, body) => {
    signInAs(alice);
    const res = await read(await sleepPrediction(request("POST", "/api/ai/sleep-prediction", body)));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/features must map feature names to numbers/);
  });

  it("predicts from the caller's own signals when no features are given", async () => {
    signInAs(alice);
    const res = await read(await sleepPrediction(request("POST", "/api/ai/sleep-prediction", {})));
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe("fallback");
    expect(typeof res.body.data.prediction.predictedSleepDuration).toBe("number");
  });

  it("uses features the caller supplies", async () => {
    signInAs(alice);
    const res = await read(await sleepPrediction(request("POST", "/api/ai/sleep-prediction", { features: { avgSleepHours: 6 } })));
    expect(res.body.data.features).toEqual({ avgSleepHours: 6 });
  });
});

describe("POST /api/ai/wake-plan", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await wakePlan(request("POST", "/api/ai/wake-plan", {}))).status).toBe(401);
  });

  it.each([
    ["a reliability that is not a number", { requiredReliability: "very" }, /requiredReliability must be a number above 0 and at most 1/],
    ["a reliability above 1", { requiredReliability: 90 }, /requiredReliability must be/],
    ["a reliability of 0", { requiredReliability: 0 }, /requiredReliability must be/],
    ["a negative minimum sleep", { minSleepHours: -2 }, /minSleepHours must be a number from 0 to 14/],
    ["a wake time that is not a string", { wakeTime: 540 }, /wakeTime must be a 24-hour time/],
  ])("rejects %s", async (_what, body, message) => {
    signInAs(alice);
    const res = await read(await wakePlan(request("POST", "/api/ai/wake-plan", body)));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(message);
  });

  it("says plainly that it cannot plan without the AI Brain, rather than guessing", async () => {
    signInAs(alice);
    const res = await read(await wakePlan(request("POST", "/api/ai/wake-plan", { requiredReliability: 0.9 })));
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/wake planner is offline/);
  });
});

describe("POST /api/ai/schedule", () => {
  it("rejects an unauthenticated request without creating alarms", async () => {
    expect((await schedule(request("POST", "/api/ai/schedule", { mode: "autonomous" }))).status).toBe(401);
    expect(await Alarm.countDocuments()).toBe(0);
  });

  it.each([
    ["an unknown mode", { mode: "yolo" }, /mode must be assisted or autonomous/],
    ["a horizon of zero days", { horizonDays: 0 }, /horizonDays must be a whole number from 1 to 30/],
    ["a horizon as text", { horizonDays: "week" }, /horizonDays must be/],
    ["taskIds that is not a list", { taskIds: "all" }, /taskIds must be a list of task ids/],
    ["a malformed task id", { taskIds: ["nope"] }, /taskIds must be a list of task ids/],
    ["runMaintenance as text", { runMaintenance: "yes" }, /runMaintenance must be true or false/],
  ])("rejects %s", async (_what, body, message) => {
    signInAs(alice);
    const res = await read(await schedule(request("POST", "/api/ai/schedule", body)));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(message);
    expect(await Alarm.countDocuments()).toBe(0);
  });

  it("proposes without creating in assisted mode, and creates the caller's alarms in autonomous mode", async () => {
    const task = await Task.create({ userId: alice, title: "Final exam", priority: "critical", dueDate: tomorrow(), dueTime: "09:00" });
    signInAs(alice);

    const preview = await read(await schedule(request("POST", "/api/ai/schedule", { mode: "assisted" })));
    expect(preview.status).toBe(200);
    expect(preview.body.data.predictionSource).toBe("fallback");
    expect(preview.body.data.created).toEqual([]);
    expect(preview.body.data.proposals.map((p: { linkedTaskId: string }) => p.linkedTaskId)).toEqual([String(task._id)]);
    expect(await Alarm.countDocuments()).toBe(0);

    const created = await read(await schedule(request("POST", "/api/ai/schedule", { mode: "autonomous", runMaintenance: false })));
    expect(created.body.data.created).toHaveLength(1);
    expect(await Alarm.countDocuments({ userId: alice, linkedTaskId: String(task._id), source: "autonomous" })).toBe(1);
  });

  it("never schedules from another user's tasks, even when asked for them by id", async () => {
    const bobsTask = await Task.create({ userId: bob, title: "Bob's exam", priority: "critical", dueDate: tomorrow(), dueTime: "09:00" });
    signInAs(alice);
    const res = await read(await schedule(request("POST", "/api/ai/schedule", {
      mode: "autonomous", taskIds: [String(bobsTask._id)], runMaintenance: false,
    })));
    expect(res.status).toBe(200);
    expect(res.body.data.proposals).toEqual([]);
    expect(await Alarm.countDocuments()).toBe(0);
  });
});
