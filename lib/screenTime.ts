// Screen time before bed, from the phone into the feature pipeline (prompt
// 4.3). The phone windows Android's usage records into one number per night
// (ScreenNights.java); here each is checked and stored, and the last week's
// become the model's screen_minutes_before_bed. Server-only.

import { isIsoDate } from "@/lib/validate";
import { ScreenNight } from "@/models/ScreenNight";

export interface ScreenNightInput {
  date: string;
  bedtime: string;
  minutes: number;
  windowMinutes: number;
  bedtimeFrom: "sleep_log" | "phone";
}

export interface ScreenImportResult {
  added: number;
  updated: number;
  unchanged: number;
}

/** The model's window: screen_minutes_before_bed runs from 0 to 180. */
export const WINDOW_MINUTES = 180;
/** Nights the feature averages over: the last week's. */
export const FEATURE_DAYS = 7;
/** At most this many nights in one import. */
export const MAX_SCREEN_NIGHTS = 31;

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isInstant = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));

/** Why these nights can't be stored, or null. */
export function invalidScreenNights(nights: unknown): string | null {
  if (!Array.isArray(nights)) {
    return "nights must be a list";
  }
  if (nights.length > MAX_SCREEN_NIGHTS) {
    return `at most ${MAX_SCREEN_NIGHTS} nights at a time`;
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
      return `${at}.date ${v.date} is listed twice`;
    }
    dates.add(v.date);
    if (!isInstant(v.bedtime)) {
      return `${at}.bedtime must be an ISO time`;
    }
    if (!isInt(v.windowMinutes, 1, 720)) {
      return `${at}.windowMinutes must be whole minutes`;
    }
    if (!isInt(v.minutes, 0, v.windowMinutes as number)) {
      return `${at}.minutes must be whole minutes, no more than the window`;
    }
    if (v.bedtimeFrom !== "sleep_log" && v.bedtimeFrom !== "phone") {
      return `${at}.bedtimeFrom must be "sleep_log" or "phone"`;
    }
  }
  return null;
}

export async function importScreenNights(userId: string, nights: ScreenNightInput[]): Promise<ScreenImportResult> {
  const result: ScreenImportResult = { added: 0, updated: 0, unchanged: 0 };
  for (const n of nights) {
    const existing = await ScreenNight.findOne({ userId, date: n.date }).lean<{ bedtime: Date; minutes: number; windowMinutes: number; bedtimeFrom: string }>();
    const bedtime = new Date(n.bedtime);
    if (existing
      && existing.bedtime.getTime() === bedtime.getTime()
      && existing.minutes === n.minutes
      && existing.windowMinutes === n.windowMinutes
      && existing.bedtimeFrom === n.bedtimeFrom) {
      result.unchanged++;
      continue;
    }
    await ScreenNight.updateOne(
      { userId, date: n.date },
      { $set: { bedtime, minutes: n.minutes, windowMinutes: n.windowMinutes, bedtimeFrom: n.bedtimeFrom } },
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

export interface RecentScreenTime {
  /** Mean minutes before bed over the nights measured. */
  minutes: number;
  nights: number;
}

const dayBefore = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * The last week's screen time before bed, or null when no night in it was
 * measured: then the feature is left out, never a guess. Nights measured over
 * another window than the model's aren't the same quantity and aren't used.
 * A habit, not tonight: the prediction is made before tonight's is known.
 */
export async function recentScreenTime(userId: string, now = new Date()): Promise<RecentScreenTime | null> {
  const nights = await ScreenNight.find({ userId, date: { $gte: dayBefore(now, FEATURE_DAYS) }, windowMinutes: WINDOW_MINUTES })
    .sort({ date: -1 })
    .limit(FEATURE_DAYS)
    .lean<{ minutes: number }[]>();
  if (nights.length === 0) {
    return null;
  }
  return { minutes: Math.round(nights.reduce((s, n) => s + n.minutes, 0) / nights.length), nights: nights.length };
}
