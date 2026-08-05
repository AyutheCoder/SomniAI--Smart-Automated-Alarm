import type { BehavioralMetrics } from "@/lib/features";
const AI_BRAIN_URL = process.env.AI_BRAIN_URL?.replace(/\/+$/, "") ?? "";
const TIMEOUT_MS = 4000;
export type AISource = "ai" | "fallback";
export type ModelFeatures = Record<string, number>;
export interface SleepPrediction {
  predictedSleepDuration: number;
  wakeupConsistency: number;
  confidence: number;
}
export interface WakePrediction {
  wakeSuccessProbability: number;
  oversleepProbability: number;
  confidence: number;
}
export interface Recommendation {
  text: string;
  priority: "low" | "medium" | "high";
  icon?: string;
  basis?: string;
}
export interface SleepReport {
  sleepScore: number;
  subScores: {
    duration: number;
    consistency: number;
    behavior: number;
  };
  basisDurationHours?: number;
  recommendations: Recommendation[];
}
export interface InsightsInput {
  features: ModelFeatures;
  metrics: BehavioralMetrics;
  recentSleepHours?: number | null;
  sleepGoalHours?: number;
}
export interface Insights {
  sleepScore: number;
  subScores: {
    duration: number;
    consistency: number;
    behavior: number;
  };
  recommendations: Recommendation[];
  prediction: SleepPrediction & WakePrediction;
  reportSource: AISource;
  predictionSource: AISource;
}
export type SemanticPriority = "low" | "medium" | "high" | "critical";
export type SemanticIntent = "must-not-miss" | "routine" | "casual" | "procrastination-risk";
export type SemanticEmotion = "stress" | "fatigue" | "motivation" | "calm" | "neutral";
export interface SemanticAnalysis {
  importanceScore: number;
  suggestedPriority: SemanticPriority;
  intent: SemanticIntent;
  emotion: SemanticEmotion;
  stressScore: number;
  wakeReliabilityNeed: "low" | "medium" | "high";
  rationale: string;
  tier: string;
}
async function postJson<T>(path: string, body: unknown): Promise<T | null> {
  if (!AI_BRAIN_URL)
    return null;
  try {
    const res = await fetch(`${AI_BRAIN_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok)
      return null;
    return (await res.json()) as T;
  }
  catch (e) {
    return null;
  }
}
export async function aiBrainHealth(): Promise<boolean> {
  if (!AI_BRAIN_URL)
    return false;
  try {
    const res = await fetch(`${AI_BRAIN_URL}/health`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    return res.ok;
  }
  catch (e) {
    return false;
  }
}
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const num = (v: unknown, d: number) => typeof v === "number" && Number.isFinite(v) ? v : d;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
// Kept in step with ai-brain/recommend.py. The wake-success model is calibrated
// against a ~50% base rate, so oversleep probability has its median at 0.47 -
// a `> 0.5` alert fired on 46.7% of nights. 0.70 is the 75th percentile, and
// 0.75 wake reliability is roughly the top quartile on the other side.
const OVERSLEEP_ALERT = 0.70;
const WAKE_RELIABLE = 0.75;

const PRIORITY_WEIGHT: Record<Recommendation["priority"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};
function fallbackSleep(f: ModelFeatures): SleepPrediction {
  const debt = num(f.sleep_debt_hours, 0.5);
  const screen = num(f.screen_minutes_before_bed, 45);
  const stress = num(f.stress_level, 40);
  const caffeine = num(f.caffeine_mg, 80);
  const bedtime = num(f.bedtime_hour, 23);
  const exercise = num(f.exercise_minutes, 30);
  const noise = num(f.ambient_noise_db, 35);
  const lateBed = Math.max(0, bedtime - 23);
  const loud = Math.max(0, noise - 35);
  const duration = clamp(8.3 -
    debt * 0.45 -
    screen / 240 -
    stress / 220 -
    caffeine / 500 -
    lateBed * 0.25 +
    exercise / 300 -
    loud / 80, 4, 10);
  return {
    predictedSleepDuration: r2(duration),
    wakeupConsistency: r1(clamp(num(f.sleep_consistency, 60), 0, 100)),
    confidence: 0.4,
  };
}
function fallbackWake(f: ModelFeatures): WakePrediction {
  const consistency = num(f.sleep_consistency, 60);
  const snooze = num(f.snooze_count, 1);
  const response = num(f.alarm_response_ms, 8000);
  const stress = num(f.stress_level, 40);
  const exercise = num(f.exercise_minutes, 30);
  const dur = fallbackSleep(f).predictedSleepDuration;
  const logit = -1.1 +
    (consistency - 50) / 20 +
    (dur - 6.5) -
    snooze * 0.35 -
    (response / 30000) * 1.5 -
    stress / 80 +
    exercise / 120;
  const p = clamp(1 / (1 + Math.exp(-logit)));
  return {
    wakeSuccessProbability: r3(p),
    oversleepProbability: r3(1 - p),
    confidence: 0.4,
  };
}
function durationSubscore(hours: number): number {
  if (hours <= 0)
    return 0.5;
  if (hours >= 7 && hours <= 9)
    return 1;
  const edge = hours < 7 ? 7 : 9;
  return clamp(1 - Math.abs(hours - edge) / 3);
}
interface ReportPayload {
  metrics: BehavioralMetrics;
  recentSleepHours?: number | null;
  predictedSleepDuration?: number | null;
  sleepGoalHours?: number;
  oversleepProbability?: number;
  wakeSuccessProbability?: number;
}
function fallbackReport(p: ReportPayload): SleepReport {
  const m = p.metrics;
  const goal = num(p.sleepGoalHours, 8);
  const durationHours = num(p.recentSleepHours ?? p.predictedSleepDuration ?? goal, goal);
  const consistency = clamp(num(m.sleepConsistencyScore, 50) / 100);
  const wakeEff = clamp(num(m.wakeEfficiencyScore, 60) / 100);
  const fatigue = clamp(num(m.fatigueScore, 40) / 100);
  const resistance = clamp(num(m.wakeResistanceIndex, 30) / 100);
  const durationSub = durationSubscore(durationHours);
  const behaviorSub = clamp(0.5 * wakeEff + 0.3 * (1 - fatigue) + 0.2 * (1 - resistance));
  const score10 = 10 * (0.4 * durationSub + 0.3 * consistency + 0.3 * behaviorSub);
  const oversleep = num(p.oversleepProbability, num(m.oversleepProbability, 0.3));
  const wakeSuccess = num(p.wakeSuccessProbability, num(m.wakeSuccessProbability, 0.7));
  const tips: Recommendation[] = [];
  if (durationHours < 6.5) {
    tips.push({
      text: `You're averaging about ${durationHours.toFixed(1)} h of sleep. Aim for 7-9 h with an earlier wind-down.`,
      priority: "high",
      icon: "moon",
      basis: "short sleep duration",
    });
  }
  else if (durationHours > 9.5) {
    tips.push({
      text: `You're sleeping about ${durationHours.toFixed(1)} h. Consistently long sleep can signal sleep debt or low quality.`,
      priority: "low",
      icon: "moon",
      basis: "long sleep duration",
    });
  }
  if (num(m.sleepConsistencyScore, 50) < 50) {
    tips.push({
      text: "Your sleep timing varies a lot. Keep bedtime and wake time within +/-30 min, even on weekends.",
      priority: "high",
      icon: "repeat",
      basis: "low sleep consistency",
    });
  }
  if (oversleep > OVERSLEEP_ALERT) {
    tips.push({
      text: "Elevated oversleep risk for your next wake. Enable verification and a backup escalation level.",
      priority: "high",
      icon: "alert-triangle",
      basis: "high oversleep probability",
    });
  }
  if (num(m.fatigueScore, 40) > 60) {
    tips.push({
      text: "High fatigue detected. Cut caffeine after midday and reduce evening screen time.",
      priority: "medium",
      icon: "battery-low",
      basis: "high fatigue score",
    });
  }
  if (num(m.wakeResistanceIndex, 30) > 50) {
    tips.push({
      text: "You snooze often. Place the alarm across the room or require a wake challenge to dismiss it.",
      priority: "medium",
      icon: "alarm-clock",
      basis: "high wake resistance",
    });
  }
  if (num(m.sleepDisruptionScore, 30) > 55) {
    tips.push({
      text: "Nighttime noise or movement is disrupting your sleep. Aim for a quieter, cooler, darker room.",
      priority: "medium",
      icon: "volume-x",
      basis: "high sleep disruption",
    });
  }
  if (wakeSuccess >= WAKE_RELIABLE && num(m.sleepConsistencyScore, 50) >= 60) {
    tips.push({
      text: "Great wake reliability and steady timing - keep your current routine going.",
      priority: "low",
      icon: "check",
      basis: "strong wake success",
    });
  }
  if (tips.length === 0) {
    // Mirrors recommend.py: no rule firing means either no data yet, or a user
    // whose routine is simply fine. Only the former is "insufficient data".
    if (num(m.nights, 0) < 3) {
      tips.push({
        text: "Log a few nights of sleep to unlock personalized coaching.",
        priority: "low",
        icon: "info",
        basis: "insufficient data",
      });
    }
    else {
      tips.push({
        text: "Nothing needs attention - your sleep and wake routine are on track.",
        priority: "low",
        icon: "check",
        basis: "all metrics within target",
      });
    }
  }
  tips.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
  return {
    sleepScore: r1(score10),
    subScores: {
      duration: Math.round(durationSub * 100),
      consistency: Math.round(consistency * 100),
      behavior: Math.round(behaviorSub * 100),
    },
    basisDurationHours: r2(durationHours),
    recommendations: tips.slice(0, 5),
  };
}
export async function predictSleep(features: ModelFeatures): Promise<{
  data: SleepPrediction;
  source: AISource;
}> {
  const ai = await postJson<SleepPrediction>("/predict/sleep", { features });
  if (ai && typeof ai.predictedSleepDuration === "number") {
    return { data: ai, source: "ai" };
  }
  return { data: fallbackSleep(features), source: "fallback" };
}
export async function predictWakeSuccess(features: ModelFeatures): Promise<{
  data: WakePrediction;
  source: AISource;
}> {
  const ai = await postJson<WakePrediction>("/predict/wake-success", {
    features,
  });
  if (ai && typeof ai.wakeSuccessProbability === "number") {
    return { data: ai, source: "ai" };
  }
  return { data: fallbackWake(features), source: "fallback" };
}
export interface WakePlanStep {
  feature: string;
  label: string;
  from: number;
  to: number;
  reliabilityGain: number;
  horizon?: string;
}
export interface WakePlan {
  feasible: boolean;
  reachesTarget: boolean;
  targetReliability: number;
  baselineReliability: number;
  achievedReliability: number;
  combinedReliability: number;
  recommendedBedtime: string | null;
  recommendedBedtimeHour: number | null;
  currentBedtimeHour: number;
  shiftMinutes: number | null;
  predictedSleepHours: number | null;
  combinedPlan: WakePlanStep[];
  habitConstraints: WakePlanStep[];
  levers: WakePlanStep[];
  reliabilityCurve: { bedtimeHour: number; reliability: number }[];
  summary: string;
}

