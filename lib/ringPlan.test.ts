import { describe, expect, it } from "vitest";
import { BACKUP_KINDS } from "./backupAdapters";
import { buildEscalationPlan } from "./escalation";
import { buildRingPlan, isRingPlan, resolveRingPlan, SOONER_THRESHOLD, type RingPlanInputs } from "./ringPlan";

const SETTINGS = {
  intensity: 70,
  wakeStrategy: "adaptive" as const,
  verificationRequired: true,
  verificationMethod: "math",
  verificationMethods: ["math", "typing"],
  minConfidence: 70,
};
const plan = (over: Partial<RingPlanInputs> = {}) => buildRingPlan({ ...SETTINGS, brain: "not_configured", ...over });

describe("a ring plan holds everything the alarm needs to ring", () => {
  it("sound, the whole ladder, the challenge, criticality and how it was decided", () => {
    const p = plan({ now: new Date("2026-10-23T20:00:00Z") });
    expect(p).toMatchObject({
      version: 1,
      computedAt: "2026-10-23T20:00:00.000Z",
      sound: { intensity: 70, strategy: "adaptive" },
      challenge: { required: true, methods: ["math", "typing"], minConfidence: 70 },
      critical: false,
      criticalReason: null,
    });
    expect(p.escalation).toEqual(buildEscalationPlan("adaptive"));
    expect(p.escalation.map((l) => l.level)).toEqual([1, 2, 3, 4, 5]);
    expect(isRingPlan(p)).toBe(true);
  });

  it("survives being stored and read back unchanged", () => {
    const p = plan({ prediction: { offScheduleChance: 0.8, source: "ai" }, brain: "used" });
    const stored = JSON.parse(JSON.stringify(p));
    expect(stored).toEqual(p);
    expect(isRingPlan(stored)).toBe(true);
  });

  it("an alarm with no challenge needs none; unknown challenge names fall back to maths", () => {
    expect(plan({ verificationMethod: "none" }).challenge.required).toBe(false);
    expect(plan({ verificationMethods: ["telepathy"], verificationMethod: "telepathy" }).challenge.methods).toEqual(["math"]);
  });
});

describe("how the plan was decided is recorded", () => {
  it("names the AI Brain when its prediction paced the plan", () => {
    const p = plan({ brain: "used", prediction: { offScheduleChance: 0.3, source: "ai" } });
    expect(p.decidedBy).toBe("ai");
    expect(p.note).toBe("Paced with the AI Brain's prediction when the alarm was set.");
  });

  it("records the fallback, and why, when the AI Brain could not be reached", () => {
    const p = plan({ brain: "unreachable", prediction: { offScheduleChance: 0.3, source: "fallback" } });
    expect(p.decidedBy).toBe("fallback");
    expect(p.note).toMatch(/couldn't be reached or gave no usable answer.*rule-based plan was used/);
  });

  it("does not credit the AI Brain when it answered but the prediction came from the rules", () => {
    const p = plan({ brain: "used", prediction: { offScheduleChance: 0.3, source: "fallback" } });
    expect(p.decidedBy).toBe("fallback");
    expect(p.note).toMatch(/couldn't be reached/);
  });

  it("says so when no AI Brain is configured at all", () => {
    expect(plan({ brain: "not_configured" }).note).toBe("No AI Brain is configured, so the rule-based plan was used.");
  });
});

describe("what shapes the ladder", () => {
  it(`escalates sooner above a ${SOONER_THRESHOLD} predicted chance of waking off the usual time, and says why`, () => {
    const base = buildEscalationPlan("adaptive").map((l) => l.afterSeconds);
    const p = plan({ brain: "used", prediction: { offScheduleChance: 0.8, source: "ai" } });
    expect(p.escalation.map((l) => l.afterSeconds)).toEqual(base.map((s) => Math.round(s * 0.8)));
    expect(p.adjustments).toContain("Escalates sooner: 80% predicted chance of waking off your usual time (AI Brain).");
    expect(plan({ prediction: { offScheduleChance: 0.5, source: "fallback" } }).escalation.map((l) => l.afterSeconds)).toEqual(base);
  });

  it("paces to the user's own history, but keeps the full ladder for a critical alarm", () => {
    const profile = { typicalLevel: 1, reliableLevel: 2, paceFactor: 1.25, samples: 6 };
    const ordinary = plan({ profile });
    const critical = plan({ profile, critical: { value: true, reason: "Linked to an exam." } });
    expect(ordinary.escalation[4].backup).toEqual([]);
    expect(critical.escalation[4].backup).toEqual([...BACKUP_KINDS]);
    expect(critical).toMatchObject({ critical: true, criticalReason: "Linked to an exam." });
    expect(critical.adjustments[0]).toMatch(/full ladder is kept because this alarm is critical/);
  });

  it("ignores a history too short to learn from", () => {
    expect(plan({ profile: { typicalLevel: 4, reliableLevel: 4, paceFactor: 0.6, samples: 2 } }).escalation)
      .toEqual(buildEscalationPlan("adaptive"));
  });
});

describe("resolveRingPlan, used at ring time", () => {
  it("rings from the stored plan exactly, even if the alarm's own fields say otherwise", () => {
    const stored = plan({ brain: "used", prediction: { offScheduleChance: 0.9, source: "ai" } });
    const alarm = { ...SETTINGS, wakeStrategy: "gentle" as const, intensity: 10, ringPlan: JSON.parse(JSON.stringify(stored)) };
    expect(resolveRingPlan(alarm)).toEqual(stored);
  });

  it("builds a rule-based plan on the device for an alarm stored before plans existed", () => {
    const p = resolveRingPlan({ ...SETTINGS, minConfidence: 85 });
    expect(p).toMatchObject({ decidedBy: "fallback", critical: true });
    expect(p.note).toMatch(/set before ring plans were stored/);
    expect(p.escalation).toEqual(buildEscalationPlan("adaptive"));
  });

  it("does not trust a damaged stored plan", () => {
    expect(isRingPlan({ version: 1, escalation: [] })).toBe(false);
    expect(resolveRingPlan({ ...SETTINGS, ringPlan: { version: 1 } }).note).toMatch(/set before ring plans/);
  });
});
