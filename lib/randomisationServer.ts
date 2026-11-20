// Assigning and logging the per-alarm randomisation (prompt 6.1). Server-only;
// the rules are in lib/randomisation.ts.
//
// An alarm is assigned when its ring plan is first worked out under an active
// randomisation, and keeps that assignment whenever the plan is worked out
// again. The unmissable rule is applied every time the plan is built: an
// unmissable alarm is never randomised (logged as excluded, no arm drawn), and
// an alarm that becomes unmissable later stops having its arm applied.

import { randomBytes } from "node:crypto";
import { armFor, auditAssignments, BLOCK_SIZE, EXPERIMENTS, type Arm, type Experiment, type LoggedAssignment } from "@/lib/randomisation";
import type { PlanStudy } from "@/lib/ringPlan";
import { Alarm } from "@/models/Alarm";
import { Assignment, Randomisation, type AssignmentDocument, type RandomisationDocument } from "@/models/Randomisation";

export async function startRandomisation(userId: string, experiment: Experiment, seed?: string, now = new Date()): Promise<RandomisationDocument> {
  await stopRandomisation(userId, now);
  // A seed given is kept as given; otherwise a random one, stored, so every assignment can be recomputed.
  const doc = await Randomisation.create({
    userId, experiment, seed: seed ?? randomBytes(8).toString("hex"), active: true, next: 0, startedAt: now, stoppedAt: null,
  });
  return doc.toObject();
}

export async function stopRandomisation(userId: string, now = new Date()): Promise<boolean> {
  const res = await Randomisation.updateMany({ userId, active: true }, { $set: { active: false, stoppedAt: now } });
  return res.modifiedCount > 0;
}

/**
 * The study's part in this alarm's plan, or null when no randomisation is
 * running. Assigns (and logs) on first sight; afterwards returns the logged
 * assignment, with the unmissable rule applied now.
 */
export async function studyFor(userId: string, alarmId: string, critical: boolean, now = new Date()): Promise<PlanStudy | null> {
  const config = await Randomisation.findOne({ userId, active: true }).lean<RandomisationDocument & { _id: unknown }>();
  if (!config) {
    return null;
  }
  const key = { alarmId, experiment: config.experiment, seed: config.seed };
  const existing = await Assignment.findOne(key).lean<AssignmentDocument>();
  if (existing) {
    if (existing.excluded || existing.arm === null) {
      return { experiment: config.experiment, arm: null, applied: false, reason: "unmissable" };
    }
    if (critical) {
      if (!existing.overriddenAt) {
        await Assignment.updateOne(key, { $set: { overriddenAt: now } });
      }
      return { experiment: config.experiment, arm: existing.arm, applied: false, reason: "unmissable" };
    }
    return { experiment: config.experiment, arm: existing.arm, applied: true };
  }
  if (critical) {
    // Never randomised, and takes no sequence number: logged as excluded.
    await Assignment.create({ ...key, userId, sequence: null, block: null, arm: null, excluded: "unmissable", overriddenAt: null, assignedAt: now });
    return { experiment: config.experiment, arm: null, applied: false, reason: "unmissable" };
  }
  // The next sequence number, atomically, so two alarms set at once can't share one.
  const taken = await Randomisation.findOneAndUpdate({ _id: config._id, active: true }, { $inc: { next: 1 } }, { new: false })
    .lean<RandomisationDocument>();
  if (!taken) {
    return null;
  }
  const sequence = taken.next;
  const arm = armFor(config.seed, userId, config.experiment, sequence);
  await Assignment.create({
    ...key, userId, sequence, block: Math.floor(sequence / BLOCK_SIZE), arm, excluded: null, overriddenAt: null, assignedAt: now,
  });
  return { experiment: config.experiment, arm, applied: true };
}

function localClock(t: Date, tz: string | undefined): string {
  let zone = "UTC";
  try {
    if (tz) {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      zone = tz;
    }
  }
  catch {
    zone = "UTC";
  }
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
}

/**
 * The alarm whose wake plan the study doesn't show, if `wakeTime` (local
 * HH:MM) is one: an enabled alarm at that time whose plan says not_shown.
 */
export async function wakePlanWithheldFor(userId: string, wakeTime: string, tz: string | undefined): Promise<{ id: string; label: string } | null> {
  const alarms = await Alarm.find({ userId, enabled: true, "ringPlan.study.experiment": "wake_plan", "ringPlan.study.arm": "not_shown", "ringPlan.study.applied": true })
    .lean<{ _id: unknown; label: string; scheduledTime: Date; snoozedFrom?: Date | null }[]>();
  const hit = alarms.find((a) => localClock(new Date(a.snoozedFrom ?? a.scheduledTime), tz) === wakeTime);
  return hit ? { id: String(hit._id), label: hit.label } : null;
}

export interface RandomisationState {
  active: { experiment: Experiment; label: string; seed: string; startedAt: string; randomised: number } | null;
  /** Every logged assignment of this user's, newest first. */
  log: (LoggedAssignment & { alarmId: string; block: number | null; overriddenAt: string | null; assignedAt: string })[];
  /** Arms drawn under the active randomisation. */
  counts: Partial<Record<Arm, number>>;
  excluded: number;
  /** Logged arms that don't match a recomputation from the seed: none, unless the log was altered. */
  auditMismatches: number;
}

export async function randomisationState(userId: string): Promise<RandomisationState> {
  const [config, log] = await Promise.all([
    Randomisation.findOne({ userId, active: true }).lean<RandomisationDocument>(),
    Assignment.find({ userId }).sort({ assignedAt: -1 }).lean<AssignmentDocument[]>(),
  ]);
  const current = config ? log.filter((a) => a.seed === config.seed && a.experiment === config.experiment) : [];
  const counts: Partial<Record<Arm, number>> = {};
  for (const a of current) {
    if (a.arm && !a.excluded) {
      counts[a.arm] = (counts[a.arm] ?? 0) + 1;
    }
  }
  return {
    active: config
      ? { experiment: config.experiment, label: EXPERIMENTS[config.experiment].label, seed: config.seed, startedAt: config.startedAt.toISOString(), randomised: config.next }
      : null,
    log: log.map((a) => ({
      userId: a.userId, alarmId: a.alarmId, experiment: a.experiment, seed: a.seed, sequence: a.sequence, block: a.block,
      arm: a.arm, excluded: a.excluded, overriddenAt: a.overriddenAt?.toISOString() ?? null, assignedAt: a.assignedAt.toISOString(),
    })),
    counts,
    excluded: current.filter((a) => a.excluded).length,
    auditMismatches: auditAssignments(log).length,
  };
}
