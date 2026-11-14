// Personal predictions, server side (prompt 5.3): the person's own nights and
// recorded wakes, described as the population model sees a night, compared
// with what the model would have said, and handed to lib/personal.ts.
// Server-only.

import { connectToDatabase } from "@/lib/mongoose";
import { bedtimeHour, CHRONOTYPE_CODE } from "@/lib/aiFeatures";
import { predictBatch, type ModelFeatures } from "@/lib/aiClient";
import { computeMetrics, type SleepLogInput } from "@/lib/features";
import { alarmHabits, personalRegularity, personalSleep, type AlarmHabits, type Estimate } from "@/lib/personal";
import { modelSleepLogFilter, simulatedInputsAllowed } from "@/lib/provenance";
import { regularityLabels } from "@/lib/wakeProxy";
import { SleepLog } from "@/models/SleepLog";
import { TelemetryConsent } from "@/models/TelemetryConsent";
import { User } from "@/models/User";
import { WakeTelemetry } from "@/models/WakeTelemetry";

/** Nights looked back over; the population model's own window for trailing measures is 30. */
export const HISTORY_NIGHTS = 120;
const TRAILING = 30;

export interface PersonalPredictions {
  /** Whether sleep and regularity could be personalised at all: they need the AI Brain's model. */
  available: boolean;
  reason?: string;
  sleep?: Estimate;
  regularity?: Estimate;
  /** From recorded wakes (telemetry), with consent; "off" when telemetry isn't on. */
  alarm: AlarmHabits | { basis: "off" };
}

interface Log extends SleepLogInput {
  date: string;
  sleepTime?: Date | null;
  wakeTime?: Date | null;
  restingHr?: number;
}

/** The local hour a time falls at in `tz` (7.5 is 07:30); UTC when the zone is unknown. */
export function localHour(t: Date, tz: string | undefined): number {
  let zone = "UTC";
  try {
    if (tz) {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      zone = tz;
    }
  }
  catch {
    zone = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

/**
 * Each night as the population model would have seen it the evening before:
 * its bedtime and resting heart rate, and consistency and sleep debt from the
 * nights before it (as buildUserSignals builds tonight's).
 */
export function historyRows(logs: Log[], chronotype: string | undefined, goalHours: number): ModelFeatures[] {
  return logs.map((log, i) => {
    const before = logs.slice(Math.max(0, i - TRAILING), i);
    const row: ModelFeatures = {};
    if (chronotype && chronotype in CHRONOTYPE_CODE) {
      row.chronotype_code = CHRONOTYPE_CODE[chronotype];
    }
    const bh = bedtimeHour(log.sleepTime ?? null);
    if (bh !== null) {
      row.bedtime_hour = bh;
    }
    if (typeof log.restingHr === "number") {
      row.resting_hr = log.restingHr;
    }
    if (before.length > 0) {
      row.sleep_consistency = computeMetrics(before, []).sleepConsistencyScore;
      const durations = before.map((l) => l.durationHours).filter((d): d is number => typeof d === "number" && d > 0);
      if (durations.length > 0) {
        row.sleep_debt_hours = Math.max(-2, Math.min(4, goalHours - durations.reduce((s, d) => s + d, 0) / durations.length));
      }
    }
    return row;
  });
}

export async function personalPredictions(
  userId: string,
  tonight: { features: ModelFeatures; sleep: number; regular: number; fromModel: boolean },
  tz?: string,
  deps: { batch: typeof predictBatch } = { batch: predictBatch },
): Promise<PersonalPredictions> {
  await connectToDatabase();
  const [logsDesc, user, consent] = await Promise.all([
    SleepLog.find({ userId, ...modelSleepLogFilter(simulatedInputsAllowed()) }).sort({ date: -1 }).limit(HISTORY_NIGHTS).lean<Log[]>(),
    User.findById(userId).lean<{ chronotype?: string; sleepGoalHours?: number }>(),
    TelemetryConsent.findOne({ userId }).lean<{ granted: boolean }>(),
  ]);

  // Recorded wakes count only while telemetry is on: what was consented to is used as consented.
  let alarm: PersonalPredictions["alarm"] = { basis: "off" };
  if (consent?.granted) {
    const wakes = await WakeTelemetry.find({ userId }).sort({ firstRingAt: -1 }).limit(HISTORY_NIGHTS)
      .lean<{ snoozes: number; firstInteractionMs: number | null }[]>();
    alarm = alarmHabits(wakes);
  }

  if (!tonight.fromModel) {
    return { available: false, reason: "Personal predictions build on the AI Brain's model, which isn't reachable; these are the simple rules.", alarm };
  }
  const logs = [...logsDesc].reverse();
  const rows = historyRows(logs, user?.chronotype, user?.sleepGoalHours ?? 8);
  const population = rows.length > 0 ? await deps.batch(rows) : { sleep: [], regular: [] };
  if (!population) {
    return { available: false, reason: "The AI Brain didn't answer for your past nights, so these are the population model's alone.", alarm };
  }

  const sleepHistory = logs.flatMap((l, i) => typeof l.durationHours === "number" && l.durationHours > 0
    ? [{ observed: l.durationHours, predicted: population.sleep[i] }]
    : []);
  const labels = regularityLabels(logs.map((l) => ({ date: l.date, wakeHour: l.wakeTime ? localHour(new Date(l.wakeTime), tz) : null })));
  const regularHistory = logs.flatMap((_, i) => labels[i] === null ? [] : [{ regular: labels[i] as boolean, predicted: population.regular[i] }]);

  return {
    available: true,
    sleep: personalSleep(tonight.sleep, sleepHistory),
    regularity: personalRegularity(tonight.regular, regularHistory),
    alarm,
  };
}
