import { SensorUnavailable, type MicSample, type SensorAdapter } from "./types";

type WindowWithAudio = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

/** The microphone's level. No microphone, or permission refused: start() rejects. */
export class MicAdapter implements SensorAdapter<MicSample> {
  readonly kind = "mic" as const;
  readonly supported: boolean;
  readonly simulated = false;
  private running = false;
  private raf = 0;
  private ctx?: AudioContext;
  private stream?: MediaStream;

  constructor() {
    this.supported = typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof window !== "undefined" &&
      ("AudioContext" in window || "webkitAudioContext" in window);
  }

  async start(onSample: (s: MicSample) => void) {
    if (this.running) {
      return;
    }
    if (!this.supported) {
      throw new SensorUnavailable("mic", "unsupported", "This browser can't use a microphone.");
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    catch {
      throw new SensorUnavailable("mic", "refused", "Microphone access was refused or no microphone was found.");
    }
    this.running = true;
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
  }

  stop() {
    this.running = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
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

export function createMicAdapter() {
  return new MicAdapter();
}
