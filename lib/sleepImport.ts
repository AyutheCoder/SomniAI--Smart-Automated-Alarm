// Nights from Health Connect into the sleep log (prompt 4.2). The phone folds
// them, one per wake date, longest session kept (HealthNights.java); here each
// is checked and stored as that date's SleepLog, source "health_connect".
// A night the user typed in is theirs and stays as written; a night read
// before is updated when Health Connect has more of it now (a watch that
// synced late). Server-only.

import { sleepQualityScore } from "@/lib/features";
import { isIsoDate } from "@/lib/validate";
import { SleepLog } from "@/models/SleepLog";

export interface ImportedNight {
  date: string;
  sleepTime: string;
  wakeTime: string;
  asleepMinutes: number;
  inBedMinutes: number;
  stagesRecorded: boolean;
  sessions: number;
  sessionId: string;
  origin?: string;
  restingHr?: number;
}

export interface ImportResult {
  added: number;
  updated: number;
  unchanged: number;
  /** Dates kept as the user entered them by hand. */
  keptManual: string[];
}

/** At most this many nights in one import: two weeks, with room to spare. */
export const MAX_NIGHTS = 31;

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isInstant = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));

/** Why these nights can't be imported, or null. */
export function invalidNights(nights: unknown): string | null {
  if (!Array.isArray(nights)) {
    return "nights must be a list";
  }
  if (nights.length > MAX_NIGHTS) {
    return `at most ${MAX_NIGHTS} nights at a time`;
  }
  const dates = new Set<string>();
  for (const [i, n] of nights.entries()) {
    const at = `nights[${i}]`;
    if (!n || typeof n !== "object") {
      return `${at} must be a night`;
    }
    const v = n as Record<string, unknown>;
    if (!isIsoDate(v.date)) {
      return `${at}.date must be a date like 2026-11-15`;
    }
    if (dates.has(v.date)) {
      return `${at}.date ${v.date} is listed twice; fold a night's sessions first`;
    }
    dates.add(v.date);
    if (!isInstant(v.sleepTime) || !isInstant(v.wakeTime)) {
      return `${at}.sleepTime and wakeTime must be ISO times`;
    }
    const inBed = (Date.parse(v.wakeTime) - Date.parse(v.sleepTime)) / 60_000;
    if (inBed <= 0 || inBed > 24 * 60) {
      return `${at} must end after it starts, within a day`;
    }
    if (!isInt(v.asleepMinutes, 0, 24 * 60) || !isInt(v.inBedMinutes, 0, 24 * 60) || (v.asleepMinutes as number) > (v.inBedMinutes as number)) {
      return `${at}.asleepMinutes and inBedMinutes must be whole minutes, asleep no more than in bed`;
    }
    if (typeof v.stagesRecorded !== "boolean" || !isInt(v.sessions, 1, 100)) {
      return `${at}.stagesRecorded must be true or false and sessions a count`;
    }
    if (typeof v.sessionId !== "string" || v.sessionId.length === 0 || v.sessionId.length > 200) {
      return `${at}.sessionId must be the Health Connect record's id`;
    }
    if (v.origin !== undefined && (typeof v.origin !== "string" || v.origin.length > 200)) {
      return `${at}.origin must be the recording app's package name`;
    }
    if (v.restingHr !== undefined && !isInt(v.restingHr, 20, 250)) {
      return `${at}.restingHr must be beats per minute, 20 to 250`;
    }
  }
  return null;
}

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

export async function importNights(userId: string, nights: ImportedNight[]): Promise<ImportResult> {
  const result: ImportResult = { added: 0, updated: 0, unchanged: 0, keptManual: [] };
  for (const n of nights) {
    const existing = await SleepLog.findOne({ userId, date: n.date }).lean<{
      source: string; externalId?: string; durationHours?: number; wakeTime?: Date; restingHr?: number;
    }>();
    if (existing?.source === "manual") {
      result.keptManual.push(n.date);
      continue;
    }
    const fields = {
      sleepTime: new Date(n.sleepTime),
      wakeTime: new Date(n.wakeTime),
      durationHours: hours(n.asleepMinutes),
      inBedHours: hours(n.inBedMinutes),
      stagesRecorded: n.stagesRecorded,
      sessions: n.sessions,
      externalId: n.sessionId,
      origin: n.origin,
      restingHr: n.restingHr,
      source: "health_connect" as const,
    };
    if (existing?.source === "health_connect"
      && existing.externalId === fields.externalId
      && existing.durationHours === fields.durationHours
      && existing.wakeTime?.getTime() === fields.wakeTime.getTime()
      && existing.restingHr === fields.restingHr) {
      result.unchanged++;
      continue;
    }
    const qualityScore = sleepQualityScore({ date: n.date, durationHours: fields.durationHours });
    // A resting heart rate no longer recorded is removed, not left from before.
    const unset = n.restingHr === undefined ? { $unset: { restingHr: 1 } } : {};
    const { restingHr, ...rest } = fields;
    await SleepLog.updateOne(
      { userId, date: n.date },
      { $set: { ...rest, ...(restingHr === undefined ? {} : { restingHr }), qualityScore }, ...unset },
      { upsert: true, runValidators: true },
    );
    if (existing) {
      result.updated++;
    }
    else {
      result.added++;
    }
  }
  return result;
}
