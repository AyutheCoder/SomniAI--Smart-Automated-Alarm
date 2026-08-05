export type WakeStrategy = "gentle" | "adaptive" | "aggressive";
interface StartOptions {
  intensity?: number;
  strategy?: WakeStrategy;
  onTick?: (elapsedMs: number, volume: number) => void;
}
class AdaptiveAlarm {
  private ctx: AudioContext | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private rampTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private active = false;
  private maxVolume = 0.3;
  private rampStep = 0.04;
  isActive() {
    return this.active;
  }
  start(opts: StartOptions = {}) {
    if (this.active)
      return;
    if (typeof window === "undefined")
      return;
    const intensity = Math.min(100, Math.max(0, opts.intensity ?? 60));
    const strategy: WakeStrategy = opts.strategy ?? "adaptive";
    const AudioCtx = window.AudioContext ||
      (window as unknown as {
        webkitAudioContext: typeof AudioContext;
      })
        .webkitAudioContext;
    this.ctx = new AudioCtx();
    if (this.ctx.state === "suspended")
      this.ctx.resume();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.osc1 = this.ctx.createOscillator();
    this.osc1.type = "triangle";
    this.osc1.frequency.value = 440;
    this.osc2 = this.ctx.createOscillator();
    this.osc2.type = "sine";
    this.osc2.frequency.value = 554;
    this.osc1.connect(this.gain);
    this.osc2.connect(this.gain);
    const baseVolume = (intensity / 100) * 0.35;
    this.gain.gain.value = strategy === "gentle" ? baseVolume * 0.25 : baseVolume * 0.5;
    this.osc1.start();
    this.osc2.start();
    this.startedAt = Date.now();
    this.active = true;
    const rampStep = strategy === "gentle" ? 0.01 : strategy === "aggressive" ? 0.08 : 0.04;
    const maxVolume = strategy === "gentle" ? baseVolume : Math.min(0.6, baseVolume * 1.6);
    this.rampStep = rampStep;
    this.maxVolume = maxVolume;
    this.rampTimer = setInterval(() => {
      if (!this.ctx || !this.gain || !this.osc1)
        return;
      const elapsed = Date.now() - this.startedAt;
      const wobble = 1 + 0.15 * Math.sin(elapsed / 200);
      this.osc1.frequency.setValueAtTime(440 * wobble, this.ctx.currentTime);
      const next = Math.min(this.maxVolume, this.gain.gain.value + this.rampStep * 0.05);
      this.gain.gain.setValueAtTime(next, this.ctx.currentTime);
      opts.onTick?.(elapsed, next);
    }, 250);
  }
  escalate(factor = 1.4) {
    if (!this.active)
      return;
    this.maxVolume = Math.min(0.85, this.maxVolume * factor);
    this.rampStep = Math.min(0.2, this.rampStep * factor);
    if (this.ctx && this.gain) {
      const bumped = Math.min(this.maxVolume, this.gain.gain.value * factor);
      this.gain.gain.setValueAtTime(bumped, this.ctx.currentTime);
    }
  }
  stop() {
    if (this.rampTimer) {
      clearInterval(this.rampTimer);
      this.rampTimer = null;
    }
    try {
      this.osc1?.stop();
      this.osc2?.stop();
    }
    catch (e) {
    }
    this.osc1?.disconnect();
    this.osc2?.disconnect();
    this.gain?.disconnect();
    this.ctx?.close();
    this.osc1 = null;
    this.osc2 = null;
    this.gain = null;
    this.ctx = null;
    this.active = false;
  }
}
export const adaptiveAlarm = new AdaptiveAlarm();