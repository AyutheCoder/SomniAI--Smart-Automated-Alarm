import { connectToDatabase } from "@/lib/mongoose";
import { SleepLog } from "@/models/SleepLog";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { ContextSnapshot } from "@/models/ContextSnapshot";
import { User } from "@/models/User";
import { computeMetrics, type BehavioralMetrics, type BehaviorEventInput, type SleepLogInput, } from "@/lib/features";
import type { ModelFeatures } from "@/lib/aiClient";
export interface UserSignals {
  features: ModelFeatures;
  metrics: BehavioralMetrics;
  recentSleepHours: number | null;
  sleepGoalHours: number;
}
const CHRONOTYPE_CODE: Record<string, number> = {
  lark: 0,
  intermediate: 1,
  owl: 2,
};
function mean(xs: number[]): number | null {
  if (xs.length === 0)
    return null;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}
function bedtimeHour(sleepTime?: Date | null): number | null {
  if (!sleepTime)
    return null;
  const d = sleepTime instanceof Date ? sleepTime : new Date(sleepTime);
  if (Number.isNaN(d.getTime()))
    return null;
  let h = d.getHours() + d.getMinutes() / 60;
  if (h < 12)
    h += 24;
  return Math.round(h * 100) / 100;
}
export async function buildUserSignals(userId: string, days = 30): Promise<UserSignals> {
  await connectToDatabase();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [logsRaw, eventsRaw, context, user] = await Promise.all([
    SleepLog.find({ userId }).sort({ date: -1 }).limit(days).lean(),
    BehaviorEvent.find({ userId, at: { $gte: since } })
      .sort({ at: -1 })
      .limit(2000)
      .lean(),
    ContextSnapshot.findOne({ userId }).sort({ at: -1 }).lean(),
    User.findById(userId).lean(),
  ]);
  const logs = logsRaw as unknown as SleepLogInput[];
  const events = eventsRaw as unknown as BehaviorEventInput[];
  const metrics = computeMetrics(logs, events);
  const sleepGoalHours = (user as {
    sleepGoalHours?: number;
  } | null)?.sleepGoalHours ?? 8;
  const chronotype = (user as {
    chronotype?: string;
  } | null)?.chronotype;
  const durations = logs
    .map((l) => (typeof l.durationHours === "number" ? l.durationHours : null))
    .filter((v): v is number => v !== null && v > 0);
  const snoozes = logs
    .map((l) => (typeof l.snoozeCount === "number" ? l.snoozeCount : null))
    .filter((v): v is number => v !== null);
  const responses = logs
    .map((l) => (typeof l.alarmResponseMs === "number" ? l.alarmResponseMs : null))
    .filter((v): v is number => v !== null);
  const latest = logs[0];
  const recentSleepHours = latest && typeof latest.durationHours === "number"
    ? latest.durationHours
    : null;
  const meanDuration = mean(durations);
  const noiseVals = events
    .filter((e) => e.type === "ambient_noise" && typeof e.value === "number")
    .map((e) => e.value as number);
  const ambientNoise = mean(noiseVals);
  const wearable = (context as {
    wearable?: {
      restingHr?: number;
      steps?: number;
    };
  } | null)
    ?.wearable ?? undefined;
  const features: ModelFeatures = {
    sleep_consistency: metrics.sleepConsistencyScore,
    stress_level: metrics.fatigueScore,
  };
  if (chronotype && chronotype in CHRONOTYPE_CODE) {
    features.chronotype_code = CHRONOTYPE_CODE[chronotype];
  }
  const snoozeMean = mean(snoozes);
  if (snoozeMean !== null)
    features.snooze_count = Math.round(snoozeMean);
  const responseMean = mean(responses);
  if (responseMean !== null)
    features.alarm_response_ms = Math.round(responseMean);
  if (meanDuration !== null) {
    features.sleep_debt_hours = Math.max(-2, Math.min(4, sleepGoalHours - meanDuration));
  }
  const bh = bedtimeHour(latest?.sleepTime as Date | undefined);
  if (bh !== null)
    features.bedtime_hour = bh;
  if (ambientNoise !== null)
    features.ambient_noise_db = Math.round(ambientNoise);
  if (wearable?.restingHr)
    features.resting_hr = wearable.restingHr;
  if (typeof wearable?.steps === "number")
    features.steps = wearable.steps;
  return { features, metrics, recentSleepHours, sleepGoalHours };
}