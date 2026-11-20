// Alarms carry their whole ring plan from the moment they are set, whether
// or not the AI Brain can be reached. The Brain is configured here and
// fetch is stubbed, so it can be made to answer, fail, or not answer at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AI_BRAIN_URL = "http://ai-brain.test";
});

import { POST as createAlarm } from "@/app/api/alarms/route";
import { PATCH as patchAlarm } from "@/app/api/alarms/[id]/route";
import { POST as schedule } from "@/app/api/ai/schedule/route";
import { buildEscalationPlan } from "@/lib/escalation";
import { isRingPlan, type RingPlan } from "@/lib/ringPlan";
import { BACKUP_KINDS } from "@/lib/backupAdapters";
import { Alarm } from "@/models/Alarm";
import { Task } from "@/models/Task";
import { idParams, makeUser, read, request, signInAs } from "./helpers";

const brain = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const SOON = new Date(Date.now() + 3_600_000).toISOString();

function brainAnswers(offScheduleChance: number) {
  brain.mockImplementation(async (url) => (String(url).endsWith("/predict/wake-success")
    ? new Response(JSON.stringify({
      wakeSuccessProbability: 1 - offScheduleChance, oversleepProbability: offScheduleChance, confidence: 0.8,
    }))
    : new Response("not used here", { status: 503 })));
}

async function create(body: Record<string, unknown> = {}) {
  const res = await read(await createAlarm(request("POST", "/api/alarms", { label: "Exam", scheduledTime: SOON, ...body })));
  expect(res.status).toBe(201);
  return res.body.data as { _id: string; ringPlan: RingPlan };
}

let user: string;
beforeEach(async () => {
  brain.mockReset();
  vi.stubGlobal("fetch", brain);
  user = await makeUser();
  signInAs(user);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/alarms with the AI Brain down", () => {
  it.each([
    ["refuses the connection", () => brain.mockRejectedValue(new TypeError("fetch failed"))],
    ["answers with a server error", () => brain.mockResolvedValue(new Response("boom", { status: 500 }))],
    ["answers with nonsense", () => brain.mockResolvedValue(new Response(JSON.stringify({ hello: "world" })))],
  ])("when it %s, still sets the alarm with the rule-based plan and records why", async (_how, setUp) => {
    setUp();
    const alarm = await create();
    expect(isRingPlan(alarm.ringPlan)).toBe(true);
    expect(alarm.ringPlan).toMatchObject({
      decidedBy: "fallback",
      prediction: { source: "fallback" },
      sound: { intensity: 60, strategy: "adaptive" },
      challenge: { required: true, methods: ["math"], minConfidence: 70 },
    });
    expect(alarm.ringPlan.note).toMatch(/AI Brain couldn't be reached or gave no usable answer when this alarm was set, so the rule-based plan was used/);
    expect(alarm.ringPlan.escalation).toHaveLength(5);
    expect(brain).toHaveBeenCalled();
    // What was returned is what was stored.
    const stored = await Alarm.findById(alarm._id).lean<{ ringPlan: RingPlan }>();
    expect(stored?.ringPlan).toEqual(alarm.ringPlan);
  });

  it("when it never answers, waits no longer than the client's timeout", async () => {
    brain.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
    }));
    const started = Date.now();
    const alarm = await create();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(alarm.ringPlan.decidedBy).toBe("fallback");
  });
});

describe("POST /api/alarms with the AI Brain up", () => {
  it("records that the AI Brain paced the plan, and how", async () => {
    brainAnswers(0.8);
    const alarm = await create();
    expect(alarm.ringPlan).toMatchObject({ decidedBy: "ai", prediction: { offScheduleChance: 0.8, source: "ai" } });
    expect(alarm.ringPlan.note).toBe("Paced with the AI Brain's prediction when the alarm was set.");
    expect(alarm.ringPlan.adjustments).toContain("Escalates sooner: 80% predicted chance of waking off your usual time (AI Brain).");
    expect(alarm.ringPlan.escalation.map((l) => l.afterSeconds))
      .toEqual(buildEscalationPlan("adaptive").map((l) => Math.round(l.afterSeconds * 0.8)));
  });
});

describe("criticality", () => {
  it("an alarm linked to a task that can't be missed is critical, and keeps every backup", async () => {
    brain.mockRejectedValue(new TypeError("fetch failed"));
    const task = await Task.create({ userId: user, title: "Flight to Delhi", priority: "critical" });
    const alarm = await create({ linkedTaskId: String(task._id) });
    expect(alarm.ringPlan).toMatchObject({ critical: true, criticalReason: "Linked to \"Flight to Delhi\", which can't be missed." });
    expect(alarm.ringPlan.escalation[4].backup).toEqual([...BACKUP_KINDS]);
  });
});

describe("PATCH /api/alarms/[id]", () => {
  it("works the plan out again when how the alarm rings changes", async () => {
    brain.mockRejectedValue(new TypeError("fetch failed"));
    const alarm = await create();
    const res = await read(await patchAlarm(request("PATCH", `/api/alarms/${alarm._id}`, { wakeStrategy: "aggressive" }), idParams(alarm._id)));
    expect(res.body.data.ringPlan.sound.strategy).toBe("aggressive");
    expect(res.body.data.ringPlan.escalation).toEqual(buildEscalationPlan("aggressive"));
  });

  it("keeps the plan when only the label or time changes", async () => {
    brain.mockRejectedValue(new TypeError("fetch failed"));
    const alarm = await create();
    const res = await read(await patchAlarm(request("PATCH", `/api/alarms/${alarm._id}`, { label: "Renamed" }), idParams(alarm._id)));
    expect(res.body.data.ringPlan).toEqual(alarm.ringPlan);
  });
});

describe("POST /api/ai/schedule (autonomous) with the AI Brain down", () => {
  it("creates alarms that each carry a rule-based ring plan saying why", async () => {
    brain.mockRejectedValue(new TypeError("fetch failed"));
    const d = new Date(Date.now() + 86_400_000);
    const due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await Task.create({ userId: user, title: "Final exam", priority: "critical", dueDate: due, dueTime: "09:00" });
    const res = await read(await schedule(request("POST", "/api/ai/schedule", { mode: "autonomous", runMaintenance: false })));
    expect(res.body.data.created).toHaveLength(1);
    const [alarm] = res.body.data.created as { ringPlan: RingPlan }[];
    expect(isRingPlan(alarm.ringPlan)).toBe(true);
    expect(alarm.ringPlan).toMatchObject({ decidedBy: "fallback", critical: true });
    expect(alarm.ringPlan.note).toMatch(/couldn't be reached/);
  });
});
