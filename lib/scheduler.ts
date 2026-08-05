import type { WakeStrategy } from "@/models/Alarm";
import type { Priority } from "@/models/Task";
import { makeExplanation, type Attribution, type Explanation } from "@/lib/explain";
const PRIORITY_WEIGHT: Record<Priority, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 1,
};
const CHRONO_WAKE_HOUR: Record<string, number> = {
  lark: 6,
  intermediate: 7,
  owl: 8,
};
/** Oversleep probability above which an alarm gets hardened. See usage below. */
const RISK_BUMP_THRESHOLD = 0.65;
const MORNING_CUTOFF_HOUR = 12;
const DEDUPE_WINDOW_MIN = 30;
const DEFAULT_HORIZON_DAYS = 7;
const MIN_LEAD_MIN = 5;
const MS_PER_MIN = 60000;
const VERIFICATION_ENUM = ["math", "typing", "tap", "none"] as const;
type VerificationMethod = (typeof VERIFICATION_ENUM)[number];
export interface SchedulableTask {
  _id: string;
  title: string;
  description?: string;
  dueDate?: string;
  dueTime?: string;
  category?: string;
  priority: Priority;
  aiPriority?: Priority;
  importanceScore?: number;
  intent?: "must-not-miss" | "routine" | "casual" | "procrastination-risk";
  emotion?: "stress" | "fatigue" | "motivation" | "calm" | "neutral";
  completed: boolean;
}
export interface SchedulerPrediction {
  predictedSleepDuration: number;
  wakeupConsistency: number;
  oversleepProbability: number;
  wakeSuccessProbability: number;
}
export interface SchedulerProfile {
  chronotype?: string;
  sleepGoalHours: number;
  preferredWakeWindowMin: number;
  defaultWakeStrategy: WakeStrategy;
  verificationRequired: boolean;
}
export interface ExistingAlarmLite {
  scheduledTime: string | Date;
  enabled: boolean;
  linkedTaskId?: string;
}
/** Why a task the user created did not become an alarm. */
export type SkipReason =
  | "no-due-date"
  | "unreadable-date"
  | "beyond-horizon"
  | "already-has-alarm"
  | "not-morning-and-low-priority"
  | "too-soon"
  | "collides-with-existing";

export interface SkippedTask {
  taskId: string;
  title: string;
  reason: SkipReason;
}

/** What to tell the user about each skip, in their words. */
export const SKIP_EXPLANATIONS: Record<SkipReason, string> = {
  "no-due-date": "no due date, so there's nothing to wake you for",
  "unreadable-date": "the due date could not be read",
  "beyond-horizon": "due further out than the scheduling window",
  "already-has-alarm": "already has an alarm",
  "not-morning-and-low-priority": "not a morning task, and not important enough to need one",
  "too-soon": "starts too soon to schedule a wake in front of it",
  "collides-with-existing": "clashes with an alarm you already have",
};

