import { describe, expect, it } from "vitest";
import { POST as createAlarm } from "@/app/api/alarms/route";
import { PATCH as editAlarm } from "@/app/api/alarms/[id]/route";
import { POST as wakePlan } from "@/app/api/ai/wake-plan/route";
import { DELETE as stop, GET as state, PUT as start } from "@/app/api/randomisation/route";
import { buildEscalationPlan } from "@/lib/escalation";
import { armFor, BLOCK_SIZE, STRETCH, WITHHELD_TEXT } from "@/lib/randomisation";
import { Assignment } from "@/models/Randomisation";
import { Task } from "@/models/Task";
import { idParams, makeUser, read, request, signInAs } from "./helpers";

const SEED = "study-2026";
let n = 0;
async function alarm(fields: Record<string, unknown> = {}) {
  n++;
  const res = await read(await createAlarm(request("POST", "/api/alarms", {
    label: `Alarm ${n}`, scheduledTime: new Date(Date.UTC(2026, 11, 1 + (n % 28), 6, 30)).toISOString(), ...fields,
  })));
  expect(res.status).toBe(201);
  return res.body.data as { _id: string; ringPlan: { study?: Record<string, unknown>; escalation: { afterSeconds: number }[]; critical: boolean } };
}
/** `null` sends no seed, so the server makes one. */
const begin = async (experiment: string, seed: string | null = SEED) =>
  read(await start(request("PUT", "/api/randomisation", seed === null ? { experiment } : { experiment, seed })));
const current = async () => (await read(await state())).body.data;
/**
 * A seed whose first arms for this user are the ones a test needs. User ids are
 * random per run, so a short list of candidates can hold none (six letters missed
 * one run in eleven); this searches far enough that a miss is practically impossible.
 */
function seedWhere(fits: (seed: string) => boolean): string {
  for (let i = 0; i < 500; i++) {
    if (fits(`seed-${i}`)) {
      return `seed-${i}`;
    }
  }
  throw new Error("no seed among 500 gives the arms this test needs");
}
const plain = buildEscalationPlan("adaptive").map((l) => l.afterSeconds);

