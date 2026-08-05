import type { MicSample, SensorAdapter } from "./types";

type WindowWithAudio = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export class MicAdapter implements SensorAdapter<MicSample> {
  readonly kind = "mic" as const;
  readonly supported: boolean;
  readonly simulated: boolean;
  private running = false;
  private raf = 0;
  private timer?: ReturnType<typeof setInterval>;
  private ctx?: AudioContext;
  private stream?: MediaStream;

  constructor(opts: {
    simulate?: boolean;
  } = {}) {
    const hasApi = typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof window !== "undefined" &&
      ("AudioContext" in window || "webkitAudioContext" in window);
    this.supported = hasApi && !opts.simulate;
    this.simulated = !this.supported;
  }

  async start(onSample: (s: MicSample) => void) {
    if (this.running) {
      return;
    }
    this.running = true;
    if (this.simulated) {
      this.startSimulator(onSample);
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctx = window.AudioContext || (window as WindowWithAudio).webkitAudioContext!;
      this.ctx = new Ctx();
      const source = this.ctx.createMediaStreamSource(this.stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (!this.running) {
          return;
        }
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sum / buffer.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -100;
        onSample({ rms, db, at: Date.now() });
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    } catch {
      this.simulateFallback();
      this.startSimulator(onSample);
    }
  }

  private simulateFallback() {
    (this as {
      simulated: boolean;
    }).simulated = true;
  }

  private startSimulator(onSample: (s: MicSample) => void) {
    this.timer = setInterval(() => {
      const base = 0.01 + Math.random() * 0.02;
      const event = Math.random() < 0.1 ? Math.random() * 0.3 : 0;
      const rms = Math.min(1, base + event);
      const db = 20 * Math.log10(rms);
      onSample({ rms, db, at: Date.now() });
    }, 500);
  }

  stop() {
    this.running = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    void this.ctx?.close();
    this.ctx = undefined;
  }

  isRunning() {
    return this.running;
  }
}

export function createMicAdapter(opts?: {
  simulate?: boolean;
}) {
  return new MicAdapter(opts);
}