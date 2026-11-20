// Gathers what an alarm's ring plan needs, when the alarm is created or
// changed, or when a morning report changes the escalation profile
// (refreshRingPlans): the user's escalation history (lib/wakeHistory.ts), the
// predicted chance of waking off their usual time (from the AI Brain, or the
// rule-based fallback when it can't be reached), and whether the alarm is
// critical. Server-only.

import mongoose from "mongoose";
import { buildUserSignals } from "@/lib/aiFeatures";
import { aiBrainConfigured, predictWakeSuccess } from "@/lib/aiClient";
import { buildRingPlan, type AlarmSettings, type BrainStatus, type RingPlan } from "@/lib/ringPlan";
import { studyFor } from "@/lib/randomisationServer";
import { currentProfile } from "@/lib/wakeHistory";
import { Alarm } from "@/models/Alarm";
import { Task } from "@/models/Task";

export interface PlanContext extends AlarmSettings {
  linkedTaskId?: string;
  /** The alarm's id, for the study's per-alarm randomisation (6.1). */
  _id?: unknown;
}

export interface KnownPrediction {
  offScheduleChance: number;
  source: "ai" | "fallback";
}


async function criticality(userId: string, ctx: PlanContext): Promise<{ value: boolean; reason: string | null }> {
  if (ctx.linkedTaskId && mongoose.Types.ObjectId.isValid(ctx.linkedTaskId)) {
    const task = await Task.findOne({ _id: ctx.linkedTaskId, userId })
      .lean<{ title: string; priority?: string; importanceScore?: number; intent?: string }>();
    if (task && (task.priority === "critical" || (task.importanceScore ?? 0) >= 80 || task.intent === "must-not-miss")) {
      return { value: true, reason: `Linked to "${task.title}", which can't be missed.` };
    }
  }
  if (ctx.verificationRequired && ctx.minConfidence >= 80) {
    return { value: true, reason: "Needs a strong wake check (80% or more) to turn off." };
  }
  return { value: false, reason: null };
}

export async function predict(userId: string): Promise<{ prediction: KnownPrediction | null; brain: BrainStatus }> {
  const configured = aiBrainConfigured();
  try {
    const { features } = await buildUserSignals(userId);
    const { data, source } = await predictWakeSuccess(features);
    const brain: BrainStatus = !configured ? "not_configured" : source === "ai" ? "used" : "unreachable";
    return { prediction: { offScheduleChance: data.oversleepProbability, source }, brain };
  }
  catch {
    return { prediction: null, brain: configured ? "unreachable" : "not_configured" };
  }
}

/**
 * The ring plan for an alarm with these settings. Pass `known` when the
 * caller already has a prediction (the scheduler does), to avoid asking twice.
 */
export async function computeRingPlan(
  userId: string,
  ctx: PlanContext,
  known?: { prediction: KnownPrediction | null; brain: BrainStatus },
): Promise<RingPlan> {
  // Read field by field: `ctx` may be a Mongoose document, whose values are
  // getters that a spread does not copy (that left plans with no sound).
  const settings: AlarmSettings = {
    intensity: ctx.intensity,
    wakeStrategy: ctx.wakeStrategy,
    verificationRequired: ctx.verificationRequired,
    verificationMethod: ctx.verificationMethod,
    verificationMethods: ctx.verificationMethods ? [...ctx.verificationMethods] : undefined,
    minConfidence: ctx.minConfidence,
  };
  const [profile, critical, predicted] = await Promise.all([
    currentProfile(userId),
    criticality(userId, { ...settings, linkedTaskId: ctx.linkedTaskId }),
    known ? Promise.resolve(known) : predict(userId),
  ]);
  // The study's arm for this alarm (6.1), assigned and logged on first sight; never for an unmissable one.
  const study = ctx._id ? await studyFor(userId, String(ctx._id), critical.value) : null;
  return buildRingPlan({
    ...settings,
    profile,
    critical,
    prediction: predicted.prediction,
    brain: predicted.brain,
    study,
  });
}

/**
 * Works out the ring plan again for every alarm still to ring, after the
 * escalation profile changed. The phone picks the new plans up when it next
 * reconciles; nothing changes at ring time. Returns how many were replanned.
 */
export async function refreshRingPlans(userId: string): Promise<number> {
  const alarms = await Alarm.find({ userId, enabled: true, status: { $in: ["scheduled", "snoozed"] } });
  if (alarms.length === 0) {
    return 0;
  }
  const known = await predict(userId);
  for (const alarm of alarms) {
    alarm.ringPlan = await computeRingPlan(userId, alarm as unknown as PlanContext, known);
    await alarm.save();
  }
  return alarms.length;
}
