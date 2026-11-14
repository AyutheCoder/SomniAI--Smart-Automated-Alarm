import { SensorUnavailable, type ScreenSample, type SensorAdapter } from "./types";

/** Whether this page is visible and in use. Outside a browser: start() rejects. */
export class ScreenAdapter implements SensorAdapter<ScreenSample> {
  readonly kind = "screen" as const;
  readonly supported: boolean;
  readonly simulated = false;
  private running = false;
  private lastInteraction = Date.now();
  private emit?: (s: ScreenSample) => void;
  private timer?: ReturnType<typeof setInterval>;
  private listeners: Array<[
    string,
    EventTarget,
    EventListener
  ]> = [];

  constructor() {
    this.supported = typeof document !== "undefined";
  }

  start(onSample: (s: ScreenSample) => void) {
    if (this.running) {
      return;
    }
    if (!this.supported) {
      throw new SensorUnavailable("screen", "unsupported", "There is no page to watch here.");
    }
    this.running = true;
    this.emit = onSample;
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

export function createScreenAdapter() {
  return new ScreenAdapter();
}