/**
 * Ask the brain to invert its own model: the latest bedtime that still meets a
 * required wake reliability. There is no local fallback - a rule of thumb would
 * be guessing at a number the user is about to plan a flight around, so the
 * caller is told plainly when the planner is unavailable.
 */
export async function planWake(payload: {
  features: ModelFeatures;
  requiredReliability: number;
  wakeTime?: string;
  minSleepHours?: number;
}): Promise<{ data: WakePlan | null; source: AISource }> {
  const ai = await postJson<WakePlan>("/plan/wake", payload);
  if (ai && typeof ai.baselineReliability === "number") {
    return { data: ai, source: "ai" };
  }
  return { data: null, source: "fallback" };
}

export async function getSleepReport(payload: ReportPayload): Promise<{
  data: SleepReport;
  source: AISource;
}> {
  const ai = await postJson<SleepReport>("/recommend", payload);
  if (ai && typeof ai.sleepScore === "number" && Array.isArray(ai.recommendations)) {
    return { data: ai, source: "ai" };
  }
  return { data: fallbackReport(payload), source: "fallback" };
}
export async function buildInsights(input: InsightsInput): Promise<Insights> {
  const [sleep, wake] = await Promise.all([
    predictSleep(input.features),
    predictWakeSuccess(input.features),
  ]);
  const report = await getSleepReport({
    metrics: input.metrics,
    recentSleepHours: input.recentSleepHours ?? null,
    predictedSleepDuration: sleep.data.predictedSleepDuration,
    sleepGoalHours: input.sleepGoalHours ?? 8,
    oversleepProbability: wake.data.oversleepProbability,
    wakeSuccessProbability: wake.data.wakeSuccessProbability,
  });
  return {
    sleepScore: report.data.sleepScore,
    subScores: report.data.subScores,
    recommendations: report.data.recommendations,
    prediction: { ...sleep.data, ...wake.data },
    reportSource: report.source,
    predictionSource: sleep.source === "ai" && wake.source === "ai" ? "ai" : "fallback",
  };
}
const SEM_IMPORTANCE_CUES: Record<string, number> = {
  exam: 0.95, final: 0.9, midterm: 0.85, interview: 0.95, flight: 0.95,
  deadline: 0.85, submission: 0.8, submit: 0.8, due: 0.55, test: 0.7,
  quiz: 0.55, assignment: 0.6, presentation: 0.8, meeting: 0.6,
  appointment: 0.65, doctor: 0.7, surgery: 0.95, court: 0.95, wedding: 0.8,
  boarding: 0.95, train: 0.7, urgent: 0.9, important: 0.7, critical: 0.95,
  asap: 0.85, must: 0.7, mandatory: 0.85, board: 0.7, viva: 0.9, defense: 0.9,
  launch: 0.75, release: 0.7, payment: 0.6, bill: 0.5, renew: 0.5,
  registration: 0.6,
};
const SEM_TIME_CUES: Record<string, number> = {
  tonight: 0.2, tomorrow: 0.18, today: 0.15, morning: 0.1, early: 0.12,
  "in an hour": 0.25, "right now": 0.3, "first thing": 0.15, am: 0.05,
};
const SEM_EMOTION_CUES: Record<SemanticEmotion, string[]> = {
  stress: ["stressed", "anxious", "nervous", "overwhelmed", "pressure", "panic",
    "worried", "scared", "dread", "tense"],
  fatigue: ["exhausted", "tired", "sleepy", "drained", "burned out", "burnt out",
    "no energy", "fatigued", "worn out"],
  motivation: ["excited", "motivated", "ready", "pumped", "confident",
    "looking forward", "energized"],
  calm: ["relaxed", "chill", "easy", "casual", "no rush", "whenever", "laid back"],
  neutral: [],
};
const SEM_MUST_NOT_MISS = ["can't miss", "cannot miss", "must not miss",
  "don't miss", "have to", "no matter what", "absolutely", "non-negotiable"];
