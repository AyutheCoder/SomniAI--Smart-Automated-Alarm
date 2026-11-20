import { afterEach, describe, expect, it, vi } from "vitest";
import { MicAdapter, MotionAdapter, ScreenAdapter, SensorUnavailable } from ".";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// These ran a random-number "simulator" when a sensor was missing or refused,
// and the readings looked real. Now they say why and produce nothing (4.4).
describe("real sensors never make readings up", () => {
  it.each([
    ["motion", () => new MotionAdapter()],
    ["mic", () => new MicAdapter()],
    ["screen", () => new ScreenAdapter()],
  ] as const)("%s without the browser API: not supported, start refuses, no samples", async (kind, make) => {
    vi.useFakeTimers();
    const sensor = make();
    expect(sensor).toMatchObject({ kind, supported: false, simulated: false });
    const samples: unknown[] = [];
    await expect(Promise.resolve().then(() => sensor.start((s) => samples.push(s)))).rejects.toMatchObject({ kind, reason: "unsupported" });
    vi.advanceTimersByTime(10_000);
    expect(samples).toEqual([]);
    expect(sensor.isRunning()).toBe(false);
  });

  it("motion permission refused: start refuses, nothing is made up", async () => {
    vi.useFakeTimers();
    const ctor = Object.assign(function DeviceMotionEvent() {}, { requestPermission: vi.fn(async () => "denied") });
    vi.stubGlobal("window", { DeviceMotionEvent: ctor, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const sensor = new MotionAdapter();
    expect(sensor.supported).toBe(true);
    const samples: unknown[] = [];
    const err = await sensor.start((s) => samples.push(s)).catch((e) => e);
    expect(err).toBeInstanceOf(SensorUnavailable);
    expect(err).toMatchObject({ kind: "motion", reason: "refused" });
    vi.advanceTimersByTime(10_000);
    expect(samples).toEqual([]);
    expect(sensor.isRunning()).toBe(false);
  });

  it("microphone refused: start refuses, nothing is made up", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => { throw new DOMException("denied", "NotAllowedError"); }) } });
    vi.stubGlobal("window", { AudioContext: class {} });
    const sensor = new MicAdapter();
    expect(sensor.supported).toBe(true);
    const samples: unknown[] = [];
    await expect(sensor.start((s) => samples.push(s))).rejects.toMatchObject({ kind: "mic", reason: "refused" });
    vi.advanceTimersByTime(10_000);
    expect(samples).toEqual([]);
  });
});
