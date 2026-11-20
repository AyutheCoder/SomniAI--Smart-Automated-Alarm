// Wake buddy (prompt 3.2): the decisions, with no database or network, so
// every one is tested (lib/buddy.test.ts). The routes and lib/buddyAlerts.ts
// apply them.
//
// Two users pair with consent on both sides: one shares an invite code, the
// other asks to pair with it, the first accepts. Either can unpair at any time.
// If one of them doesn't confirm they're awake after a critical alarm (or any
// alarm, if they opted in), the other gets a push with a button to call them.

/** Minutes after the alarm before the buddy is told. The user picks; this is the default. */
export const ALERT_AFTER_DEFAULT = 15;
export const ALERT_AFTER_MIN = 5;
export const ALERT_AFTER_MAX = 60;
/**
 * An occurrence this long past its alert time is not alerted: the check was
 * down, and a buddy woken about a morning that ended hours ago helps nobody.
 */
export const STALE_AFTER_MINUTES = 120;
/** Rate limit, per sleeper and buddy. */
export const RATE = {
  /** No two alerts closer than this, whatever the alarm. */
  minGapMinutes: 30,
  /** At most this many in any 24 hours. */
  maxPerDay: 3,
  /** Tries per alarm occurrence when the push service fails. */
  attemptsPerOccurrence: 3,
} as const;
export const INVITE_TTL_MS = 24 * 3_600_000;

/** No 0/O, 1/I/L: read aloud or typed half asleep, they get confused. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

/** A uniform random index below n, from Web Crypto (Node and browsers both have it; this file is shared). */
function secureIndex(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const word = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(word);
  } while (word[0] >= limit);
  return word[0] % n;
}

export function makeInviteCode(pick: (n: number) => number = secureIndex): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[pick(CODE_ALPHABET.length)];
  }
  return code;
}

/** "abcd-efgh", " ABCD EFGH " -> "ABCDEFGH"; null if it can't be a code. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

/** Shown as "ABCD-EFGH". */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export interface BuddySettings {
  alertAfterMinutes: number;
  /** Alerts for alarms that aren't critical too. Off unless the user turns it on. */
  ordinaryAlarms: boolean;
  /** The number the buddy's call button dials, and whether the user agreed to share it. */
  phone: string | null;
  sharePhone: boolean;
}

export const DEFAULT_SETTINGS: BuddySettings = {
  alertAfterMinutes: ALERT_AFTER_DEFAULT,
  ordinaryAlarms: false,
  phone: null,
  sharePhone: false,
};

/** "+44 7700 900-123" -> "+447700900123"; null if it isn't a plausible number. */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const digits = input.trim().replace(/[\s().-]/g, "");
  return /^\+?\d{6,15}$/.test(digits) ? digits : null;
}

/** The number to put in the alert: only one the sleeper agreed to share. */
export function sharedPhone(settings: BuddySettings): string | null {
  return settings.sharePhone && settings.phone ? settings.phone : null;
}

export interface AlarmOccurrence {
  /** When this ring was due: snoozedFrom if snoozed, else scheduledTime. */
  at: Date;
  critical: boolean;
  enabled: boolean;
}

export type AlertVerdict =
  | { due: true; dueAt: Date }
  | { due: false; reason: "off" | "ordinary" | "not_yet" | "stale" | "awake" };

/**
 * Whether the buddy should be told about this ring now. "awake" is whether
 * the server has heard the sleeper verified or stopped this ring since it was
 * due; it can't know about a phone that is still offline.
 */
export function alertVerdict(alarm: AlarmOccurrence, settings: BuddySettings, awake: boolean, now: Date): AlertVerdict {
  if (!alarm.enabled) {
    return { due: false, reason: "off" };
  }
  if (!alarm.critical && !settings.ordinaryAlarms) {
    return { due: false, reason: "ordinary" };
  }
  const after = clampAlertAfter(settings.alertAfterMinutes);
  const dueAt = new Date(alarm.at.getTime() + after * 60_000);
  if (now.getTime() < dueAt.getTime()) {
    return { due: false, reason: "not_yet" };
  }
  if (now.getTime() > dueAt.getTime() + STALE_AFTER_MINUTES * 60_000) {
    return { due: false, reason: "stale" };
  }
  if (awake) {
    return { due: false, reason: "awake" };
  }
  return { due: true, dueAt };
}

export function clampAlertAfter(minutes: unknown): number {
  const n = typeof minutes === "number" && Number.isFinite(minutes) ? Math.round(minutes) : ALERT_AFTER_DEFAULT;
  return Math.min(ALERT_AFTER_MAX, Math.max(ALERT_AFTER_MIN, n));
}

export type AlertStatus = "sent" | "failed" | "no_device" | "not_configured";

export interface PastAlert {
  /** Which ring: alarm id and when it was due. */
  occurrence: string;
  status: AlertStatus;
  at: Date;
}

export function occurrenceKey(alarmId: string, at: Date): string {
  return `${alarmId}@${at.toISOString()}`;
}

export type RateVerdict =
  | { allowed: true }
  | { allowed: false; reason: "already" | "gave_up" | "too_soon" | "daily_limit" };

/**
 * The rate limit, from this sleeper and buddy's past alerts. One alert per
 * ring (retried only when the push service failed), none closer than
 * RATE.minGapMinutes, at most RATE.maxPerDay a day. Only alerts that reached
 * the push service count towards the gap and the day.
 */
export function rateVerdict(history: PastAlert[], occurrence: string, now: Date): RateVerdict {
  const forThis = history.filter((h) => h.occurrence === occurrence);
  if (forThis.some((h) => h.status !== "failed")) {
    return { allowed: false, reason: "already" };
  }
  if (forThis.length >= RATE.attemptsPerOccurrence) {
    return { allowed: false, reason: "gave_up" };
  }
  const sent = history.filter((h) => h.status === "sent");
  const t = now.getTime();
  if (sent.some((h) => t - h.at.getTime() < RATE.minGapMinutes * 60_000)) {
    return { allowed: false, reason: "too_soon" };
  }
  if (sent.filter((h) => t - h.at.getTime() < 24 * 3_600_000).length >= RATE.maxPerDay) {
    return { allowed: false, reason: "daily_limit" };
  }
  return { allowed: true };
}

/**
 * The text to the emergency contact (3.3): who, which alarm, how long, and
 * why they're getting it. As with the buddy, it says what is known.
 */
export function contactText(name: string, label: string, minutes: number): string {
  return `SomniAI: ${name} hasn't confirmed they're awake. Their "${label}" alarm went off ${minutes} minutes ago. `
    + `You're their emergency contact; please check on them. (Automated message.)`;
}

/** What the buddy's phone shows. The wording says what is known: no confirmation, not "asleep". */
export function alertText(name: string, label: string, minutes: number): { title: string; body: string } {
  return {
    title: `${name} hasn't confirmed they're awake`,
    body: `Their "${label}" alarm went off ${minutes} minutes ago and SomniAI hasn't heard back.`,
  };
}
