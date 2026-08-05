import type { ScreenSample, SensorAdapter } from "./types";

export class ScreenAdapter implements SensorAdapter<ScreenSample> {
  readonly kind = "screen" as const;
  readonly supported: boolean;
  readonly simulated: boolean;
  private running = false;
  private lastInteraction = Date.now();
  private emit?: (s: ScreenSample) => void;
  private timer?: ReturnType<typeof setInterval>;
  private listeners: Array<[
    string,
    EventTarget,
    EventListener
  ]> = [];

  constructor(opts: {
    simulate?: boolean;
  } = {}) {
    const hasDom = typeof document !== "undefined";
    this.supported = hasDom && !opts.simulate;
    this.simulated = !this.supported;
  }

  start(onSample: (s: ScreenSample) => void) {
    if (this.running) {
      return;
    }
    this.running = true;
    this.emit = onSample;
    if (this.simulated) {
      this.startSimulator();
      return;
    }

    const onActivity = () => {
      this.lastInteraction = Date.now();
      this.sample();
    };

    const onVisibility = () => this.sample();
    this.bind(document, "visibilitychange", onVisibility);
    this.bind(window, "focus", onVisibility);
    this.bind(window, "blur", onVisibility);
    this.bind(window, "pointerdown", onActivity);
    this.bind(window, "keydown", onActivity);
    this.timer = setInterval(() => this.sample(), 1000);
    this.sample();
  }

  private bind(target: EventTarget, type: string, fn: EventListener) {
    target.addEventListener(type, fn);
    this.listeners.push([type, target, fn]);
  }

  private sample() {
    if (!this.emit) {
      return;
    }
    const visible = document.visibilityState === "visible";
    const focused = document.hasFocus();
    this.emit({
      state: visible ? "screen_on" : "screen_off",
      visible,
      focused,
      idleMs: Date.now() - this.lastInteraction,
      at: Date.now(),
    });
  }

  private startSimulator() {
    let visible = true;
    this.timer = setInterval(() => {
      if (Math.random() < 0.2) {
        visible = !visible;
      }
      this.emit?.({
        state: visible ? "screen_on" : "screen_off",
        visible,
        focused: visible,
        idleMs: visible ? Math.floor(Math.random() * 5000) : 60000,
        at: Date.now(),
      });
    }, 1500);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    for (const [type, target, fn] of this.listeners) {
      target.removeEventListener(type, fn);
    }
    this.listeners = [];
    this.emit = undefined;
  }

  isRunning() {
    return this.running;
  }
}

export function createScreenAdapter(opts?: {
  simulate?: boolean;
}) {
  return new ScreenAdapter(opts);
}