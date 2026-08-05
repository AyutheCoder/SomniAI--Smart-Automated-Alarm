import type { RlAction, RlContext } from "@/lib/aiClient";
export type Impact = "increase" | "decrease" | "neutral";
export interface Attribution {
  feature: string;
  value: string;
  impact: Impact;
  weight: number;
  detail?: string;
}
export interface Explanation {
  summary: string;
  rationale: string;
  attributions: Attribution[];
  confidence?: number;
}
function clamp01(n: number): number {
  if (!Number.isFinite(n))
    return 0;
  return Math.max(0, Math.min(1, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
export function rankAttributions(list: Attribution[], n = 5): Attribution[] {
  const cleaned = list
    .filter((a) => a && a.feature)
    .map((a) => ({ ...a, weight: clamp01(a.weight) }));
  return cleaned.sort((a, b) => b.weight - a.weight).slice(0, n);
}
export function impactArrow(impact: Impact): string {
  return impact === "increase" ? "↑" : impact === "decrease" ? "↓" : "-";
}
export function attributionTrace(list: Attribution[], n = 3): string {
  return rankAttributions(list, n)
    .map((a) => `${a.feature} ${impactArrow(a.impact)} ${a.value}`)
    .join(", ");
}
export function makeExplanation(opts: {
  summary: string;
  rationale: string;
  attributions: Attribution[];
  confidence?: number;
  topN?: number;
}): Explanation {
  return {
    summary: opts.summary,
    rationale: opts.rationale,
    attributions: rankAttributions(opts.attributions, opts.topN ?? 5),
    confidence: opts.confidence === undefined ? undefined : round2(clamp01(opts.confidence)),
  };
}
const STRATEGY_LABEL: Record<RlAction["strategy"], string> = {
  gentle: "gentle",
  adaptive: "adaptive",
  aggressive: "aggressive",
};
function offsetPhrase(offsetMin: number): string {
  if (offsetMin < 0)
    return `${Math.abs(offsetMin)} min earlier`;
  if (offsetMin > 0)
    return `${offsetMin} min later`;
  return "at the target time";
}
export function explainRlDecision(context: RlContext, action: RlAction, opts: {
  updates?: number;
  meanReward?: number;
  source?: "ai" | "fallback";
} = {}): Explanation {
  const importance = clamp01(context.taskImportance ?? 0.5);
  const fatigue = clamp01((context.fatigueScore ?? 40) / 100);
  const sleepDebt = Math.max(0, context.sleepDebtHours ?? 0);
  const weekend = Boolean(context.isWeekend);
  const attributions: Attribution[] = [
    {
      feature: "Task importance",
      value: `${Math.round(importance * 100)}%`,
      impact: importance >= 0.55 ? "increase" : importance <= 0.4 ? "decrease" : "neutral",
      weight: 0.2 + Math.abs(importance - 0.5) * 1.6,
      detail: importance >= 0.7
        ? "High-stakes task favors an earlier, firmer wake."
        : importance <= 0.4
          ? "Low-stakes task allows a gentler wake."
          : undefined,
    },
    {
      feature: "Fatigue",
      value: `${Math.round(fatigue * 100)}%`,
      impact: fatigue >= 0.6 ? "increase" : "neutral",
      weight: fatigue >= 0.6 ? 0.5 + (fatigue - 0.6) : fatigue * 0.4,
      detail: fatigue >= 0.6
        ? "Elevated fatigue raises oversleep risk, so the wake moves earlier."
        : undefined,
    },
    {
      feature: "Day type",
      value: weekend ? "weekend" : "weekday",
      impact: weekend ? "decrease" : "neutral",
      weight: weekend ? 0.3 : 0.1,
      detail: weekend ? "Weekend mornings tolerate a softer wake." : undefined,
    }
  ];
  if (sleepDebt > 0) {
    attributions.push({
      feature: "Sleep debt",
      value: `${sleepDebt.toFixed(1)} h`,
      impact: sleepDebt >= 1 ? "increase" : "neutral",
      weight: clamp01(sleepDebt / 4) * 0.6,
      detail: sleepDebt >= 1
        ? "Accumulated sleep debt makes oversleeping more likely."
        : undefined,
    });
  }
  if (context.chronotype) {
    attributions.push({
      feature: "Chronotype",
      value: context.chronotype,
      impact: "neutral",
      weight: 0.15,
    });
  }
  const ranked = rankAttributions(attributions, 5);
  const strategy = STRATEGY_LABEL[action.strategy] ?? action.strategy;
  const offset = offsetPhrase(action.offsetMin ?? 0);
  const summary = `${strategy} wake, ${offset}`;
  const updates = Math.max(0, Math.round(opts.updates ?? 0));
  const learned = updates > 0
    ? ` Learned from ${updates} past wake${updates === 1 ? "" : "s"} (avg reward ${(opts.meanReward ?? 0).toFixed(2)}).`
    : " Using the prior policy until more outcomes are recorded.";
  const fallbackNote = opts.source === "fallback" ? " Rule-based fallback." : "";
  const rationale = `Recommending a ${strategy} strategy ${offset} at intensity ${action.intensity}.${learned}${fallbackNote} ` +
    `Driven by ${attributionTrace(ranked)}.`;
  const confidence = action.expectedReward !== undefined
    ? clamp01((action.expectedReward + 2) / 4)
    : 0.5;
  return makeExplanation({ summary, rationale, attributions: ranked, confidence });
}