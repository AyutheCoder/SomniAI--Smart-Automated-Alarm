import { describe, expect, it } from "vitest";
import { bedtimeBefore, clockTime, loadReminder, nextWakeAt, reminderDue, saveReminder, type BedtimeReminder } from "./bedtime";
import type { KeyValueStore } from "./outbox";

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

describe("nextWakeAt", () => {
  it("is later today when that time is still ahead", () => {
    expect(nextWakeAt("23:30", at(2026, 10, 24, 21))).toEqual(at(2026, 10, 24, 23, 30));
  });
  it("is tomorrow once that time has gone, or is right now", () => {
    expect(nextWakeAt("06:30", at(2026, 10, 24, 21))).toEqual(at(2026, 10, 25, 6, 30));
    expect(nextWakeAt("21:00", at(2026, 10, 24, 21))).toEqual(at(2026, 10, 25, 21, 0));
  });
});

describe("bedtimeBefore: the planner counts bedtime past the midnight before the wake", () => {
  const wake = at(2026, 10, 25, 6, 30);
  it("22.25 is 22:15 the evening before", () => {
    expect(bedtimeBefore(wake, 22.25)).toEqual(at(2026, 10, 24, 22, 15));
  });
  it("24.5 is 00:30 on the wake day", () => {
    expect(bedtimeBefore(wake, 24.5)).toEqual(at(2026, 10, 25, 0, 30));
  });
  it("is no bedtime at all if it would fall after the wake", () => {
    expect(bedtimeBefore(wake, 31)).toBeNull();
  });
  it("formats as a 24-hour clock", () => {
    expect(clockTime(at(2026, 10, 25, 0, 5))).toBe("00:05");
  });
});

describe("the reminder", () => {
  const r: BedtimeReminder = { at: at(2026, 10, 24, 22, 15).toISOString(), wakeAt: at(2026, 10, 25, 6, 30).toISOString() };

  it("is due from its time until the wake, once", () => {
    expect(reminderDue(r, at(2026, 10, 24, 22, 14))).toBe(false);
    expect(reminderDue(r, at(2026, 10, 24, 22, 15))).toBe(true);
    expect(reminderDue(r, at(2026, 10, 25, 3))).toBe(true);
    expect(reminderDue({ ...r, shownAt: at(2026, 10, 24, 22, 15).toISOString() }, at(2026, 10, 24, 23))).toBe(false);
    expect(reminderDue(r, at(2026, 10, 25, 6, 30))).toBe(false);
    expect(reminderDue(null, at(2026, 10, 24, 23))).toBe(false);
  });

  it("is kept per user and survives a reload", () => {
    const data = new Map<string, string>();
    const store: KeyValueStore = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    saveReminder(store, "u1", r);
    expect(loadReminder(store, "u1")).toEqual(r);
    expect(loadReminder(store, "u2")).toBeNull();
    saveReminder(store, "u1", null);
    expect(loadReminder(store, "u1")).toBeNull();
  });

  it("comes back empty, not broken, when storage is blocked", () => {
    const blocked: KeyValueStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => saveReminder(blocked, "u1", r)).not.toThrow();
    expect(loadReminder(blocked, "u1")).toBeNull();
  });
});
