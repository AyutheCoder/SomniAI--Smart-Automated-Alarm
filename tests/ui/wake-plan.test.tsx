// The evening flow's three answers, as the user reads them: a bedtime, the
// smallest set of changes, or an honest refusal with the reachable ceiling,
// the habit holding it back and a second alarm. Plus the exact-ceiling
// boundary, where only the planner's own verdict may decide.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WakePlanView, planKind, plannedBedtimeHour } from "@/app/_components/WakePlanPanel";
import type { WakePlan } from "@/lib/aiClient";
import { forbiddenWordingIn } from "@/lib/predictionCopy";

function textOf(element: React.ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const BASE: WakePlan = {
  feasible: false, reachesTarget: false, targetReliability: 0.85, baselineReliability: 0.6,
  achievedReliability: 0.6, combinedReliability: 0.6, recommendedBedtime: null, recommendedBedtimeHour: null,
  currentBedtimeHour: 23.5, shiftMinutes: null, predictedSleepHours: null, combinedPlan: [],
  habitConstraints: [], levers: [], reliabilityCurve: [], summary: "",
};

const FEASIBLE: WakePlan = {
  ...BASE, feasible: true, reachesTarget: true, achievedReliability: 0.86, combinedReliability: 0.86,
  recommendedBedtime: "22:15", recommendedBedtimeHour: 22.25, shiftMinutes: 75, predictedSleepHours: 7.6,
};

const CHANGES: WakePlan = {
  ...BASE, reachesTarget: true, achievedReliability: 0.78, combinedReliability: 0.87,
  combinedPlan: [
    { feature: "caffeine_mg", label: "Cut caffeine after midday", from: 200, to: 50, reliabilityGain: 0.05 },
    { feature: "bedtime_hour", label: "Go to bed earlier", from: 23.5, to: 22.5, reliabilityGain: 0.04 },
  ],
};

const INFEASIBLE: WakePlan = {
  ...BASE, targetReliability: 0.95, achievedReliability: 0.7, combinedReliability: 0.78,
  combinedPlan: [{ feature: "bedtime_hour", label: "Go to bed earlier", from: 23.5, to: 22, reliabilityGain: 0.08 }],
  habitConstraints: [
    { feature: "alarm_response_ms", label: "Answer your first alarm", from: 19000, to: 5000, reliabilityGain: 0.28, horizon: "weeks" },
    { feature: "sleep_consistency", label: "Keep a steady sleep schedule", from: 60, to: 85, reliabilityGain: 0.1, horizon: "weeks" },
  ],
};

const view = (plan: WakePlan) => textOf(<WakePlanView plan={plan} wakeTime="06:30" />);

describe("feasible: a bedtime", () => {
  it("gives the latest bedtime that still reaches the target, and how far it moves", () => {
    expect(planKind(FEASIBLE)).toBe("bedtime");
    const text = view(FEASIBLE);
    expect(text).toContain("The latest bedtime that still reaches 85%: Asleep by 22:15");
    expect(text).toContain("75 min earlier than your usual bedtime. About 7.6 h of sleep.");
    expect(text).toContain("Wake-time regularity Tonight as-is 60% With the plan 86% You asked for 85%");
    expect(text).toContain("Remind me at 22:15");
    expect(text).toContain("Set my 06:30 alarm");
    expect(text).not.toContain("isn't reachable");
    expect(forbiddenWordingIn(text)).toEqual([]);
  });

  it("says so when the usual bedtime is already enough", () => {
    expect(view({ ...FEASIBLE, shiftMinutes: 0 })).toContain("Your usual bedtime already gets you there.");
  });
});

describe("reachable with changes", () => {
  it("lists the smallest set of changes, and reminds at the bedtime they include", () => {
    expect(planKind(CHANGES)).toBe("changes");
    const text = view(CHANGES);
    expect(text).toContain("Bedtime alone tops out at 78%. The smallest set of changes that reaches 85% takes you to 87%:");
    expect(text).toContain("Cut caffeine after midday +5%");
    expect(text).toContain("Go to bed earlier +4%");
    expect(plannedBedtimeHour(CHANGES)).toBe(22.5);
    expect(text).toContain("Remind me at 22:30");
    expect(text).not.toContain("isn't reachable");
  });
});

describe("infeasible: the honest refusal", () => {
  it("refuses, gives the reachable ceiling, names the habit, and recommends a second alarm", () => {
    expect(planKind(INFEASIBLE)).toBe("unreachable");
    const text = view(INFEASIBLE);
    expect(text).toContain("95% isn't reachable tonight.");
    expect(text).toContain("The most tonight's changes can reach is 78%, 17 points short.");
    expect(text).toContain("What holds it back is a habit, not tonight: answer your first alarm would be worth +28% on its own, over weeks.");
    expect(text).toContain("Set a second alarm, ideally on another device, so one failure can't make you miss it.");
    expect(text).toContain("Add a backup alarm at 06:40");
    expect(text).toContain("The closest tonight can get Go to bed earlier +8%");
    expect(text).toContain("Tonight as-is 60% Best tonight 78% You asked for 95%");
    expect(text).not.toContain("Asleep by");
    expect(forbiddenWordingIn(text)).toEqual([]);
  });

  it("still refuses plainly when no habit explains the shortfall", () => {
    const text = view({ ...INFEASIBLE, habitConstraints: [] });
    expect(text).toContain("95% isn't reachable tonight.");
    expect(text).not.toContain("What holds it back");
    expect(text).toContain("Set a second alarm");
  });

  it("wraps the backup alarm past midnight", () => {
    expect(textOf(<WakePlanView plan={INFEASIBLE} wakeTime="23:55" />)).toContain("Add a backup alarm at 00:05");
  });
});

describe("the exact-ceiling boundary", () => {
  it("a target exactly at the ceiling is granted, not refused", () => {
    const atCeiling: WakePlan = { ...CHANGES, targetReliability: 0.87, combinedReliability: 0.87 };
    expect(planKind(atCeiling)).toBe("changes");
    const text = view(atCeiling);
    expect(text).toContain("takes you to 87%");
    expect(text).not.toContain("isn't reachable");
  });

  it("a hair above the ceiling is refused, even though both round to the same number", () => {
    // Exactly what the planner returns for a 0.84996 ceiling against 0.85
    // (ai-brain/tests/test_wake_plan_boundary.py): equal after rounding, refused.
    const justAbove: WakePlan = { ...INFEASIBLE, targetReliability: 0.85, combinedReliability: 0.85, habitConstraints: [] };
    expect(planKind(justAbove)).toBe("unreachable");
    const text = view(justAbove);
    expect(text).toContain("85% isn't reachable tonight.");
    // Never "0 points short" for a gap that only rounding hides.
    expect(text).toContain("The most tonight's changes can reach is 85%, less than 1 point short.");
  });
});
