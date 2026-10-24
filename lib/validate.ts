// Type guards for request fields. A route checks a field only when it is
// present; these answer "is this an acceptable value", never coerce one.

export function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}

export function isNum(v: unknown, lo = -Infinity, hi = Infinity): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
}

export function isStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** A calendar date as the app stores it: "2026-10-22", and a real day. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return false;
  }
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

/** How old a queued ring result may be when it finally reaches the server. */
export const OCCURRED_MAX_AGE_MS = 7 * 24 * 3600_000;
/** How far ahead of the server's clock a phone's clock may be. */
export const OCCURRED_MAX_SKEW_MS = 2 * 60_000;

/**
 * When something happened on a phone that sends it later (an alarm rung and
 * dismissed offline): an ISO time no more than a week old and not in the
 * future beyond a little clock skew.
 */
export function isOccurredAt(v: unknown, now: Date = new Date()): v is string {
  if (typeof v !== "string") {
    return false;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) && t <= now.getTime() + OCCURRED_MAX_SKEW_MS && t >= now.getTime() - OCCURRED_MAX_AGE_MS;
}

/** A 24-hour clock time: "07:30". */
export function isClockTime(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
