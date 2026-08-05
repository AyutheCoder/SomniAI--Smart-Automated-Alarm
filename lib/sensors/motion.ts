import type { MotionSample, SensorAdapter } from "./types";

type DeviceMotionEventCtor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const G = 9.81;

export class MotionAdapter implements SensorAdapter<MotionSample> {
  readonly kind = "motion" as const;
  readonly supported: boolean;
  readonly simulated: boolean;
  private running = false;
  private handler?: (e: DeviceMotionEvent) => void;
  private timer?: ReturnType<typeof setInterval>;

  constructor(opts: {
    simulate?: boolean;
  } = {}) {
    const hasApi = typeof window !== "undefined" && "DeviceMotionEvent" in window;
    this.supported = hasApi && !opts.simulate;
    this.simulated = !this.supported;
  }

  async start(onSample: (s: MotionSample) => void) {
    if (this.running) {
      return;
    }
    this.running = true;
    if (this.simulated) {
      this.startSimulator(onSample);
      return;
    }

    const ctor = window.DeviceMotionEvent as DeviceMotionEventCtor;
    if (typeof ctor.requestPermission === "function") {
      try {
        const res = await ctor.requestPermission();
        if (res !== "granted") {
          this.startSimulator(onSample);
          return;
        }
      } catch {
        this.startSimulator(onSample);
        return;
      }
    }

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

  private startSimulator(onSample: (s: MotionSample) => void) {
    this.timer = setInterval(() => {
      const spike = Math.random() < 0.15 ? Math.random() * 18 : 0;
      const magnitude = Math.random() * 1.5 + spike;
      onSample({
        magnitude,
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2,
        z: G + (Math.random() - 0.5),
        at: Date.now(),
      });
    }, 500);
  }

  stop() {
    this.running = false;
    if (this.handler) {
      window.removeEventListener("devicemotion", this.handler);
      this.handler = undefined;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  isRunning() {
    return this.running;
  }
}

export function createMotionAdapter(opts?: {
  simulate?: boolean;
}) {
  return new MotionAdapter(opts);
}