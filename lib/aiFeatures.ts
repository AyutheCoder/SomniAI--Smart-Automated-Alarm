import { connectToDatabase } from "@/lib/mongoose";
import { SleepLog } from "@/models/SleepLog";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { ContextSnapshot } from "@/models/ContextSnapshot";
import { User } from "@/models/User";
import { computeMetrics, type BehavioralMetrics, type BehaviorEventInput, type SleepLogInput, } from "@/lib/features";
import type { ModelFeatures } from "@/lib/aiClient";
import {
  modelEventFilter,
  modelSleepLogFilter,
  simulatedInputsAllowed,
  snapshotSources,
  usableForModels,
  type ContextSources,
  type Source,
} from "@/lib/provenance";
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
/**
 * The features and metrics every model input is built from.
 *
 * Only live data gets in: simulated sleep logs and events are filtered out in
 * the query, and wearable values are used only when the snapshot says they
 * are live. Anything else is treated as missing, so its feature is left out
 * rather than filled with a made-up number. See lib/provenance.ts.
 */
export async function buildUserSignals(userId: string, days = 30): Promise<UserSignals> {
  await connectToDatabase();
  const allowSimulated = simulatedInputsAllowed();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [logsRaw, eventsRaw, context, user] = await Promise.all([
    SleepLog.find({ userId, ...modelSleepLogFilter(allowSimulated) }).sort({ date: -1 }).limit(days).lean(),
    BehaviorEvent.find({ userId, at: { $gte: since }, ...modelEventFilter(allowSimulated) })
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
  const snapshot = context as {
    wearable?: {
      restingHr?: number;
      steps?: number;
    };
    sources?: Partial<ContextSources>;
  } | null;
  // These were always simulateWearable() numbers, and went straight in.
  const wearable = usableForModels(snapshotSources(snapshot).wearable, allowSimulated)
    ? snapshot?.wearable
    : undefined;
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
export interface DataSourceStatus {
  source: Source;
  detail: string;
}

/** What the user sees about their data: which sources are connected, and what models use. */
export interface DataSources {
  sleepLogs: DataSourceStatus;
  weather: DataSourceStatus;
  calendar: DataSourceStatus;
  wearable: DataSourceStatus;
}

export async function describeDataSources(userId: string): Promise<DataSources> {
  await connectToDatabase();
  const [snapshot, realNights, simulatedNights] = await Promise.all([
    ContextSnapshot.findOne({ userId }).sort({ at: -1 }).lean<{ sources?: Partial<ContextSources>; at?: Date }>(),
    SleepLog.countDocuments({ userId, source: { $ne: "simulated" } }),
    SleepLog.countDocuments({ userId, source: "simulated" }),
  ]);
  const sources = snapshotSources(snapshot);
  const simulatedNote = simulatedInputsAllowed()
    ? "Simulated, and used for predictions because SOMNIAI_SIMULATED_INPUTS=allow (development only)"
    : "Simulated: not used for predictions";
  const describe = (source: Source, live: string, missing: string): DataSourceStatus => ({
    source,
    detail: source === "live" ? live : source === "simulated" ? simulatedNote : missing,
  });

  const unused = simulatedNights > 0 && !simulatedInputsAllowed()
    ? `; ${simulatedNights} simulated ${simulatedNights === 1 ? "night" : "nights"} not used`
    : "";
  return {
    sleepLogs: realNights > 0
      ? { source: "live", detail: `${realNights} ${realNights === 1 ? "night" : "nights"} logged${unused}` }
      : { source: "missing", detail: `No nights logged yet${unused}` },
    weather: describe(sources.weather, "Live, from your location", "Not connected: allow location for live weather"),
    calendar: describe(sources.calendar, "Connected", "Not connected"),
    wearable: describe(sources.wearable, "Connected", "Not connected"),
  };
}
