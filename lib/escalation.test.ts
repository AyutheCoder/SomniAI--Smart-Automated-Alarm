import { describe, it, expect } from "vitest";
import {
  deriveEscalationProfile,
  buildEscalationPlan,
  personalizeEscalationPlan,
  levelForElapsed,
  type EscalationProfile,
} from "./escalation";

/** Timings from TIMELINE, restated so a silent edit to them fails here. */
const ADAPTIVE = [0, 10, 22, 35, 75];

const profileOf = (over: Partial<EscalationProfile> = {}): EscalationProfile => ({
  typicalLevel: 4,
  reliableLevel: 4,
  paceFactor: 0.6,
  samples: 12,
  ...over,
});

describe("deriving an escalation profile from history", () => {
  describe("below three samples it defers to the shared default", () => {
    // The personalisation is only as good as the history behind it. Two nights
    // is noise, and guessing from it is worse than the population default.
    it.each([
      ["no history", []],
      ["one sample", [4]],
      ["two samples", [4, 4]],
    ])("%s", (_label, levels) => {
      const profile = deriveEscalationProfile({ effectiveLevels: levels });
      expect(profile).toEqual({
        typicalLevel: 1,
        reliableLevel: 5,
        paceFactor: 1,
        samples: levels.length,
      });
    });

    it("counts only valid levels, so junk can drop it back under the threshold", () => {
      // Four entries, but only two are usable levels.
      const profile = deriveEscalationProfile({
        effectiveLevels: [4, 4, 0, 9, Number.NaN, Infinity],
      });
      expect(profile.samples).toBe(2);
      expect(profile.paceFactor).toBe(1);
    });

    it("leaves the ladder untouched when the profile is under-sampled", () => {
      const plan = buildEscalationPlan("adaptive");
      const personalized = personalizeEscalationPlan(
        plan,
        deriveEscalationProfile({ effectiveLevels: [4, 4] }),
      );
      expect(personalized).toEqual(plan);
    });
  });

  it("reads a heavy sleeper and escalates faster", () => {
    const profile = deriveEscalationProfile({ effectiveLevels: [4, 4, 4, 5] });
    expect(profile.typicalLevel).toBe(4);
    expect(profile.reliableLevel).toBe(5);
    expect(profile.paceFactor).toBe(0.6);
    expect(profile.samples).toBe(4);
  });

  it("reads a light sleeper and grants more grace", () => {
    const profile = deriveEscalationProfile({ effectiveLevels: [1, 1, 1] });
    expect(profile.typicalLevel).toBe(1);
    // Never woken past level 1, plus one rung of margin.
    expect(profile.reliableLevel).toBe(2);
    expect(profile.paceFactor).toBe(1.25);
  });

  it("maps the middle of the range to its own pace", () => {
    expect(deriveEscalationProfile({ effectiveLevels: [3, 3, 3] }).paceFactor).toBe(0.8);
    expect(deriveEscalationProfile({ effectiveLevels: [2, 2, 2] }).paceFactor).toBe(1);
  });

  it("caps the reliable level at the top of the ladder", () => {
    const profile = deriveEscalationProfile({ effectiveLevels: [5, 5, 5, 5] });
    expect(profile.reliableLevel).toBe(5);
  });
});

describe("the shared ladder", () => {
  it("runs five levels, opening immediately", () => {
    const plan = buildEscalationPlan("adaptive");
    expect(plan.map((l) => l.level)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.map((l) => l.afterSeconds)).toEqual(ADAPTIVE);
    expect(plan[0].afterSeconds).toBe(0);
  });

  it("paces each strategy differently", () => {
    const gentle = buildEscalationPlan("gentle").map((l) => l.afterSeconds);
    const aggressive = buildEscalationPlan("aggressive").map((l) => l.afterSeconds);
    expect(gentle).toEqual([0, 20, 40, 60, 120]);
    expect(aggressive).toEqual([0, 5, 10, 18, 40]);
    // Every rung of the aggressive ladder arrives no later than the gentle one.
    gentle.forEach((s, i) => expect(aggressive[i]).toBeLessThanOrEqual(s));
  });

  it("only demands verification once the challenge stage begins", () => {
    const plan = buildEscalationPlan("adaptive");
    expect(plan.filter((l) => l.requireVerification).map((l) => l.level)).toEqual([4, 5]);
    expect(plan.map((l) => l.stage)).toEqual([
      "ramp",
      "ramp",
      "vibration",
      "challenge",
      "challenge",
    ]);
  });

  it("reserves every backup channel for the final level", () => {
    const plan = buildEscalationPlan("adaptive");
    expect(plan.slice(0, 4).every((l) => l.backup.length === 0)).toBe(true);
    expect(plan[4].backup).toEqual([
      "secondaryAlarm",
      "smartwatch",
      "smartLight",
      "smartSpeaker",
      "emergencyContact",
    ]);
  });

  it("falls back to the adaptive timeline for an unrecognised strategy", () => {
    const plan = buildEscalationPlan("nonsense" as never);
    expect(plan.map((l) => l.afterSeconds)).toEqual(ADAPTIVE);
  });
});

