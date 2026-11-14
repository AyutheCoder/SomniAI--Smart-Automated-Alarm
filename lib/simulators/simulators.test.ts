import { afterEach, describe, expect, it, vi } from "vitest";
import { simulateCalendar, simulateWearable, simulateWeather, withSimulated } from "./context";
import { simulatedMic, simulatedMotion, simulatedScreen } from "./sensors";

afterEach(() => {
  vi.useRealTimers();
});

describe("the developer simulator's context", () => {
  it("labels every made-up group simulated", () => {
    const data = withSimulated({ sources: { weather: "missing", calendar: "missing", wearable: "missing" } });
    expect(data.sources).toEqual({ weather: "simulated", calendar: "simulated", wearable: "simulated" });
    expect(data.wearable?.restingHr).toEqual(expect.any(Number));
    expect(data.calendar?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps live weather live, and leaves the real context it was given alone", () => {
    const real = { weather: { tempC: 30, condition: "Rain" }, sources: { weather: "live" as const, calendar: "missing" as const, wearable: "missing" as const } };
    const data = withSimulated(real);
    expect(data.weather).toEqual({ tempC: 30, condition: "Rain" });
    expect(data.sources).toEqual({ weather: "live", calendar: "simulated", wearable: "simulated" });
    expect(real.sources).toEqual({ weather: "live", calendar: "missing", wearable: "missing" });
  });

  it("makes values in plausible ranges", () => {
    for (let i = 0; i < 50; i++) {
      const w = simulateWeather();
      expect(w.tempC).toBeGreaterThanOrEqual(10);
      expect(w.tempC).toBeLessThanOrEqual(30);
      const r = simulateWearable();
      expect(r.restingHr).toBeGreaterThanOrEqual(52);
      expect(r.restingHr).toBeLessThan(72);
    }
    const events = simulateCalendar(new Date("2026-11-14T12:00:00Z"));
    expect(events.map((e) => e.start)).toEqual([...events.map((e) => e.start)].sort());
  });
});

describe("the developer simulator's sensors", () => {
  it.each([
    ["motion", simulatedMotion],
    ["mic", simulatedMic],
    ["screen", simulatedScreen],
  ] as const)("%s says it is simulated, and stops when told", (kind, make) => {
    vi.useFakeTimers();
    const sensor = make();
    expect(sensor).toMatchObject({ kind, simulated: true, supported: true });
    const samples: unknown[] = [];
    sensor.start((s) => samples.push(s));
    vi.advanceTimersByTime(3000);
    expect(samples.length).toBeGreaterThan(0);
    expect(sensor.isRunning()).toBe(true);
    sensor.stop();
    const before = samples.length;
    vi.advanceTimersByTime(3000);
    expect(samples.length).toBe(before);
    expect(sensor.isRunning()).toBe(false);
  });
});
