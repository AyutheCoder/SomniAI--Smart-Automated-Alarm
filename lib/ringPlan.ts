// Everything an alarm needs to ring, worked out when the alarm is created.
//
// The ringing screen plays the alarm, climbs the escalation ladder and runs the
// wake challenge from this record alone, so nothing at ring time needs the
// server, the database or the AI Brain. If the AI Brain informed the plan it
// says so; if the Brain could not be reached, the rule-based plan is used and
// the record says that, and why.
//
// Pure and dependency-free so the browser can use it too: an alarm stored
// before ring plans existed gets one built on the device from its own fields.

import {
  buildEscalationPlan,
  personalizeEscalationPlan,
  type EscalationLevel,
  type EscalationProfile,
} from "./escalation";
import type { WakeStrategy } from "./types";

export const RING_PLAN_VERSION = 1;

export type ChallengeKind = "math" | "typing" | "shake" | "qr";
const CHALLENGE_KINDS: readonly ChallengeKind[] = ["math", "typing", "shake", "qr"];

/** How the AI Brain figured in a plan. */
export type BrainStatus = "used" | "unreachable" | "not_configured" | "not_asked";

export interface RingPlan {
  version: typeof RING_PLAN_VERSION;
  computedAt: string;
  /** Whether the AI Brain informed this plan or the rule-based fallback did. */
  decidedBy: "ai" | "fallback";
  /** One sentence on how the plan was decided, including why the fallback was used. */
  note: string;
  sound: { intensity: number; strategy: WakeStrategy };
  /** The whole ladder, timings included, as it will be climbed. */
  escalation: EscalationLevel[];
  challenge: { required: boolean; methods: ChallengeKind[]; minConfidence: number };
  critical: boolean;
  criticalReason: string | null;
  /** The predicted chance of waking off the usual time the plan was paced from. */
  prediction: { offScheduleChance: number; source: "ai" | "fallback" } | null;
  /** What changed the ladder from the plain one for this strategy, in words. */
  adjustments: string[];
}

export interface AlarmSettings {
  intensity: number;
  wakeStrategy: WakeStrategy;
  verificationRequired: boolean;
  verificationMethod: string;
  verificationMethods?: string[];
  minConfidence: number;
}

export interface RingPlanInputs extends AlarmSettings {
  critical?: { value: boolean; reason: string | null };
  /** How this user has actually responded to escalation, from their history. */
  profile?: EscalationProfile | null;
  prediction?: { offScheduleChance: number; source: "ai" | "fallback" } | null;
  brain: BrainStatus;
  now?: Date;
}

/** Above this predicted chance of waking off the usual time, escalate sooner. */
export const SOONER_THRESHOLD = 0.65;
const SOONER_FACTOR = 0.8;

const NOTES: Record<BrainStatus, string> = {
  used: "Paced with the AI Brain's prediction when the alarm was set.",
  unreachable: "The AI Brain couldn't be reached or gave no usable answer when this alarm was set, so the rule-based plan was used.",
  not_configured: "No AI Brain is configured, so the rule-based plan was used.",
  not_asked: "Built on this device from the alarm's own settings, because it was set before ring plans were stored. Rule-based.",
};

export function challengeMethods(settings: Pick<AlarmSettings, "verificationMethod" | "verificationMethods">): ChallengeKind[] {
  const raw = settings.verificationMethods && settings.verificationMethods.length > 0
    ? settings.verificationMethods
    : [settings.verificationMethod];
  const picked = raw.filter((m): m is ChallengeKind => CHALLENGE_KINDS.includes(m as ChallengeKind));
  return picked.length > 0 ? picked : ["math"];
}

export function buildRingPlan(inputs: RingPlanInputs): RingPlan {
  const critical = inputs.critical ?? { value: false, reason: null };
  const adjustments: string[] = [];

  let escalation = buildEscalationPlan(inputs.wakeStrategy);
  if (inputs.profile && inputs.profile.samples >= 3) {
    escalation = personalizeEscalationPlan(escalation, inputs.profile, { critical: critical.value });
    adjustments.push(critical.value
      ? `Paced to how you have responded to ${inputs.profile.samples} past alarms; the full ladder is kept because this alarm is critical.`
      : `Paced to how you have responded to ${inputs.profile.samples} past alarms.`);
  }

  const prediction = inputs.prediction ?? null;
  if (prediction && prediction.offScheduleChance > SOONER_THRESHOLD) {
    escalation = escalation.map((lvl) => ({ ...lvl, afterSeconds: Math.round(lvl.afterSeconds * SOONER_FACTOR) }));
    const from = prediction.source === "ai" ? "AI Brain" : "rule-based";
    adjustments.push(`Escalates sooner: ${Math.round(prediction.offScheduleChance * 100)}% predicted chance of waking off your usual time (${from}).`);
  }

  const decidedBy = inputs.brain === "used" && prediction?.source === "ai" ? "ai" : "fallback";
  return {
    version: RING_PLAN_VERSION,
    computedAt: (inputs.now ?? new Date()).toISOString(),
    decidedBy,
    note: NOTES[decidedBy === "ai" ? "used" : inputs.brain === "used" ? "unreachable" : inputs.brain],
    sound: { intensity: inputs.intensity, strategy: inputs.wakeStrategy },
    escalation,
    challenge: {
      required: inputs.verificationRequired && inputs.verificationMethod !== "none",
      methods: challengeMethods(inputs),
      minConfidence: inputs.minConfidence,
    },
    critical: critical.value,
    criticalReason: critical.reason,
    prediction,
    adjustments,
  };
}

/** Whether a stored value is a complete plan this code can ring from. */
export function isRingPlan(v: unknown): v is RingPlan {
  const p = v as Partial<RingPlan> | null | undefined;
  return p?.version === RING_PLAN_VERSION
    && Array.isArray(p.escalation) && p.escalation.length > 0
    && typeof p.sound?.intensity === "number"
    && Array.isArray(p.challenge?.methods)
    && typeof p.challenge?.required === "boolean";
}

/**
 * The plan to ring from: the stored one, or for an alarm set before plans
 * were stored, one built here from its own settings. Never calls anything.
 */
export function resolveRingPlan(alarm: AlarmSettings & { ringPlan?: unknown }): RingPlan {
  if (isRingPlan(alarm.ringPlan)) {
    return alarm.ringPlan;
  }
  return buildRingPlan({
    ...alarm,
    critical: { value: alarm.verificationRequired && alarm.minConfidence >= 80, reason: null },
    brain: "not_asked",
  });
}