export interface SchedulerOptions {
  now?: Date;
  horizonDays?: number;
  source?: "assisted" | "autonomous";
  /** Optional collector: populated with every task that was passed over. */
  skipped?: SkippedTask[];
}
export interface AlarmFactor {
  label: string;
  value: string;
}
export interface AlarmPlan {
  label: string;
  scheduledTime: string;
  source: "assisted" | "autonomous";
  linkedTaskId?: string;
  taskTitle?: string;
  intensity: number;
  wakeStrategy: WakeStrategy;
  verificationRequired: boolean;
  verificationMethod: VerificationMethod;
  verificationMethods: string[];
  minConfidence: number;
  repeat: {
    type: "none" | "daily" | "weekdays" | "custom";
    days?: number[];
  };
  smartWakeWindowMin: number;
  rationale: string;
  factors: AlarmFactor[];
  explanation: Explanation;
  confidence: number;
}
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
export function taskImportance(task: SchedulableTask): {
  score: number;
  label: string;
} {
  const base = PRIORITY_WEIGHT[task.priority] ?? 0.5;
  const ai = task.aiPriority ? PRIORITY_WEIGHT[task.aiPriority] : base;
  const weight = Math.max(base, ai);
  const fromScore = typeof task.importanceScore === "number"
    ? clamp(task.importanceScore / 100, 0, 1)
    : weight;
  let score = clamp(weight * 0.6 + fromScore * 0.4, 0, 1);
  if (task.intent === "must-not-miss")
    score = Math.max(score, 0.75);
  else if (task.intent === "casual")
    score = Math.min(score, 0.5);
  const label = score >= 0.9
    ? "critical"
    : score >= 0.7
      ? "high"
      : score >= 0.45
        ? "medium"
        : "low";
  return { score, label };
}
function prepBufferMin(score: number, category?: string): number {
  let buffer = 45 + Math.round(score * 30);
  const c = (category ?? "").toLowerCase();
  if (/(exam|interview|flight|travel|meeting|deadline)/.test(c))
    buffer += 30;
  return clamp(buffer, 30, 120);
}
function defaultWakeHour(profile: SchedulerProfile): number {
  if (profile.chronotype && CHRONO_WAKE_HOUR[profile.chronotype] !== undefined) {
    return CHRONO_WAKE_HOUR[profile.chronotype];
  }
  return 7;
}
function parseTaskStart(task: SchedulableTask, profile: SchedulerProfile): {
  start: Date;
  hadExplicitTime: boolean;
} | null {
  if (!task.dueDate)
    return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(task.dueDate);
  if (!m)
    return null;
  const [, y, mo, d] = m;
  let hour = defaultWakeHour(profile);
  let minute = 0;
  let hadExplicitTime = false;
  if (task.dueTime) {
    const tm = /^(\d{2}):(\d{2})$/.exec(task.dueTime);
    if (tm) {
      hour = Number(tm[1]);
      minute = Number(tm[2]);
      hadExplicitTime = true;
    }
  }
  const start = new Date(Number(y), Number(mo) - 1, Number(d), hour, minute, 0, 0);
  return { start, hadExplicitTime };
}
function wakeProfileFor(score: number, prediction: SchedulerPrediction, profile: SchedulerProfile): {
  intensity: number;
  wakeStrategy: WakeStrategy;
  verificationRequired: boolean;
  verificationMethods: string[];
  minConfidence: number;
  riskBumped: boolean;
} {
  let intensity: number;
  let wakeStrategy: WakeStrategy;
  let verificationRequired: boolean;
  let verificationMethods: string[];
  let minConfidence: number;
  if (score >= 0.9) {
    intensity = 90;
    wakeStrategy = "aggressive";
    verificationRequired = true;
    verificationMethods = ["math", "typing"];
    minConfidence = 85;
  }
  else if (score >= 0.7) {
    intensity = 80;
    wakeStrategy = "aggressive";
    verificationRequired = true;
    verificationMethods = ["math"];
    minConfidence = 78;
  }
  else if (score >= 0.45) {
    intensity = 65;
    wakeStrategy = "adaptive";
    verificationRequired = true;
    verificationMethods = ["math"];
    minConfidence = 70;
  }
  else {
    intensity = 50;
    wakeStrategy = profile.defaultWakeStrategy ?? "gentle";
    verificationRequired = profile.verificationRequired;
    verificationMethods = ["tap"];
    minConfidence = 60;
  }
  let riskBumped = false;
  // 0.5 sat at the model's median, so the "risk bump" applied to roughly half of
  // all alarms and the baseline configuration became the exception rather than
  // the rule. 0.65 targets the noisiest ~30% while leaving the tiers meaningful.
  if (prediction.oversleepProbability > RISK_BUMP_THRESHOLD) {
    intensity = clamp(intensity + 10, 0, 100);
    verificationRequired = true;
    minConfidence = clamp(minConfidence + 5, 0, 95);
    if (!verificationMethods.includes("math"))
      verificationMethods.push("math");
    if (wakeStrategy === "gentle")
      wakeStrategy = "adaptive";
    riskBumped = true;
  }
  return {
    intensity,
    wakeStrategy,
    verificationRequired,
    verificationMethods,
    minConfidence,
    riskBumped,
  };
}
function firstVerificationMethod(methods: string[]): VerificationMethod {
  const first = methods[0];
  return (VERIFICATION_ENUM as readonly string[]).includes(first)
    ? (first as VerificationMethod)
    : "none";
}
function timeLabel(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
function buildScheduleExplanation(input: {
  task: SchedulableTask;
  label: string;
  score: number;
  buffer: number;
  wakeAt: Date;
  start: Date;
  hadExplicitTime: boolean;
  prediction: SchedulerPrediction;
  wake: ReturnType<typeof wakeProfileFor>;
  confidence: number;
}): Explanation {
  const { task, label, score, buffer, wakeAt, start, hadExplicitTime, prediction, wake } = input;
  const oversleepPct = Math.round(prediction.oversleepProbability * 100);
  const attributions: Attribution[] = [
    {
      feature: "Task importance",
      value: label,
      impact: score >= 0.55 ? "increase" : score <= 0.4 ? "decrease" : "neutral",
      weight: 0.25 + Math.abs(score - 0.5) * 1.5,
      detail: score >= 0.7
        ? "A high-importance task warrants a firmer, earlier wake."
        : score <= 0.4
          ? "A low-importance task allows a gentler wake."
          : undefined,
    },
    {
      feature: "Oversleep risk",
      value: `${oversleepPct}%`,
      impact: prediction.oversleepProbability > 0.5 ? "increase" : "neutral",
      weight: prediction.oversleepProbability > 0.5
        ? 0.55 + (prediction.oversleepProbability - 0.5)
        : prediction.oversleepProbability * 0.5,
      detail: wake.riskBumped
        ? "High oversleep risk raised intensity and enforced verification."
        : undefined,
    },
    {
      feature: "Prep buffer",
      value: `${buffer} min`,
      impact: "neutral",
      weight: 0.2,
      detail: "Lead time reserved before the task begins.",
    },
    {
      feature: "Wake strategy",
      value: wake.wakeStrategy,
      impact: wake.wakeStrategy === "aggressive"
        ? "increase"
        : wake.wakeStrategy === "gentle"
          ? "decrease"
          : "neutral",
      weight: 0.3,
    },
  ];
  if (task.intent === "must-not-miss") {
      attributions.push({
        feature: "Semantic intent",
        value: "must-not-miss",
        impact: "increase",
        weight: 0.6,
        detail: "Phrasing flagged this as something you cannot miss.",
      });
    }
    else if (task.intent === "casual") {
      attributions.push({
        feature: "Semantic intent",
        value: "casual",
        impact: "decrease",
        weight: 0.4,
        detail: "Phrasing suggested a relaxed, low-pressure task.",
      });
    }
    if (task.emotion === "stress") {
      attributions.push({
        feature: "Emotion",
        value: "stress",
        impact: "increase",
        weight: 0.35,
        detail: "Stress cues nudge toward a more reliable wake.",
      });
    }
    else if (task.emotion === "fatigue") {
      attributions.push({
        feature: "Emotion",
        value: "fatigue",
        impact: "increase",
        weight: 0.3,
        detail: "Fatigue cues raise oversleep risk.",
      });
    }
    const startText = hadExplicitTime
      ? `which starts ${timeLabel(start)}`
      : "(no set time, using your usual wake hour)";
    let rationale = `Wake at ${timeLabel(wakeAt)} to allow ${buffer} min before "${task.title}" ${startText}.`;
    if (wake.riskBumped) {
      rationale += ` Intensity raised and verification enforced because oversleep risk is ${oversleepPct}%.`;
    }
    return makeExplanation({
      summary: `${wake.wakeStrategy} wake for "${task.title}"`,
      rationale,
      attributions,
      confidence: input.confidence,
    });
  }
  export function proposeAlarmsFromTasks(tasks: SchedulableTask[], profile: SchedulerProfile, prediction: SchedulerPrediction, existing: ExistingAlarmLite[] = [], opts: SchedulerOptions = {}): AlarmPlan[] {
    const now = opts.now ?? new Date();
    const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;
    const source = opts.source ?? "assisted";
    const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * MS_PER_MIN);
    const wakeWindow = clamp(profile.preferredWakeWindowMin || 30, 0, 120);
    const takenTimes: number[] = [];
    const linkedTaskIds = new Set<string>();
    for (const a of existing) {
      if (!a.enabled)
        continue;
      const t = new Date(a.scheduledTime).getTime();
      if (!Number.isNaN(t))
        takenTimes.push(t);
      if (a.linkedTaskId)
        linkedTaskIds.add(String(a.linkedTaskId));
    }
    const plans: AlarmPlan[] = [];
    const dedupeMs = DEDUPE_WINDOW_MIN * MS_PER_MIN;
    // Every `continue` below drops a task the user explicitly created. Recording
    // why lets the panel explain itself instead of reporting "no tasks need a
    // wake alarm", which reads as a decision rather than a discard.
    const skipped = opts.skipped;
    const note = (task: SchedulableTask, reason: SkipReason) => {
      skipped?.push({ taskId: String(task._id), title: task.title, reason });
    };

    for (const t of tasks) {
      if (t.completed) continue;
      if (!t.dueDate) note(t, "no-due-date");
      else if (parseTaskStart(t, profile) === null) note(t, "unreadable-date");
    }

    const candidates = tasks
      .filter((t) => !t.completed && t.dueDate)
      .map((t) => ({ task: t, parsed: parseTaskStart(t, profile) }))
      .filter((c) => c.parsed !== null)
      .sort((a, b) => a.parsed!.start.getTime() - b.parsed!.start.getTime());
    for (const { task, parsed } of candidates) {
      const { start, hadExplicitTime } = parsed!;
      if (start > horizonEnd) {
        note(task, "beyond-horizon");
        continue;
      }
      if (linkedTaskIds.has(String(task._id))) {
        note(task, "already-has-alarm");
        continue;
      }
      const { score, label } = taskImportance(task);
      const isMorning = start.getHours() < MORNING_CUTOFF_HOUR;
      if (!isMorning && score < 0.45) {
        note(task, "not-morning-and-low-priority");
        continue;
      }
      const buffer = prepBufferMin(score, task.category);
      const wakeAt = new Date(start.getTime() - buffer * MS_PER_MIN);
      if (wakeAt.getTime() < now.getTime() + MIN_LEAD_MIN * MS_PER_MIN) {
        note(task, "too-soon");
        continue;
      }
      const wakeMs = wakeAt.getTime();
      const collides = takenTimes.some((t) => Math.abs(t - wakeMs) <= dedupeMs) ||
        plans.some((p) => Math.abs(new Date(p.scheduledTime).getTime() - wakeMs) <= dedupeMs);
      if (collides) {
        note(task, "collides-with-existing");
        continue;
      }
      const wake = wakeProfileFor(score, prediction, profile);
      const factors: AlarmFactor[] = [
        { label: "Task", value: task.title },
        { label: "Importance", value: label },
        {
          label: "Starts",
          value: hadExplicitTime ? timeLabel(start) : `${timeLabel(start)} (default)`,
        },
        { label: "Prep buffer", value: `${buffer} min` },
        {
          label: "Oversleep risk",
          value: `${Math.round(prediction.oversleepProbability * 100)}%`,
        },
        { label: "Wake strategy", value: wake.wakeStrategy },
      ];
      const confidence = clamp(0.45 +
        score * 0.3 +
        prediction.wakeSuccessProbability * 0.15 +
        prediction.wakeupConsistency * 0.1, 0, 1);
      const explanation = buildScheduleExplanation({
        task,
        label,
        score,
        buffer,
        wakeAt,
        start,
        hadExplicitTime,
        prediction,
        wake,
        confidence,
      });
      plans.push({
        label: `Wake for: ${task.title}`,
        scheduledTime: wakeAt.toISOString(),
        source,
        linkedTaskId: String(task._id),
        taskTitle: task.title,
        intensity: wake.intensity,
        wakeStrategy: wake.wakeStrategy,
        verificationRequired: wake.verificationRequired,
        verificationMethod: firstVerificationMethod(wake.verificationMethods),
        verificationMethods: wake.verificationMethods,
        minConfidence: wake.minConfidence,
        repeat: { type: "none" },
        smartWakeWindowMin: wakeWindow,
        rationale: explanation.rationale,
        factors,
        explanation,
        confidence: Math.round(confidence * 100) / 100,
      });
    }
    return plans;
  }