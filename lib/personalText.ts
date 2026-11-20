// What the personal predictions say (prompt 5.3), in one place: whether a
// figure is personal or the population model's, its likely range, and before
// the threshold, what's still needed. No word the prediction copy forbids.

import type { AlarmHabits, Estimate } from "./personal";
import type { PersonalPredictions } from "./personalServer";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const h = (x: number) => `${x.toFixed(1)} h`;
const nightsWord = (n: number) => `${n} ${n === 1 ? "night" : "nights"}`;
const secs = (ms: number) => (ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

export function sleepText(e: Estimate): string {
  if (e.basis === "personal") {
    return `Personal, from your ${nightsWord(e.nights)}: about ${h(e.estimate)} of sleep tonight, likely ${h(e.low)} to ${h(e.high)}. `
      + `Your own nights count for ${pct(e.ownWeight)} of this; the rest is the population model.`;
  }
  return `The population model's, not yet yours: about ${h(e.estimate)}, likely ${h(e.low)} to ${h(e.high)}, wide because people differ. `
    + `Personal after ${nightsWord(e.nightsToGo)} more with a sleep length logged.`;
}

export function regularityText(e: Estimate): string {
  if (e.basis === "personal") {
    return `Personal, from your ${nightsWord(e.nights)} with a known usual wake time: ${pct(e.estimate)} chance of waking close to it, `
      + `likely ${pct(e.low)} to ${pct(e.high)}.`;
  }
  return `The population model's, not yet yours: ${pct(e.estimate)} chance of waking close to your usual time, likely ${pct(e.low)} `
    + `to ${pct(e.high)}. Personal after ${nightsWord(e.nightsToGo)} more with a wake time (the first few only set your usual time).`;
}

export function alarmText(a: AlarmHabits | { basis: "off" }): string {
  if (a.basis === "off") {
    return "Turn on Alarm telemetry and SomniAI learns how you respond to alarms from your own wakes.";
  }
  if (a.basis === "none") {
    return `No dataset records alarms, so there is no population figure for this. After ${a.wakesToGo} more recorded `
      + `${a.wakesToGo === 1 ? "wake" : "wakes"}, yours will show here.`;
  }
  const parts = [`From your ${a.wakes} recorded wakes:`];
  if (a.snoozeChance) {
    parts.push(`you snooze on about ${pct(a.snoozeChance.estimate)} of mornings (likely ${pct(a.snoozeChance.low)} to ${pct(a.snoozeChance.high)})`);
  }
  if (a.firstTouchMs) {
    parts.push(`${a.snoozeChance ? "and " : ""}first touch the phone after about ${secs(a.firstTouchMs.estimate)} `
      + `(likely ${secs(a.firstTouchMs.low)} to ${secs(a.firstTouchMs.high)}).`);
  }
  return parts.join(" ").replace(/\)$/, ").");
}

export function personalLines(p: PersonalPredictions): { what: string; text: string }[] {
  const lines: { what: string; text: string }[] = [];
  if (!p.available || !p.sleep || !p.regularity) {
    lines.push({ what: "Personal predictions", text: p.reason ?? "Not available just now." });
  }
  else {
    lines.push({ what: "Sleep", text: sleepText(p.sleep) });
    lines.push({ what: "Waking close to your usual time", text: regularityText(p.regularity) });
  }
  lines.push({ what: "Alarm habits", text: alarmText(p.alarm) });
  return lines;
}
