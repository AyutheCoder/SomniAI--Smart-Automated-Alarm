import type { WakeStrategy } from "./types";
export type BackupKind = "secondaryAlarm" | "smartwatch" | "smartLight" | "smartSpeaker" | "emergencyContact";
export type WakeStage = "ramp" | "vibration" | "challenge";
export interface EscalationLevel {
  level: 1 | 2 | 3 | 4 | 5;
  afterSeconds: number;
  label: string;
  volumeFactor: number;
  vibrate: boolean;
  requireVerification: boolean;
  backup: BackupKind[];
  stage: WakeStage;
}
const TIMELINE: Record<WakeStrategy, [
  number,
  number,
  number,
  number
]> = {
  gentle: [20, 40, 60, 120],
  adaptive: [10, 22, 35, 75],
  aggressive: [5, 10, 18, 40],
};
const ALL_BACKUPS: BackupKind[] = [
  "secondaryAlarm",
  "smartwatch",
  "smartLight",
  "smartSpeaker",
  "emergencyContact",
];
/**
 * What past wakes revealed about how hard this person is to wake.
 *
 * `effectiveLevel` is the escalation level at which they actually got up, per
 * resolved alarm - level 1 for someone who wakes to a normal alarm, level 4 for
 * someone who never moves before the challenge.
 */
export interface WakeResponseHistory {
  effectiveLevels: number[];
  /** Alarms linked to something the user cannot miss. */
  criticalPending?: boolean;
}

export interface EscalationProfile {
  /** Level this user typically needs; the ladder opens just below it. */
  typicalLevel: number;
  /** Level that has always worked; the ladder need not exceed it by much. */
  reliableLevel: number;
  /** Scales the fixed timeline. <1 escalates sooner, >1 gives more grace. */
  paceFactor: number;
  samples: number;
}

const clampLevel = (n: number) => Math.max(1, Math.min(5, n));

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    return 3;
  }
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

/**
 * Derive a personal escalation profile from wake history.
 *
 * The fixed ladder treats every sleeper identically, which is wrong in both
 * directions: a light sleeper gets blasted through vibration and a challenge
 * they never needed, while a heavy sleeper crawls through three ineffective
 * levels before anything that works. Reading the level that historically woke
 * *this* person lets the ladder start near it and stop shortly past it -
 * minimum effective dose rather than a fixed sequence.
 *
 * Needs a few resolved alarms before it will move anything; below that the
 * shared default is the better estimate.
 */
export function deriveEscalationProfile(history: WakeResponseHistory): EscalationProfile {
  const levels = (history.effectiveLevels ?? []).filter(
    (n) => Number.isFinite(n) && n >= 1 && n <= 5,
  );
  if (levels.length < 3) {
    return { typicalLevel: 1, reliableLevel: 5, paceFactor: 1, samples: levels.length };
  }

  const sorted = [...levels].sort((a, b) => a - b);
  const typical = quantile(sorted, 0.5);
  // The level that has covered nearly every past wake, plus one rung of margin.
  const reliable = clampLevel(quantile(sorted, 0.9) + 1);

  // Someone who habitually needs level 4 should not spend the same dwell time on
  // levels 1-3 as someone who wakes at level 1.
  const paceFactor = typical >= 4 ? 0.6 : typical === 3 ? 0.8 : typical <= 1 ? 1.25 : 1;

  return {
    typicalLevel: clampLevel(typical),
    reliableLevel: reliable,
    paceFactor,
    samples: levels.length,
  };
}

export function buildEscalationPlan(
  strategy: WakeStrategy,
  profile?: EscalationProfile,
): EscalationLevel[] {
  const [t2, t3, t4, t5] = TIMELINE[strategy] ?? TIMELINE.adaptive;
  return [
    {
      level: 1,
      afterSeconds: 0,
      label: "Normal alarm",
      volumeFactor: 1,
      vibrate: false,
      requireVerification: false,
      backup: [],
      stage: "ramp",
    },
    {
      level: 2,
      afterSeconds: t2,
      label: "Increased volume",
      volumeFactor: 1.4,
      vibrate: false,
      requireVerification: false,
      backup: [],
      stage: "ramp",
    },
    {
      level: 3,
      afterSeconds: t3,
      label: "Continuous vibration",
      volumeFactor: 1.5,
      vibrate: true,
      requireVerification: false,
      backup: [],
      stage: "vibration",
    },
    {
      level: 4,
      afterSeconds: t4,
      label: "Wake challenge",
      volumeFactor: 1.6,
      vibrate: true,
      requireVerification: true,
      backup: [],
      stage: "challenge",
    },
    {
      level: 5,
      afterSeconds: t5,
      label: "Emergency backup",
      volumeFactor: 1.8,
      vibrate: true,
      requireVerification: true,
      backup: ALL_BACKUPS,
      stage: "challenge",
    },
  ];
}

/**
 * Personalize a ladder: reach the level that works for this sleeper sooner, and
 * do not climb far past it without cause.
 *
 * Timings compress by the profile's pace factor, and every level at or below the
 * one that historically wakes them keeps its full escalation - there is no point
 * spending 20 quiet seconds on someone who has never once woken before level 4.
 * The ceiling is never lowered for an alarm tied to something unmissable: for
 * those, the full ladder including emergency backup stays available regardless
 * of habit.
 */
export function personalizeEscalationPlan(
  plan: EscalationLevel[],
  profile: EscalationProfile,
  opts: { critical?: boolean } = {},
): EscalationLevel[] {
  if (profile.samples < 3) {
    return plan;
  }
  const compressed = plan.map((lvl) => ({
    ...lvl,
    afterSeconds: Math.round(lvl.afterSeconds * profile.paceFactor),
  }));

  if (opts.critical) {
    return compressed;
  }

  // Beyond the level that reliably wakes them, stop adding pressure: keep the
  // rung available but drop the backup blast a habitual level-2 waker will
  // never need.
  return compressed.map((lvl) =>
    lvl.level > profile.reliableLevel
      ? { ...lvl, backup: [], label: `${lvl.label} (held back)` }
      : lvl,
  );
}
export function levelForElapsed(elapsedSec: number, plan: EscalationLevel[]): EscalationLevel {
  let active = plan[0];
  for (const lvl of plan) {
    if (elapsedSec >= lvl.afterSeconds)
      active = lvl;
  }
  return active;
}
export const STAGE_LABELS: Record<WakeStage, string> = {
  ramp: "Gentle wake",
  vibration: "Escalating",
  challenge: "Verify you're awake",
};