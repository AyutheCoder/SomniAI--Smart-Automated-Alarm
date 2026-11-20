// Made-up sensor readings for the developer simulator only (prompt 4.4). They
// used to be the real adapters' silent fallback: a refused microphone or a
// desktop without a motion sensor produced random readings. The real adapters
// (lib/sensors) now refuse instead; these are used only by the simulator page,
// which labels everything they produce "simulated".

import type { MicSample, MotionSample, ScreenSample, SensorAdapter, SensorKind } from "@/lib/sensors/types";

const G = 9.81;

class Simulated<T> implements SensorAdapter<T> {
  readonly supported = true;
  readonly simulated = true;
  private timer?: ReturnType<typeof setInterval>;

  constructor(readonly kind: SensorKind, private readonly every: number, private readonly make: () => T) {}

  start(onSample: (s: T) => void) {
    if (!this.timer) {
      this.timer = setInterval(() => onSample(this.make()), this.every);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  isRunning() {
    return this.timer !== undefined;
  }
}

export function simulatedMotion(): SensorAdapter<MotionSample> {
  return new Simulated("motion", 500, () => {
    const spike = Math.random() < 0.15 ? Math.random() * 18 : 0;
    return {
      magnitude: Math.random() * 1.5 + spike,
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: G + (Math.random() - 0.5),
      at: Date.now(),
    };
  });
}

export function simulatedMic(): SensorAdapter<MicSample> {
  return new Simulated("mic", 500, () => {
    const base = 0.01 + Math.random() * 0.02;
    const event = Math.random() < 0.1 ? Math.random() * 0.3 : 0;
    const rms = Math.min(1, base + event);
    return { rms, db: 20 * Math.log10(rms), at: Date.now() };
  });
}

export function simulatedScreen(): SensorAdapter<ScreenSample> {
  let visible = true;
  return new Simulated("screen", 1500, () => {
    if (Math.random() < 0.2) {
      visible = !visible;
    }
    return {
      state: visible ? "screen_on" : "screen_off",
      visible,
      focused: visible,
      idleMs: visible ? Math.floor(Math.random() * 5000) : 60000,
      at: Date.now(),
    };
  });
}
