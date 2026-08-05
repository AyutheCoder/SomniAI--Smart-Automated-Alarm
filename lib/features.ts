export interface SleepLogInput {
  date: string;
  sleepTime?: string | Date | null;
  wakeTime?: string | Date | null;
  durationHours?: number | null;
  snoozeCount?: number | null;
  alarmResponseMs?: number | null;
  wakeConfidence?: number | null;
}
export interface BehaviorEventInput {
  type: string;
  value?: number | null;
  at: string | Date;
  meta?: Record<string, unknown> | null;
}
export interface BehavioralMetrics {
  sleepConsistencyScore: number;
  wakeResistanceIndex: number;
  sleepDisruptionScore: number;
  wakeEfficiencyScore: number;
  fatigueScore: number;
  productivityScore: number;
  oversleepProbability: number;
  wakeSuccessProbability: number;
  nights: number;
  events: number;
}
const TARGET_SLEEP_HOURS = 8;
const MAX_RESPONSE_MS = 30000;
const MAX_SNOOZES = 4;
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const pct = (x: number) => Math.round(clamp(x) * 100);
function mean(xs: number[]): number {
  if (xs.length === 0)
    return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}
function stdev(xs: number[]): number {
  if (xs.length < 2)
    return 0;
  const m = mean(xs);
  const variance = mean(xs.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}
function toDate(v?: string | Date | null): Date | null {
  if (!v)
    return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function sleepMidpointMinute(log: SleepLogInput): number | null {
  const s = toDate(log.sleepTime);
  const w = toDate(log.wakeTime);
  if (!s || !w)
    return null;
  const mid = new Date((s.getTime() + w.getTime()) / 2);
  return mid.getHours() * 60 + mid.getMinutes();
}
export function computeMetrics(logs: SleepLogInput[], events: BehaviorEventInput[]): BehavioralMetrics {
  const durations = logs
    .map((l) => (typeof l.durationHours === "number" && l.durationHours > 0
      ? l.durationHours
      : null))
    .filter((v): v is number => v !== null);
  const midpoints = logs
    .map(sleepMidpointMinute)
    .filter((v): v is number => v !== null);
  const snoozeCounts = logs
    .map((l) => (typeof l.snoozeCount === "number" ? l.snoozeCount : null))
    .filter((v): v is number => v !== null);
  const responses = logs
    .map((l) => (typeof l.alarmResponseMs === "number" ? l.alarmResponseMs : null))
    .filter((v): v is number => v !== null);
  const confidences = logs
    .map((l) => (typeof l.wakeConfidence === "number" ? l.wakeConfidence : null))
    .filter((v): v is number => v !== null);
  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {});
  const passes = counts["verify_pass"] ?? 0;
  const fails = counts["verify_fail"] ?? 0;
  const snoozeEvents = counts["snooze"] ?? 0;
  const fires = counts["alarm_fire"] ?? 0;
  const disruptions = (counts["motion"] ?? 0) + (counts["ambient_noise"] ?? 0);
  const meanDuration = durations.length ? mean(durations) : TARGET_SLEEP_HOURS;
  const midpointStdev = stdev(midpoints);
  const snoozeAvg = snoozeCounts.length > 0
    ? mean(snoozeCounts)
    : fires > 0
      ? snoozeEvents / fires
      : 0;
  const meanResponse = responses.length ? mean(responses) : MAX_RESPONSE_MS / 2;
  const meanConfidence = confidences.length ? mean(confidences) / 100 : 0.6;
  const sleepConsistencyScore = midpoints.length >= 2 ? pct(1 - midpointStdev / 120) : 50;
  const wakeResistanceIndex = pct(snoozeAvg / MAX_SNOOZES);
  const durationDeficit = clamp((TARGET_SLEEP_HOURS - meanDuration) / TARGET_SLEEP_HOURS);
  const disruptionDensity = clamp(disruptions / Math.max(1, logs.length) / 10);
  const sleepDisruptionScore = pct(0.6 * durationDeficit + 0.4 * disruptionDensity);
  const responseScore = clamp(1 - meanResponse / MAX_RESPONSE_MS);
  const snoozeScore = clamp(1 - snoozeAvg / MAX_SNOOZES);
  const wakeEfficiencyScore = pct(0.4 * responseScore + 0.3 * snoozeScore + 0.3 * meanConfidence);
  const fatigueScore = pct(0.4 * durationDeficit +
    0.3 * clamp(snoozeAvg / MAX_SNOOZES) +
    0.3 * (1 - meanConfidence));
  const productivityScore = pct(0.4 * (wakeEfficiencyScore / 100) +
    0.3 * (sleepConsistencyScore / 100) +
    0.3 * (1 - fatigueScore / 100));
  const wakeSuccessProbability = passes + fails > 0
    ? clamp(passes / (passes + fails))
    : clamp(wakeEfficiencyScore / 100);
  const oversleepProbability = clamp(0.6 * (1 - wakeSuccessProbability) + 0.4 * (fatigueScore / 100));
  return {
    sleepConsistencyScore,
    wakeResistanceIndex,
    sleepDisruptionScore,
    wakeEfficiencyScore,
    fatigueScore,
    productivityScore,
    oversleepProbability: Math.round(oversleepProbability * 100) / 100,
    wakeSuccessProbability: Math.round(wakeSuccessProbability * 100) / 100,
    nights: logs.length,
    events: events.length,
  };
}
export function sleepQualityScore(log: SleepLogInput): number {
  const duration = typeof log.durationHours === "number" ? log.durationHours : TARGET_SLEEP_HOURS;
  const durationScore = clamp(1 - Math.abs(duration - 8) / 4);
  const snooze = typeof log.snoozeCount === "number" ? log.snoozeCount : 0;
  const snoozeScore = clamp(1 - snooze / MAX_SNOOZES);
  const conf = typeof log.wakeConfidence === "number" ? log.wakeConfidence / 100 : 0.6;
  return pct(0.5 * durationScore + 0.2 * snoozeScore + 0.3 * conf);
}