describe("personalising the ladder", () => {
  it("compresses the timeline for someone who never wakes early", () => {
    const plan = personalizeEscalationPlan(
      buildEscalationPlan("adaptive"),
      profileOf({ paceFactor: 0.6 }),
    );
    // The habitual level-4 waker meets the challenge at 21s rather than 35s.
    expect(plan[3].afterSeconds).toBe(21);
    expect(plan.map((l) => l.afterSeconds)).toEqual([0, 6, 13, 21, 45]);
  });

  it("stretches the timeline for someone who wakes at the first prompt", () => {
    const plan = personalizeEscalationPlan(
      buildEscalationPlan("adaptive"),
      profileOf({ typicalLevel: 1, reliableLevel: 2, paceFactor: 1.25 }),
    );
    // 94s before the backup blast rather than 75s.
    expect(plan[4].afterSeconds).toBe(94);
  });

  it("withholds the backup blast above the level that reliably works", () => {
    const plan = personalizeEscalationPlan(
      buildEscalationPlan("adaptive"),
      profileOf({ typicalLevel: 2, reliableLevel: 2, paceFactor: 1 }),
    );
    expect(plan[4].backup).toEqual([]);
    expect(plan[4].label).toContain("held back");
    // The rung still exists - it is just no longer escalating further.
    expect(plan).toHaveLength(5);
    expect(plan[4].requireVerification).toBe(true);
  });

  it("keeps levels at or below the reliable level fully intact", () => {
    const plan = personalizeEscalationPlan(
      buildEscalationPlan("adaptive"),
      profileOf({ reliableLevel: 4, paceFactor: 1 }),
    );
    expect(plan.slice(0, 4).every((l) => !l.label.includes("held back"))).toBe(true);
    expect(plan[4].backup).toEqual([]);
  });
});

describe("the criticality override", () => {
  it("retains the full ladder for an unmissable alarm, whatever the habit says", () => {
    // A habitual level-1 waker would normally have levels 3-5 held back.
    const profile = profileOf({ typicalLevel: 1, reliableLevel: 2, paceFactor: 1.25 });
    const critical = personalizeEscalationPlan(buildEscalationPlan("adaptive"), profile, {
      critical: true,
    });

    expect(critical[4].backup).toHaveLength(5);
    expect(critical.some((l) => l.label.includes("held back"))).toBe(false);
  });

  it("still personalises the pacing for a critical alarm", () => {
    // The override protects the ceiling, not the timing - a heavy sleeper should
    // still reach the backup blast sooner.
    const profile = profileOf({ paceFactor: 0.6 });
    const critical = personalizeEscalationPlan(buildEscalationPlan("adaptive"), profile, {
      critical: true,
    });
    expect(critical[4].afterSeconds).toBe(45);
    expect(critical[4].backup).toHaveLength(5);
  });

  it("differs from the ordinary path only in what it holds back", () => {
    const profile = profileOf({ typicalLevel: 1, reliableLevel: 2, paceFactor: 1.25 });
    const plan = buildEscalationPlan("adaptive");
    const ordinary = personalizeEscalationPlan(plan, profile);
    const critical = personalizeEscalationPlan(plan, profile, { critical: true });

    expect(ordinary.map((l) => l.afterSeconds)).toEqual(critical.map((l) => l.afterSeconds));
    expect(ordinary[4].backup).toEqual([]);
    expect(critical[4].backup).toHaveLength(5);
  });

  it("does not resurrect the ladder for an under-sampled critical alarm", () => {
    // Below three samples nothing is personalised, so the shared ladder - which
    // already carries the full backup set - is returned untouched.
    const plan = buildEscalationPlan("adaptive");
    const critical = personalizeEscalationPlan(
      plan,
      deriveEscalationProfile({ effectiveLevels: [1] }),
      { critical: true },
    );
    expect(critical).toEqual(plan);
    expect(critical[4].backup).toHaveLength(5);
  });
});

describe("selecting the active level for elapsed time", () => {
  const plan = buildEscalationPlan("adaptive");

  it("opens at level 1", () => {
    expect(levelForElapsed(0, plan).level).toBe(1);
    expect(levelForElapsed(-5, plan).level).toBe(1);
  });

  it("advances exactly on each boundary", () => {
    expect(levelForElapsed(9, plan).level).toBe(1);
    expect(levelForElapsed(10, plan).level).toBe(2);
    expect(levelForElapsed(22, plan).level).toBe(3);
    expect(levelForElapsed(35, plan).level).toBe(4);
    expect(levelForElapsed(75, plan).level).toBe(5);
  });

  it("stays at the top level once past the final rung", () => {
    expect(levelForElapsed(6000, plan).level).toBe(5);
  });
});