const SEM_CASUAL = ["maybe", "sometime", "whenever", "optional", "if i can",
  "no rush", "might", "eventually"];
const SEM_PROCRASTINATION = ["later", "postpone", "putting off", "put off",
  "keep delaying", "procrastinate", "been meaning", "still haven't"];
function semPriority(score: number): SemanticPriority {
  if (score >= 80)
    return "critical";
  if (score >= 60)
    return "high";
  if (score >= 35)
    return "medium";
  return "low";
}
export function fallbackSemantic(text: string): SemanticAnalysis {
  const raw = (text ?? "").trim();
  if (!raw) {
    return {
      importanceScore: 0,
      suggestedPriority: "low",
      intent: "routine",
      emotion: "neutral",
      stressScore: 0,
      wakeReliabilityNeed: "low",
      rationale: "Empty text",
      tier: "rules",
    };
  }
  const low = raw.toLowerCase();
  const cues: string[] = [];
  let imp = 0;
  let matched = 0;
  for (const [kw, w] of Object.entries(SEM_IMPORTANCE_CUES)) {
    if (new RegExp(`\\b${kw}\\b`).test(low)) {
      imp = Math.max(imp, w) + 0.12 * matched;
      matched += 1;
      cues.push(kw);
    }
  }
  let importance = matched ? imp * 100 : 18;
  for (const [kw, w] of Object.entries(SEM_TIME_CUES)) {
    if (low.includes(kw)) {
      importance += w * 100;
      cues.push(kw);
      break;
    }
  }
  if (raw.includes("!")) {
    importance += 6;
    cues.push("emphatic '!'");
  }
  if (/\b[A-Z]{3,}\b/.test(raw)) {
    importance += 6;
    cues.push("ALL-CAPS");
  }
  if (/\b(very|really|so|extremely)\b/.test(low))
    importance += 4;
  importance = clamp(importance, 0, 100);
  let emotion: SemanticEmotion = "neutral";
  const emoHits: Partial<Record<SemanticEmotion, number>> = {};
  (Object.keys(SEM_EMOTION_CUES) as SemanticEmotion[]).forEach((cat) => {
    const hits = SEM_EMOTION_CUES[cat].filter((w) => low.includes(w)).length;
    if (hits)
      emoHits[cat] = hits;
  });
  const emoKeys = Object.keys(emoHits) as SemanticEmotion[];
  if (emoKeys.length) {
    emotion = emoKeys.reduce((a, b) => ((emoHits[b] ?? 0) > (emoHits[a] ?? 0) ? b : a));
    cues.push(`emotion:${emotion}`);
  }
  let stress = 55 * (emoHits.stress ?? 0) +
    35 * (emoHits.fatigue ?? 0) -
    15 * (emoHits.motivation ?? 0);
  stress = clamp(stress, 0, 100);
  let intent: SemanticIntent;
  if (SEM_MUST_NOT_MISS.some((p) => low.includes(p)) || importance >= 75) {
    intent = "must-not-miss";
  }
  else if (SEM_PROCRASTINATION.some((p) => low.includes(p))) {
    intent = "procrastination-risk";
  }
  else if (SEM_CASUAL.some((p) => low.includes(p))) {
    intent = "casual";
  }
  else {
    intent = "routine";
  }
  importance = Math.round(importance);
  const wakeReliabilityNeed = importance >= 70 || intent === "must-not-miss"
    ? "high"
    : importance >= 40
      ? "medium"
      : "low";
  return {
    importanceScore: importance,
    suggestedPriority: semPriority(importance),
    intent,
    emotion,
    stressScore: Math.round(stress),
    wakeReliabilityNeed,
    rationale: cues.length
      ? `Detected ${cues.slice(0, 5).join(", ")}`
      : "No strong urgency or emotion cues; treated as routine",
    tier: "rules",
  };
}
export async function analyzeSemantic(text: string): Promise<{
  data: SemanticAnalysis;
  source: AISource;
}> {
  const ai = await postJson<SemanticAnalysis>("/semantic/analyze", { text });
  if (ai && typeof ai.importanceScore === "number" && ai.suggestedPriority) {
    return { data: ai, source: "ai" };
  }
  return { data: fallbackSemantic(text), source: "fallback" };
}
export type FeedbackOutcome = "success" | "snooze" | "missed";
export type RlPolicyState = Record<string, unknown>;
export interface AIContext {
  chronotype?: "lark" | "intermediate" | "owl";
  fatigueScore?: number;
  taskImportance?: number;
  sleepDebtHours?: number;
  isWeekend?: boolean;
}
export interface RlContext {
  chronotype?: "lark" | "intermediate" | "owl";
  fatigueScore?: number;
  taskImportance?: number;
  sleepDebtHours?: number;
  isWeekend?: boolean;
}
export interface RlAction {
  offsetMin: number;
  strategy: "gentle" | "adaptive" | "aggressive";
  intensity: number;
  aggressiveness?: number;
  expectedReward?: number;
}
export interface RlPolicySummary {
  updates: number;
  meanReward: number;
  preferredAction: RlAction;
  mostUsedAction: RlAction;
  explored: number;
  totalArms: number;
}
export interface RlUpdateInput {
  policy?: RlPolicyState | null;
  context: RlContext;
  action: Partial<RlAction>;
  outcome: FeedbackOutcome;
  snoozes?: number;
  ttwMin?: number;
  satisfaction?: number;
  reward?: number;
}
export interface RlUpdateResult {
  policy: RlPolicyState;
  reward: number;
  recommendedAction: RlAction;
  summary: RlPolicySummary;
}
const STRATEGY_INTENSITY: Record<RlAction["strategy"], number> = {
  gentle: 40,
  adaptive: 70,
  aggressive: 100,
};
const STRATEGY_IDX: Record<RlAction["strategy"], number> = {
  gentle: 0,
  adaptive: 1,
  aggressive: 2,
};
function rlAggressiveness(action: Partial<RlAction>): number {
  const intensity = clamp(num(action.intensity, 70) / 100);
  const strat = (action.strategy ?? "adaptive") as RlAction["strategy"];
  const stratIdx = (STRATEGY_IDX[strat] ?? 1) / 2;
  const early = clamp(Math.abs(num(action.offsetMin, 0)) / 30);
  return clamp(0.55 * intensity + 0.3 * stratIdx + 0.15 * early);
}
export function fallbackReward(input: RlUpdateInput): number {
  if (typeof input.reward === "number" && Number.isFinite(input.reward)) {
    return Math.round(Math.max(-2, Math.min(2, input.reward)) * 1e4) / 1e4;
  }
  const woke = input.outcome === "missed" ? 0 : 1;
  const r = 1.0 * woke -
    0.3 * Math.max(0, num(input.snoozes, 0)) -
    0.02 * Math.max(0, num(input.ttwMin, 0)) -
    0.3 * rlAggressiveness(input.action) +
    0.5 * clamp(num(input.satisfaction, 0), -1, 1);
  return Math.round(Math.max(-2, Math.min(2, r)) * 1e4) / 1e4;
}
function fallbackRlUpdate(input: RlUpdateInput): RlUpdateResult {
  const reward = fallbackReward(input);
  const importance = clamp(num(input.context.taskImportance, 0.5));
  const fatigue = clamp(num(input.context.fatigueScore, 40) / 100);
  const strategy: RlAction["strategy"] = importance >= 0.7 ? "aggressive" : importance >= 0.4 ? "adaptive" : "gentle";
  const offsetMin = importance >= 0.7 || fatigue >= 0.6 ? -10 : 0;
  const recommendedAction: RlAction = {
    offsetMin,
    strategy,
    intensity: STRATEGY_INTENSITY[strategy],
    aggressiveness: Math.round(rlAggressiveness({ offsetMin, strategy, intensity: STRATEGY_INTENSITY[strategy] }) * 1000) / 1000,
  };
  const prev = (input.policy ?? {}) as {
    n?: number;
    rewardSum?: number;
  };
  const updates = num(prev.n, 0) + 1;
  const rewardSum = num(prev.rewardSum, 0) + reward;
  const policy: RlPolicyState = {
    ...(input.policy ?? {}),
    kind: "heuristic",
    n: updates,
    rewardSum,
  };
  return {
    policy,
    reward,
    recommendedAction,
    summary: {
      updates,
      meanReward: Math.round((rewardSum / updates) * 1e4) / 1e4,
      preferredAction: recommendedAction,
      mostUsedAction: recommendedAction,
      explored: 1,
      totalArms: 9,
    },
  };
}
export async function rlUpdate(input: RlUpdateInput): Promise<{
  data: RlUpdateResult;
  source: AISource;
}> {
  const ai = await postJson<RlUpdateResult>("/rl/update", input);
  if (ai && ai.policy && ai.recommendedAction && ai.summary) {
    return { data: ai, source: "ai" };
  }
  return { data: fallbackRlUpdate(input), source: "fallback" };
}