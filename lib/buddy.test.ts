import { describe, expect, it } from "vitest";
import {
  ALERT_AFTER_DEFAULT,
  CODE_LENGTH,
  DEFAULT_SETTINGS,
  RATE,
  STALE_AFTER_MINUTES,
  alertText,
  alertVerdict,
  clampAlertAfter,
  formatCode,
  makeInviteCode,
  normalizeCode,
  normalizePhone,
  occurrenceKey,
  rateVerdict,
  sharedPhone,
  type BuddySettings,
  type PastAlert,
} from "./buddy";

const RING = new Date("2026-10-28T07:00:00.000Z");
const min = (m: number) => new Date(RING.getTime() + m * 60_000);
const settings = (s: Partial<BuddySettings> = {}): BuddySettings => ({ ...DEFAULT_SETTINGS, ...s });
const critical = { at: RING, critical: true, enabled: true };

describe("invite codes", () => {
  it("are 8 characters from an alphabet without look-alikes", () => {
    for (let i = 0; i < 500; i++) {
      const code = makeInviteCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(code).not.toMatch(/[01OIL]/);
      expect(normalizeCode(code)).toBe(code);
    }
    expect(CODE_LENGTH).toBe(8);
  });

  it("are read back however they were typed", () => {
    expect(normalizeCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeCode(" ABCD EFGH ")).toBe("ABCDEFGH");
    expect(formatCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });

  it("refuse anything that can't be a code", () => {
    for (const bad of ["", "ABCDEFG", "ABCDEFGHJ", "ABCD-EFG0", "ABCDEFGI", "abcd_efgh", 12345678, null, undefined, {}]) {
      expect(normalizeCode(bad)).toBeNull();
    }
  });
});

describe("the phone number the call button dials", () => {
  it("keeps digits and a leading +", () => {
    expect(normalizePhone("+44 7700 900-123")).toBe("+447700900123");
    expect(normalizePhone("(555) 010 9999")).toBe("5550109999");
    for (const bad of ["", "12345", "phone", "+44 7700 abc", "1".repeat(16), 447700900123, null]) {
      expect(normalizePhone(bad)).toBeNull();
    }
  });

  it("is only put in an alert when the sleeper agreed to share it", () => {
    expect(sharedPhone(settings({ phone: "+447700900123", sharePhone: true }))).toBe("+447700900123");
    expect(sharedPhone(settings({ phone: "+447700900123", sharePhone: false }))).toBeNull();
    expect(sharedPhone(settings({ phone: null, sharePhone: true }))).toBeNull();
  });
});

describe("when the buddy is told (trigger timing)", () => {
  it("not before the set number of minutes after the alarm, then at once", () => {
    const s = settings({ alertAfterMinutes: 15 });
    expect(alertVerdict(critical, s, false, min(0))).toEqual({ due: false, reason: "not_yet" });
    expect(alertVerdict(critical, s, false, new Date(min(15).getTime() - 1))).toEqual({ due: false, reason: "not_yet" });
    expect(alertVerdict(critical, s, false, min(15))).toEqual({ due: true, dueAt: min(15) });
    expect(alertVerdict(critical, s, false, min(16))).toMatchObject({ due: true });
  });

  it("follows the user's own delay", () => {
    for (const after of [5, 10, 30, 60]) {
      const s = settings({ alertAfterMinutes: after });
      expect(alertVerdict(critical, s, false, min(after - 1)).due).toBe(false);
      expect(alertVerdict(critical, s, false, min(after)).due).toBe(true);
    }
  });

  it("never once they verified or stopped the alarm", () => {
    expect(alertVerdict(critical, settings(), true, min(20))).toEqual({ due: false, reason: "awake" });
  });

  it("never for an ordinary alarm unless the user opted in", () => {
    const ordinary = { ...critical, critical: false };
    expect(alertVerdict(ordinary, settings(), false, min(20))).toEqual({ due: false, reason: "ordinary" });
    expect(alertVerdict(ordinary, settings({ ordinaryAlarms: true }), false, min(20)).due).toBe(true);
    expect(DEFAULT_SETTINGS.ordinaryAlarms).toBe(false);
  });

  it("never for an alarm that is off", () => {
    expect(alertVerdict({ ...critical, enabled: false }, settings(), false, min(20))).toEqual({ due: false, reason: "off" });
  });

  it("not for a ring long gone: the check was down", () => {
    const s = settings({ alertAfterMinutes: 15 });
    expect(alertVerdict(critical, s, false, min(15 + STALE_AFTER_MINUTES)).due).toBe(true);
    expect(alertVerdict(critical, s, false, new Date(min(15 + STALE_AFTER_MINUTES).getTime() + 1))).toEqual({ due: false, reason: "stale" });
  });

  it("keeps the delay within 5 to 60 minutes, and defaults to 15", () => {
    expect(ALERT_AFTER_DEFAULT).toBe(15);
    expect(clampAlertAfter(1)).toBe(5);
    expect(clampAlertAfter(500)).toBe(60);
    expect(clampAlertAfter(12.4)).toBe(12);
    expect(clampAlertAfter(undefined)).toBe(15);
    expect(clampAlertAfter(Number.NaN)).toBe(15);
  });
});

describe("the rate limit", () => {
  const key = occurrenceKey("a1", RING);
  const past = (occurrence: string, status: PastAlert["status"], minutesAgo: number, now: Date): PastAlert =>
    ({ occurrence, status, at: new Date(now.getTime() - minutesAgo * 60_000) });

  it("allows the first alert", () => {
    expect(rateVerdict([], key, min(15))).toEqual({ allowed: true });
  });

  it("one alert per ring, whatever happened to it, except a push-service failure", () => {
    const now = min(16);
    for (const status of ["sent", "no_device", "not_configured"] as const) {
      expect(rateVerdict([past(key, status, 1, now)], key, now)).toEqual({ allowed: false, reason: "already" });
    }
    expect(rateVerdict([past(key, "failed", 1, now)], key, now)).toEqual({ allowed: true });
  });

  it("gives up on a ring after three failed tries", () => {
    const now = min(18);
    const tries = Array.from({ length: RATE.attemptsPerOccurrence }, (_, i) => past(key, "failed", i + 1, now));
    expect(rateVerdict(tries.slice(0, 2), key, now)).toEqual({ allowed: true });
    expect(rateVerdict(tries, key, now)).toEqual({ allowed: false, reason: "gave_up" });
  });

  it("no two alerts within 30 minutes, even for different alarms", () => {
    const now = min(15);
    const other = occurrenceKey("a2", RING);
    expect(rateVerdict([past(other, "sent", 29, now)], key, now)).toEqual({ allowed: false, reason: "too_soon" });
    expect(rateVerdict([past(other, "sent", 30, now)], key, now)).toEqual({ allowed: true });
    expect(RATE.minGapMinutes).toBe(30);
  });

  it("at most three a day", () => {
    const now = min(15);
    const sent = [60, 120, 180].map((ago, i) => past(occurrenceKey(`x${i}`, RING), "sent", ago, now));
    expect(rateVerdict(sent.slice(0, 2), key, now)).toEqual({ allowed: true });
    expect(rateVerdict(sent, key, now)).toEqual({ allowed: false, reason: "daily_limit" });
    // A day later the oldest no longer counts.
    const older = [24 * 60, 120, 180].map((ago, i) => past(occurrenceKey(`y${i}`, RING), "sent", ago, now));
    expect(rateVerdict(older, key, now)).toEqual({ allowed: true });
    expect(RATE.maxPerDay).toBe(3);
  });

  it("only alerts that went out count towards the gap and the day", () => {
    const now = min(15);
    const others = [1, 2, 3, 4].map((ago, i) => past(occurrenceKey(`z${i}`, RING), "no_device", ago, now));
    expect(rateVerdict(others, key, now)).toEqual({ allowed: true });
  });
});

describe("what the buddy reads", () => {
  it("says what is known, not that they're asleep", () => {
    const t = alertText("Sam", "Flight", 15);
    expect(t.title).toBe("Sam hasn't confirmed they're awake");
    expect(t.body).toBe("Their \"Flight\" alarm went off 15 minutes ago and SomniAI hasn't heard back.");
    expect(t.title + t.body).not.toMatch(/asleep|hasn't woken/);
  });
});
