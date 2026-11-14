import { SensorUnavailable, type MotionSample, type SensorAdapter } from "./types";

type DeviceMotionEventCtor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const G = 9.81;

/** The device's accelerometer. No accelerometer, or permission refused: start() rejects. */
export class MotionAdapter implements SensorAdapter<MotionSample> {
  readonly kind = "motion" as const;
  readonly supported: boolean;
  readonly simulated = false;
  private running = false;
  private handler?: (e: DeviceMotionEvent) => void;

  constructor() {
    this.supported = typeof window !== "undefined" && "DeviceMotionEvent" in window;
  }

  async start(onSample: (s: MotionSample) => void) {
    if (this.running) {
      return;
    }
    if (!this.supported) {
      throw new SensorUnavailable("motion", "unsupported", "This browser has no motion sensor.");
    }
    const ctor = window.DeviceMotionEvent as DeviceMotionEventCtor;
    if (typeof ctor.requestPermission === "function") {
      const res = await ctor.requestPermission().catch(() => "denied" as const);
      if (res !== "granted") {
        throw new SensorUnavailable("motion", "refused", "Motion sensor access was refused.");
      }
    }
    this.running = true;
    this.handler = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc) {
        return;
      }
      const x = acc.x ?? 0;
      const y = acc.y ?? 0;
      const z = acc.z ?? 0;
      const magnitude = Math.abs(Math.sqrt(x * x + y * y + z * z) - G);
      onSample({ magnitude, x, y, z, at: Date.now() });
    };
    window.addEventListener("devicemotion", this.handler);
  }

  stop() {
    this.running = false;
    if (this.handler) {
      window.removeEventListener("devicemotion", this.handler);
      this.handler = undefined;
    }
  }

  isRunning() {
    return this.running;
  }
}

export function createMotionAdapter() {
  return new MotionAdapter();
}
