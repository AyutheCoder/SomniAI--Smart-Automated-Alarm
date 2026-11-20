// What the user actually reads. Components are rendered to HTML and checked
// as text: the regularity wording, an origin and a plain-words confidence on
// every prediction, and none of the forbidden wording (lib/predictionCopy.ts).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InsightsView, type Insights } from "@/app/_components/InsightsPanel";
import { ProposalList } from "@/app/_components/SmartSchedulePanel";
import { WakePlanView } from "@/app/_components/WakePlanPanel";
import { buildInsights, type WakePlan } from "@/lib/aiClient";
import { computeMetrics } from "@/lib/features";
import { forbiddenWordingIn } from "@/lib/predictionCopy";
import { proposeAlarmsFromTasks } from "@/lib/scheduler";
import { buildWeeklyReport } from "@/lib/weekly";

/** Visible text of a rendered element: tags removed, entities decoded, spaces collapsed. */
function textOf(element: React.ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function insights(over: Partial<Insights> = {}): Insights {
  return {
    sleepScore: 6.4,
    subScores: { duration: 70, consistency: 55, behavior: 60 },
    recommendations: [],
    prediction: {
      predictedSleepDuration: 7.1,
      wakeupConsistency: 62,
      wakeSuccessProbability: 0.58,
      oversleepProbability: 0.42,
      confidence: 0.4,
    },
    reportSource: "fallback",
    predictionSource: "fallback",
    recentSleepHours: 7,
    sleepGoalHours: 8,
    ...over,
  };
}

beforeEach(() => {
  // No AI Brain anywhere in these tests: the fallback paths must run.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests"); }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the insights panel", () => {
  it("calls the prediction wake-time regularity and says what that means", () => {
    const text = textOf(<InsightsView insights={insights()} />);
    expect(text).toContain("Wake-time regularity 58%");
    expect(text).toContain("Chance you wake close to your usual time. It says nothing about how the morning went.");
    expect(forbiddenWordingIn(text)).toEqual([]);
  });

  it("labels fallback predictions as fallback rules with no made-up number", () => {
    const text = textOf(<InsightsView insights={insights()} />);
    expect(text).toContain("Predictions from Fallback rules · rough estimate .");
    expect(text).toContain("Worked out from simple rules, not a trained model.");
    expect(text).not.toMatch(/40%/);
  });

  it.each([
    [0.83, "higher confidence", "The model puts 83% on this answer."],
    [0.67, "moderate confidence", "The model puts 67% on this answer."],
    [0.55, "low confidence", "The model puts 55% on this answer."],
  ])("states the AI Brain's confidence %s in words", (confidence, label, detail) => {
    const text = textOf(<InsightsView insights={insights({
      predictionSource: "ai",
      prediction: { ...insights().prediction, confidence },
    })} />);
    expect(text).toContain(`Predictions from AI Brain · ${label} .`);
    expect(text).toContain(detail);
    expect(text).toContain("only modestly better than chance");
  });

  it("names predictions and coaching separately when they came from different places", () => {
    // The old single badge said "AI Brain" for both if either was.
    const text = textOf(<InsightsView insights={insights({ predictionSource: "ai", reportSource: "fallback" })} />);
    expect(text).toContain("Predictions from AI Brain");
    expect(text).toContain("Coaching from Fallback rules · rule-based advice");
  });

  it("with nothing to suggest, makes no claim that all is well", () => {
    const text = textOf(<InsightsView insights={insights()} />);
    expect(text).toContain("No suggestions from the data you've logged.");
  });
});

describe("coaching text from the fallback rules", () => {
  // Inputs that fire every rule in turn, so every sentence gets rendered.
  const CASES = [
    { name: "short sleep, irregular, tired, snoozing, disrupted", hours: 5, metrics: { sleepConsistencyScore: 30, fatigueScore: 80, wakeResistanceIndex: 70, sleepDisruptionScore: 70, nights: 10 }, regularity: 0.2 },
    { name: "long sleep", hours: 10.5, metrics: { sleepConsistencyScore: 70, nights: 10 }, regularity: 0.5 },
    { name: "regular and steady", hours: 7.5, metrics: { sleepConsistencyScore: 80, nights: 10 }, regularity: 0.9 },
    { name: "nothing firing", hours: 7.5, metrics: { sleepConsistencyScore: 65, nights: 10 }, regularity: 0.6 },
    { name: "no data yet", hours: 7.5, metrics: { sleepConsistencyScore: 65, nights: 0 }, regularity: 0.6 },
  ];

  it.each(CASES)("$name: renders without forbidden wording", async ({ hours, metrics, regularity }) => {
    const base = computeMetrics([], []);
    const result = await buildInsights({
      features: { sleep_consistency: metrics.sleepConsistencyScore, snooze_count: 0 },
      metrics: { ...base, ...metrics, wakeSuccessProbability: regularity, oversleepProbability: 1 - regularity },
      recentSleepHours: hours,
      sleepGoalHours: 8,
    });
    expect(result.reportSource).toBe("fallback");
    const text = textOf(<InsightsView insights={{ ...result, recentSleepHours: hours, sleepGoalHours: 8 }} />);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(forbiddenWordingIn(text)).toEqual([]);
  });

  it("speaks of drift from the usual time, not oversleeping, when regularity is low", async () => {
    // Features that drive the fallback regularity prediction far down, so the
    // low-regularity advice must fire.
    const result = await buildInsights({
      features: { sleep_consistency: 0, snooze_count: 6, alarm_response_ms: 60_000, stress_level: 100, sleep_debt_hours: 4 },
      metrics: { ...computeMetrics([], []), nights: 10 },
      recentSleepHours: 7.5,
      sleepGoalHours: 8,
    });
    expect(result.prediction.oversleepProbability).toBeGreaterThan(0.7);
    const texts = result.recommendations.map((r) => `${r.text} ${r.basis}`).join(" ");
    expect(texts).toContain("Your next wake time is likely to drift from your usual one.");
    expect(texts).toContain("low predicted wake-time regularity");
    expect(forbiddenWordingIn(texts)).toEqual([]);
  });
});

describe("the scheduler's proposals", () => {
  function tomorrow() {
    const d = new Date(Date.now() + 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const plans = proposeAlarmsFromTasks(
    [{ _id: "t1", title: "Final exam", priority: "critical", dueDate: tomorrow(), dueTime: "09:00", completed: false }],
    { chronotype: "intermediate", sleepGoalHours: 8, preferredWakeWindowMin: 30, defaultWakeStrategy: "adaptive", verificationRequired: true },
    // A high chance of waking off the usual time, so the risk wording is produced.
    { predictedSleepDuration: 6, wakeupConsistency: 0.4, oversleepProbability: 0.9, wakeSuccessProbability: 0.1 },
  );
  // As the panel receives them: JSON from the API.
  const proposals = JSON.parse(JSON.stringify(plans));

  it("show the score as a rule of thumb out of 100, not a confidence", () => {
    expect(plans).toHaveLength(1);
    const text = textOf(<ProposalList proposals={proposals} />);
    expect(text).toMatch(/rule-of-thumb score \d+\/100/);
    expect(text).not.toMatch(/% confidence/);
  });

  it("explain a firmer alarm by the chance of waking off the usual time", () => {
    const text = textOf(<ProposalList proposals={proposals} />);
    expect(text).toContain("because the chance of waking off your usual time is 90%");
    expect(text).toContain("Off-schedule wake chance");
    expect(forbiddenWordingIn(text)).toEqual([]);
  });
});

describe("the wake planner", () => {
  const plan: WakePlan = {
    feasible: true, reachesTarget: true, targetReliability: 0.85, baselineReliability: 0.7,
    achievedReliability: 0.86, combinedReliability: 0.86, recommendedBedtime: "22:30",
    recommendedBedtimeHour: 22.5, currentBedtimeHour: 23.5, shiftMinutes: -60, predictedSleepHours: 7.4,
    combinedPlan: [], habitConstraints: [], levers: [], reliabilityCurve: [],
    summary: "Asleep by 22:30 - about 60 min earlier than your usual - reaches 86% wake-time regularity.",
  };

  it("says the plan is the AI Brain's estimate and what its percentages mean", () => {
    const text = textOf(<WakePlanView plan={plan} wakeTime="06:30" />);
    expect(text).toContain("Plan from AI Brain · model estimate .");
    expect(text).toContain("The percentages are the chance you wake close to your usual time.");
    expect(text).toContain("Wake-time regularity Tonight as-is 70%");
    expect(forbiddenWordingIn(text)).toEqual([]);
  });
});

describe("the weekly report", () => {
  it.each([
    ["an improving week", [6, 6, 6, 6, 8, 8, 8], 0],
    ["a worsening week", [8, 8, 8, 8, 5, 5, 5], 4],
    ["a short week", [5, 5, 5, 5, 5, 5, 5], 3],
    ["a solid week", [8, 8, 8, 8, 8, 8, 8], 0],
  ])("%s: insights carry no forbidden wording", (_name, hours, snoozes) => {
    const now = new Date();
    const logs = hours.map((h, i) => {
      const d = new Date(now.getTime() - (i + 1) * 86_400_000);
      return { date: d.toISOString().slice(0, 10), durationHours: h, snoozeCount: snoozes, wakeConfidence: 70 };
    });
    const report = buildWeeklyReport(logs, [], now);
    const text = report.insights.map((i) => `${i.text} ${i.basis ?? ""}`).join(" ");
    expect(forbiddenWordingIn(text)).toEqual([]);
  });
});

describe("every user-facing sentence in the source", () => {
  // Rendering covers what the tests above can reach; this covers the rest:
  // every string literal and JSX text with a space in it (so a sentence, not
  // an identifier or a path like /predict/wake-success), in the app, the
  // libraries and the Brain's own coaching and planner text.
  const ROOT = process.cwd();
  const walk = (dir: string): string[] =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
  const files = [...walk("app"), ...walk("lib"), "ai-brain/recommend.py", "ai-brain/wake_plan.py"]
    .filter((f) => !f.replace(/\\/g, "/").endsWith("lib/predictionCopy.ts"));

  function sentences(source: string, python: boolean): string[] {
    const code = python
      ? source.replace(/^\s*#.*$/gm, "").replace(/"""[\s\S]*?"""/g, "")
      : source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const literals = code.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
    const jsxText = python ? [] : (code.match(/>[^<>{}\n]*[A-Za-z][^<>{}\n]*</g) ?? []);
    // Code inside a template's ${...} (variable names like oversleepPct) is not text.
    return [...literals, ...jsxText]
      .map((s) => s.replace(/\$\{[^}]*\}/g, "…"))
      .filter((s) => /\s/.test(s.trim().slice(1, -1)));
  }

  it.each(files)("%s", (file) => {
    const found = sentences(readFileSync(join(ROOT, file), "utf8"), file.endsWith(".py"))
      .flatMap((s) => forbiddenWordingIn(s).map((rule) => `${rule}: ${s.slice(0, 90)}`));
    expect(found).toEqual([]);
  });
});
