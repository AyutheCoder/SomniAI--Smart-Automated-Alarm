import { describe, expect, it } from "vitest";
import { buildEscalationPlan } from "./escalation";
import {
  armFor, auditAssignments, BLOCK_SIZE, blockOrder, EXPERIMENTS, generator, hash32, pacedEscalation, STRETCH, type Arm, type Experiment,
} from "./randomisation";
import { buildRingPlan } from "./ringPlan";

const sequence = (seed: string, user: string, experiment: Experiment, n: number) =>
  Array.from({ length: n }, (_, i) => armFor(seed, user, experiment, i));

describe("balanced, by permuted blocks", () => {
  it.each(Object.keys(EXPERIMENTS) as Experiment[])("%s: every complete block has two of each arm", (experiment) => {
    const [a, b] = EXPERIMENTS[experiment].arms;
    for (const seed of ["s1", "study-2026", "x"]) {
      for (let block = 0; block < 250; block++) {
        const arms = blockOrder(seed, "user-1", experiment, block);
        expect(arms).toHaveLength(BLOCK_SIZE);
        expect(arms.filter((x) => x === a)).toHaveLength(2);
        expect(arms.filter((x) => x === b)).toHaveLength(2);
      }
    }
  });

  it("at every point, the arms differ by at most two", () => {
    for (const user of ["u1", "u2", "u3", "u4", "u5"]) {
      let diff = 0;
      for (const arm of sequence("seed-1", user, "escalation_pacing", 1000)) {
        diff += arm === "standard" ? 1 : -1;
        expect(Math.abs(diff)).toBeLessThanOrEqual(BLOCK_SIZE / 2);
      }
      expect(diff).toBe(0);
    }
  });

  it("isn't predictable from the position: each arm comes first about half the time", () => {
    let first = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      if (armFor(`seed-${i}`, "u", "wake_plan", 0) === "shown") {
        first++;
      }
    }
    expect(first / n).toBeGreaterThan(0.46);
    expect(first / n).toBeLessThan(0.54);
    // And all six orders of a block of four occur.
    const orders = new Set(Array.from({ length: 2000 }, (_, i) => blockOrder(`s${i}`, "u", "wake_plan", 0).join(",")));
    expect(orders.size).toBe(6);
  });
});

describe("reproducible from the seed", () => {
  it("the same seed, user, experiment and position always give the same arm", () => {
    expect(sequence("study-2026", "user-1", "escalation_pacing", 200)).toEqual(sequence("study-2026", "user-1", "escalation_pacing", 200));
  });

  it("a different seed, or another user, gives a different sequence", () => {
    const base = sequence("study-2026", "user-1", "escalation_pacing", 64).join();
    expect(sequence("study-2027", "user-1", "escalation_pacing", 64).join()).not.toBe(base);
    expect(sequence("study-2026", "user-2", "escalation_pacing", 64).join()).not.toBe(base);
  });

  it("is fixed across machines: known values pinned", () => {
    expect(hash32("")).toBe(0x811c9dc5);
    expect(hash32("a")).toBe(0xe40c292c);
    const rand = generator(42);
    expect([rand(), rand()].map((x) => x.toFixed(6))).toEqual(["0.601104", "0.448291"]);
    expect(sequence("study-2026", "user-1", "wake_plan", 8)).toEqual(sequence("study-2026", "user-1", "wake_plan", 8));
  });

  it("the audit recomputes every logged arm from its seed, and catches one that was changed", () => {
    const log = Array.from({ length: 12 }, (_, i) => ({
      userId: "u", experiment: "escalation_pacing" as const, seed: "s", sequence: i, arm: armFor("s", "u", "escalation_pacing", i) as Arm, excluded: null,
    }));
    expect(auditAssignments(log)).toEqual([]);
    const altered = [...log];
    altered[5] = { ...altered[5], arm: altered[5].arm === "standard" ? "stretched" : "standard" };
    expect(auditAssignments(altered)).toEqual([altered[5]]);
    // An unmissable alarm's entry has no arm and nothing to check.
    expect(auditAssignments([{ userId: "u", experiment: "wake_plan", seed: "s", sequence: null, arm: null, excluded: "unmissable" }])).toEqual([]);
  });
});

describe("what an arm does to the plan", () => {
  const settings = { intensity: 60, wakeStrategy: "adaptive" as const, verificationRequired: true, verificationMethod: "math", minConfidence: 70, brain: "not_configured" as const };

  it("stretched starts every level STRETCH times later, standard leaves the ladder alone; both well inside the 20-minute ring", () => {
    const ladder = buildEscalationPlan("gentle");
    expect(pacedEscalation(ladder, "standard")).toEqual(ladder);
    const stretched = pacedEscalation(ladder, "stretched");
    stretched.forEach((l, i) => expect(l.afterSeconds).toBe(Math.round(ladder[i].afterSeconds * STRETCH)));
    expect(Math.max(...stretched.map((l) => l.afterSeconds))).toBeLessThan(20 * 60);
  });

  it("the ring plan carries the arm and says so", () => {
    const plain = buildRingPlan(settings);
    const plan = buildRingPlan({ ...settings, study: { experiment: "escalation_pacing", arm: "stretched", applied: true } });
    expect(plan.escalation.map((l) => l.afterSeconds)).toEqual(plain.escalation.map((l) => Math.round(l.afterSeconds * STRETCH)));
    expect(plan.study).toEqual({ experiment: "escalation_pacing", arm: "stretched", applied: true });
    expect(plan.adjustments.at(-1)).toMatch(/^Study: each level starts 1.5 times later/);
    expect(plain.study).toBeUndefined();
  });

  it("an unmissable alarm's arm never applies, even if one is passed in", () => {
    const plan = buildRingPlan({ ...settings, critical: { value: true, reason: "test" }, study: { experiment: "escalation_pacing", arm: "stretched", applied: true } });
    expect(plan.study).toEqual({ experiment: "escalation_pacing", arm: "stretched", applied: false, reason: "unmissable" });
    expect(plan.escalation).toEqual(buildRingPlan({ ...settings, critical: { value: true, reason: "test" } }).escalation);
  });
});