describe("randomising one aspect of waking per alarm", () => {
  it("is balanced, logged, and reproducible from the seed", async () => {
    const me = await makeUser();
    signInAs(me);
    expect((await begin("escalation_pacing")).body.data.active).toMatchObject({ experiment: "escalation_pacing", seed: SEED, randomised: 0 });
    const made = [];
    for (let i = 0; i < 12; i++) {
      made.push(await alarm());
    }
    const s = await current();
    expect(s.counts).toEqual({ standard: 6, stretched: 6 });
    expect(s.active.randomised).toBe(12);
    expect(s.auditMismatches).toBe(0);
    // The log: one entry per alarm, in sequence, each arm recomputable from the seed alone.
    const log = [...s.log].reverse();
    expect(log.map((a: { sequence: number }) => a.sequence)).toEqual([...Array(12).keys()]);
    for (const a of log) {
      expect(a.arm).toBe(armFor(SEED, me, "escalation_pacing", a.sequence));
      expect(a.block).toBe(Math.floor(a.sequence / BLOCK_SIZE));
      expect(a.excluded).toBeNull();
    }
    // Each complete block of four: two of each.
    for (let b = 0; b < 3; b++) {
      expect(log.slice(b * 4, b * 4 + 4).filter((a: { arm: string }) => a.arm === "stretched")).toHaveLength(2);
    }
    // And the plan each alarm rings from follows its arm.
    made.forEach((m, i) => {
      expect(m.ringPlan.study).toEqual({ experiment: "escalation_pacing", arm: log[i].arm, applied: true });
      expect(m.ringPlan.escalation.map((l) => l.afterSeconds)).toEqual(log[i].arm === "stretched" ? plain.map((x) => Math.round(x * STRETCH)) : plain);
    });
  });

  it("a seed not given is generated and stored, so the assignments can still be recomputed", async () => {
    signInAs(await makeUser());
    const s = (await begin("wake_plan", null)).body.data;
    expect(s.active.seed).toMatch(/^[0-9a-f]{16}$/);
    await alarm();
    expect((await current()).auditMismatches).toBe(0);
  });

  describe("never an unmissable alarm", () => {
    it("a strong wake check: not randomised, logged as excluded, and it takes no place in the sequence", async () => {
      const me = await makeUser();
      signInAs(me);
      await begin("escalation_pacing");
      await alarm();
      const strict = await alarm({ verificationRequired: true, minConfidence: 85 });
      const after = await alarm();
      expect(strict.ringPlan.critical).toBe(true);
      expect(strict.ringPlan.study).toEqual({ experiment: "escalation_pacing", arm: null, applied: false, reason: "unmissable" });
      expect(strict.ringPlan.escalation.map((l) => l.afterSeconds)).toEqual(plain);
      const logged = await Assignment.find({ userId: me }).sort({ assignedAt: 1 }).lean<{ alarmId: string; sequence: number | null; arm: string | null; excluded: string | null }[]>();
      expect(logged.find((a) => a.alarmId === strict._id)).toMatchObject({ sequence: null, arm: null, excluded: "unmissable" });
      expect(logged.find((a) => a.alarmId === after._id)!.sequence).toBe(1);
      const s = await current();
      expect(s.excluded).toBe(1);
      expect(s.active.randomised).toBe(2);
    });

    it("linked to a task that can't be missed: not randomised either", async () => {
      const me = await makeUser();
      signInAs(me);
      await begin("wake_plan");
      const task = await Task.create({ userId: me, title: "Flight", priority: "critical", dueDate: new Date("2026-12-02T08:00:00Z") });
      const a = await alarm({ linkedTaskId: String(task._id) });
      expect(a.ringPlan.study).toMatchObject({ arm: null, applied: false, reason: "unmissable" });
    });

    it("an alarm made unmissable later keeps its logged arm, which stops applying", async () => {
      const me = await makeUser();
      signInAs(me);
      // A seed whose first arm is "stretched", so the change is visible.
      const seed = seedWhere((x) => armFor(x, me, "escalation_pacing", 0) === "stretched");
      await begin("escalation_pacing", seed);
      const a = await alarm();
      expect(a.ringPlan.study).toMatchObject({ arm: "stretched", applied: true });
      const edited = await read(await editAlarm(request("PATCH", `/api/alarms/${a._id}`, { minConfidence: 90 }), idParams(a._id)));
      expect(edited.body.data.ringPlan.study).toEqual({ experiment: "escalation_pacing", arm: "stretched", applied: false, reason: "unmissable" });
      expect(edited.body.data.ringPlan.escalation.map((l: { afterSeconds: number }) => l.afterSeconds)).toEqual(plain);
      const logged = await Assignment.findOne({ alarmId: a._id }).lean<{ arm: string; overriddenAt: Date | null }>();
      expect(logged!.arm).toBe("stretched");
      expect(logged!.overriddenAt).toBeInstanceOf(Date);
    });
  });

  it("re-planning an alarm keeps its assignment; nothing is drawn again", async () => {
    const me = await makeUser();
    signInAs(me);
    await begin("escalation_pacing");
    const a = await alarm();
    const again = await read(await editAlarm(request("PATCH", `/api/alarms/${a._id}`, { intensity: 80 }), idParams(a._id)));
    expect(again.body.data.ringPlan.study).toEqual(a.ringPlan.study);
    expect(await Assignment.countDocuments({ userId: me })).toBe(1);
    expect((await current()).active.randomised).toBe(1);
  });

  it("the wake plan isn't shown for an alarm whose arm is not_shown, and is for one that is", async () => {
    const me = await makeUser();
    signInAs(me);
    const seed = seedWhere((x) => armFor(x, me, "wake_plan", 0) === "not_shown" && armFor(x, me, "wake_plan", 1) === "shown");
    await begin("wake_plan", seed);
    const hidden = await alarm({ scheduledTime: "2026-12-05T06:30:00Z" });
    const shown = await alarm({ scheduledTime: "2026-12-05T07:15:00Z" });
    expect(hidden.ringPlan.study).toMatchObject({ arm: "not_shown", applied: true });
    expect(shown.ringPlan.study).toMatchObject({ arm: "shown", applied: true });
    const ask = async (wakeTime: string) => read(await wakePlan(request("POST", "/api/ai/wake-plan", { wakeTime, tz: "UTC" })));
    const withheld = await ask("06:30");
    expect(withheld.status).toBe(200);
    expect(withheld.body.data).toEqual({ plan: null, withheld: { alarmId: hidden._id, label: hidden.ringPlan ? expect.any(String) : "", reason: WITHHELD_TEXT } });
    // The shown alarm's time goes to the planner (offline here, so 503: but not withheld).
    const asked = await ask("07:15");
    expect(asked.body.data?.withheld).toBeUndefined();
    // In another timezone, 06:30 there is a different moment: not that alarm.
    expect((await read(await wakePlan(request("POST", "/api/ai/wake-plan", { wakeTime: "06:30", tz: "Asia/Kolkata" })))).body.data?.withheld).toBeUndefined();
  });

  it("stopping ends randomisation: new alarms aren't assigned", async () => {
    signInAs(await makeUser());
    await begin("escalation_pacing");
    await alarm();
    const stopped = (await read(await stop())).body.data;
    expect(stopped.active).toBeNull();
    const later = await alarm();
    expect(later.ringPlan.study).toBeUndefined();
    expect(stopped.log).toHaveLength(1);
  });

  it("starting another experiment stops the first; one at a time", async () => {
    const me = await makeUser();
    signInAs(me);
    await begin("escalation_pacing", "one");
    await begin("wake_plan", "two");
    expect((await current()).active).toMatchObject({ experiment: "wake_plan", seed: "two" });
    const a = await alarm();
    expect(a.ringPlan.study).toMatchObject({ experiment: "wake_plan" });
  });

  it("only for a signed-in user, and only known experiments and plain seeds", async () => {
    await makeUser();
    signInAs(null);
    expect((await state()).status).toBe(401);
    expect((await start(request("PUT", "/api/randomisation", { experiment: "wake_plan" }))).status).toBe(401);
    expect((await stop()).status).toBe(401);
    signInAs(await makeUser());
    expect((await begin("sound")).status).toBe(422);
    expect((await begin("wake_plan", "has spaces")).status).toBe(422);
    expect((await begin("wake_plan", "x".repeat(65))).status).toBe(422);
  });
});
