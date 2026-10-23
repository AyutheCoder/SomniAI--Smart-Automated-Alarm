// The web-to-native alarm form. Dates are built with local-time constructors,
// so these hold in whatever time zone the tests run.
import { describe, expect, it } from "vitest";
import { toNativeAlarm } from "./nativeAlarm";
import type { Alarm } from "./types";

type Input = Parameters<typeof toNativeAlarm>[0];

function alarm(over: Partial<Input> = {}): Input {
  return {
    _id: "64f0a1",
    label: "Gym",
    scheduledTime: new Date(2026, 9, 25, 6, 30).toISOString(),
    repeat: { type: "none" },
    enabled: true,
    ...over,
  };
}

describe("toNativeAlarm", () => {
  it("a one-off keeps its local date and clock time", () => {
    expect(toNativeAlarm(alarm())).toEqual({ id: "64f0a1", label: "Gym", hour: 6, minute: 30, date: "2026-10-25", enabled: true });
  });

  it("an alarm just after midnight is on the new day", () => {
    const n = toNativeAlarm(alarm({ scheduledTime: new Date(2026, 9, 26, 0, 5).toISOString() }));
    expect(n).toMatchObject({ hour: 0, minute: 5, date: "2026-10-26" });
  });

  it("repeats map to days with Sunday as 0, and drop the date", () => {
    expect(toNativeAlarm(alarm({ repeat: { type: "daily" } })).days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(toNativeAlarm(alarm({ repeat: { type: "weekdays" } })).days).toEqual([1, 2, 3, 4, 5]);
    const custom = toNativeAlarm(alarm({ repeat: { type: "custom", days: [6, 0, 6, 9] } }));
    expect(custom.days).toEqual([0, 6]);
    expect(custom.date).toBeUndefined();
  });

  it("a custom repeat with no days rings once, as nextOccurrence treats it", () => {
    const n = toNativeAlarm(alarm({ repeat: { type: "custom", days: [] } }));
    expect(n.days).toBeUndefined();
    expect(n.date).toBe("2026-10-25");
  });

  it("carries the ring plan and the enabled flag", () => {
    const ringPlan = { version: 1 } as unknown as Alarm["ringPlan"];
    expect(toNativeAlarm(alarm({ enabled: false, ringPlan }))).toMatchObject({ enabled: false, ringPlan: { version: 1 } });
  });

  it("refuses an alarm without a valid time rather than guessing one", () => {
    expect(() => toNativeAlarm(alarm({ scheduledTime: "not a date" }))).toThrow(/no valid time/);
  });
});
