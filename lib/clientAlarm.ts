import type { WakeStrategy } from "./alarm";
type AlarmModule = typeof import("./alarm");
let mod: AlarmModule | null = null;
if (typeof window !== "undefined") {
  import("./alarm").then((m) => {
    mod = m;
  });
}
export interface StartAlarmOptions {
  intensity?: number;
  strategy?: WakeStrategy;
  onTick?: (elapsedMs: number, volume: number) => void;
}
export function startAlarm(opts: StartAlarmOptions = {}) {
  mod?.adaptiveAlarm.start(opts);
}
export function stopAlarm() {
  mod?.adaptiveAlarm.stop();
}
export function escalateAlarm(factor = 1.4) {
  mod?.adaptiveAlarm.escalate(factor);
}
export function isAlarmActive() {
  return mod?.adaptiveAlarm.isActive() ?? false;
}
export function vibrate(strategy: WakeStrategy = "adaptive") {
  if (typeof navigator === "undefined" || !navigator.vibrate)
    return;
  const patterns: Record<WakeStrategy, number[]> = {
    gentle: [200, 300, 200],
    adaptive: [400, 200, 400, 200, 400],
    aggressive: [600, 150, 600, 150, 600, 150, 600],
  };
  navigator.vibrate(patterns[strategy]);
}
let vibrateTimer: ReturnType<typeof setInterval> | null = null;
export function startVibrationLoop(strategy: WakeStrategy = "adaptive") {
  if (typeof navigator === "undefined" || !navigator.vibrate)
    return;
  if (vibrateTimer)
    return;
  const everyMs = strategy === "gentle" ? 4000 : strategy === "aggressive" ? 1500 : 2500;
  vibrate(strategy);
  vibrateTimer = setInterval(() => vibrate(strategy), everyMs);
}
export function stopVibration() {
  if (vibrateTimer) {
    clearInterval(vibrateTimer);
    vibrateTimer = null;
  }
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(0);
  }
}
export function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis)
    return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.pitch = 1;
  window.speechSynthesis.speak(utter);
}
export async function notify(title: string, body?: string) {
  if (typeof window === "undefined" || !("Notification" in window))
    return;
  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission === "granted") {
    new Notification(title, { body });
  }
}