import { computeMetrics, sleepQualityScore, type BehavioralMetrics, type BehaviorEventInput, type SleepLogInput, } from "@/lib/features";
export interface DailyPoint {
  date: string;
  weekday: string;
  durationHours: number | null;
  qualityScore: number | null;
  snoozeCount: number | null;
  wakeConfidence: number | null;
}
export type TrendDirection = "improving" | "declining" | "steady";
export interface MetricTrend {
  key: string;
  label: string;
  current: number;
  previous: number;
  delta: number;
  direction: TrendDirection;
  betterWhenHigher: boolean;
}
export interface WeeklyInsight {
  text: string;
  tone: "positive" | "warning" | "neutral";
  basis: string;
}
export interface WeeklyReport {
  range: {
    start: string;
    end: string;
  };
  nights: number;
  daily: DailyPoint[];
  metrics: BehavioralMetrics;
  previousMetrics: BehavioralMetrics;
  trends: MetricTrend[];
  averages: {
    durationHours: number | null;
    qualityScore: number | null;
    snoozeCount: number | null;
    wakeConfidence: number | null;
  };
  insights: WeeklyInsight[];
}
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 24 * 60 * 60 * 1000;
function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function avg(xs: number[]): number | null {
  if (xs.length === 0)
    return null;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}
function round1(x: number | null): number | null {
  return x === null ? null : Math.round(x * 10) / 10;
}
function direction(delta: number, betterWhenHigher: boolean): TrendDirection {
  if (Math.abs(delta) < 2)
    return "steady";
  const up = delta > 0;
  return up === betterWhenHigher ? "improving" : "declining";
}
interface TrendSpec {
  key: keyof BehavioralMetrics;
  label: string;
  betterWhenHigher: boolean;
}
const TREND_SPECS: TrendSpec[] = [
  { key: "fatigueScore", label: "Fatigue", betterWhenHigher: false },
  { key: "productivityScore", label: "Productivity", betterWhenHigher: true },
  { key: "sleepConsistencyScore", label: "Sleep consistency", betterWhenHigher: true },
  { key: "wakeEfficiencyScore", label: "Wake efficiency", betterWhenHigher: true },
];
function buildTrends(current: BehavioralMetrics, previous: BehavioralMetrics): MetricTrend[] {
  return TREND_SPECS.map((spec) => {
    const cur = Math.round(current[spec.key] as number);
    const prev = Math.round(previous[spec.key] as number);
    const delta = cur - prev;
    return {
      key: spec.key,
      label: spec.label,
      current: cur,
      previous: prev,
      delta,
      direction: direction(delta, spec.betterWhenHigher),
      betterWhenHigher: spec.betterWhenHigher,
    };
  });
}
function buildInsights(daily: DailyPoint[], metrics: BehavioralMetrics, trends: MetricTrend[], avgDuration: number | null): WeeklyInsight[] {
  const out: WeeklyInsight[] = [];
  const fatigue = trends.find((t) => t.key === "fatigueScore");
  const productivity = trends.find((t) => t.key === "productivityScore");
  const consistency = trends.find((t) => t.key === "sleepConsistencyScore");
  if (fatigue && fatigue.direction === "declining") {
    out.push({
      text: `Fatigue rose ${Math.abs(fatigue.delta)} pts week-over-week. Protect an earlier bedtime and trim evening screen time.`,
      tone: "warning",
      basis: "rising fatigue trend",
    });
  }
  else if (fatigue && fatigue.direction === "improving") {
    out.push({
      text: `Fatigue dropped ${Math.abs(fatigue.delta)} pts - your recovery is trending the right way.`,
      tone: "positive",
      basis: "falling fatigue trend",
    });
  }
  if (productivity && productivity.direction === "improving") {
    out.push({
      text: `Productivity is up ${Math.abs(productivity.delta)} pts. Steadier wake-ups are paying off.`,
      tone: "positive",
      basis: "rising productivity trend",
    });
  }
  else if (productivity && productivity.direction === "declining") {
    out.push({
      text: `Productivity slipped ${Math.abs(productivity.delta)} pts; it tracks closely with your wake reliability.`,
      tone: "warning",
      basis: "falling productivity trend",
    });
  }
  if (consistency && metrics.sleepConsistencyScore < 55) {
    out.push({
      text: "Your sleep timing is uneven. Anchoring a fixed wake time (even on weekends) is the fastest win.",
      tone: "warning",
      basis: "low sleep consistency",
    });
  }
  if (avgDuration !== null && avgDuration < 6.5) {
    out.push({
      text: `You averaged ${avgDuration.toFixed(1)} h of sleep this week - below the 7-9 h target.`,
      tone: "warning",
      basis: "short average duration",
    });
  }
  else if (avgDuration !== null && avgDuration >= 7 && avgDuration <= 9) {
    out.push({
      text: `Solid ${avgDuration.toFixed(1)} h nightly average - right in the healthy band.`,
      tone: "positive",
      basis: "healthy average duration",
    });
  }
  const scored = daily.filter((d) => d.qualityScore !== null);
  if (scored.length >= 3) {
    const best = scored.reduce((a, b) => ((b.qualityScore ?? 0) > (a.qualityScore ?? 0) ? b : a));
    out.push({
      text: `Your best night was ${best.weekday} (quality ${Math.round(best.qualityScore ?? 0)}). Replicate that wind-down.`,
      tone: "neutral",
      basis: "best night of the week",
    });
  }
  if (out.length === 0) {
    out.push({
      text: "Log a few nights of sleep to unlock weekly trends and insights.",
      tone: "neutral",
      basis: "insufficient data",
    });
  }
  return out.slice(0, 6);
}
export function buildWeeklyReport(logs: SleepLogInput[], events: BehaviorEventInput[], now: Date = new Date()): WeeklyReport {
  const end = new Date(now);
  const startThis = new Date(end.getTime() - 7 * DAY_MS);
  const startPrev = new Date(end.getTime() - 14 * DAY_MS);
  const inRange = (dateStr: string, lo: Date, hi: Date) => {
    const d = new Date(`${dateStr}T12:00:00`);
    return d >= lo && d < hi;
  };
  const thisWeekLogs = logs.filter((l) => inRange(l.date, startThis, end));
  const prevWeekLogs = logs.filter((l) => inRange(l.date, startPrev, startThis));
  const eventAt = (e: BehaviorEventInput) => e.at instanceof Date ? e.at : new Date(e.at);
  const thisWeekEvents = events.filter((e) => {
    const t = eventAt(e);
    return t >= startThis && t < end;
  });
  const prevWeekEvents = events.filter((e) => {
    const t = eventAt(e);
    return t >= startPrev && t < startThis;
  });
  const metrics = computeMetrics(thisWeekLogs, thisWeekEvents);
  const previousMetrics = computeMetrics(prevWeekLogs, prevWeekEvents);
  const trends = buildTrends(metrics, previousMetrics);
  const byDate = new Map<string, SleepLogInput>();
  for (const l of thisWeekLogs) {
    byDate.set(l.date, l);
  }
  const daily: DailyPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end.getTime() - i * DAY_MS);
    const key = ymd(d);
    const log = byDate.get(key);
    const duration = log && typeof log.durationHours === "number" ? log.durationHours : null;
    daily.push({
      date: key,
      weekday: WEEKDAY[d.getDay()],
      durationHours: round1(duration),
      qualityScore: log ? sleepQualityScore(log) : null,
      snoozeCount: log && typeof log.snoozeCount === "number" ? log.snoozeCount : null,
      wakeConfidence: log && typeof log.wakeConfidence === "number" ? log.wakeConfidence : null,
    });
  }
  const durations = daily
    .map((d) => d.durationHours)
    .filter((v): v is number => v !== null);
  const qualities = daily
    .map((d) => d.qualityScore)
    .filter((v): v is number => v !== null);
  const snoozes = daily
    .map((d) => d.snoozeCount)
    .filter((v): v is number => v !== null);
  const confidences = daily
    .map((d) => d.wakeConfidence)
    .filter((v): v is number => v !== null);
  const avgDuration = round1(avg(durations));
  const insights = buildInsights(daily, metrics, trends, avgDuration);
  return {
    range: { start: ymd(startThis), end: ymd(end) },
    nights: thisWeekLogs.length,
    daily,
    metrics,
    previousMetrics,
    trends,
    averages: {
      durationHours: avgDuration,
      qualityScore: qualities.length ? Math.round(avg(qualities) as number) : null,
      snoozeCount: round1(avg(snoozes)),
      wakeConfidence: confidences.length
        ? Math.round(avg(confidences) as number)
        : null,
    },
    insights,
  };
}