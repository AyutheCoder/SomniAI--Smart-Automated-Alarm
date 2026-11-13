// Records how each ring ended and builds its morning report (prompt 3.4).
// The dismiss route records an answered ring; /api/alarms/[id]/missed one
// nobody answered. Recording one updates the escalation profile, since the
// profile reads the reports (lib/wakeHistory.ts); when the profile changes,
// the alarms still to ring are replanned so the change takes effect.
// Server-only.

import type { AlarmDocument } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { SleepLog } from "@/models/SleepLog";
import { NightPlan, WakeReport, type WakeReportDocument } from "@/models/WakeReport";
import {
  buildMorningReport,
  planVerdict,
  stageFor,
  type MorningReport,
  type NightPlanFacts,
  type RingRecord,
  type WakeOutcome,
} from "./morningReport";
import { resolveRingPlan } from "./ringPlan";
import { refreshRingPlans } from "./ringPlanServer";
import { currentProfile } from "./wakeHistory";

/** A plan counts for a ring whose time is within this of the wake it was made for. */
const PLAN_MATCH_MS = 3 * 3_600_000;
/** A recorded bedtime counts for a plan if it's no earlier than this before the planned one. */
const BEDTIME_SEARCH_MS = 6 * 3_600_000;
/** How many rings back a streak is counted. */
const STREAK_WINDOW = 366;

type AlarmLike = AlarmDocument & { _id: unknown };

/** When this ring was due: the snoozed-from time, else the scheduled one. */
export function ringAtOf(alarm: Pick<AlarmDocument, "snoozedFrom" | "scheduledTime">): Date {
  return alarm.snoozedFrom ?? alarm.scheduledTime;
}

/** The server's record of the wake check for this ring, as the dismiss route found it. */
export interface CheckRecord {
  type: string;
  value?: number;
  meta?: { responseMs?: number | null; steps?: number | null; threshold?: number | null };
}

export interface RingEnd {
  outcome: WakeOutcome;
  endedAt: Date;
  rang: boolean;
  /** The level the ring reached; for an answered ring it's read from its escalation record. */
  level?: number | null;
  check?: CheckRecord | null;
}

/**
 * Stores how this ring ended, unless it already was (a resent call), and
 * replans the alarms still to ring if that changed the escalation profile.
 * Returns the stored record.
 */
export async function recordWakeReport(userId: string, alarm: AlarmLike, ringAt: Date, end: RingEnd): Promise<WakeReportDocument> {
  const alarmId = String(alarm._id);
  let level = end.level ?? null;
  if (end.outcome === "woke" && level === null) {
    // Both clients report the level a ring reached just before dismissing it.
    const reached = await BehaviorEvent.findOne({
      userId,
      type: "escalation",
      "meta.alarmId": alarmId,
      at: { $gte: new Date(ringAt.getTime() - 60_000), $lte: new Date(end.endedAt.getTime() + 60_000) },
    }).sort({ at: -1 }).lean<{ value?: number }>();
    level = typeof reached?.value === "number" ? reached.value : 1;
  }
  if (!end.rang) {
    level = null;
  }
  const plan = resolveRingPlan(alarm);
  const named = level === null ? null : stageFor(level, plan.escalation);
  const required = Boolean(alarm.verificationRequired && alarm.verificationMethod !== "none");
  const check = end.outcome === "woke" ? end.check ?? null : null;
  const seconds = typeof check?.meta?.responseMs === "number" ? Math.round(check.meta.responseMs / 100) / 10 : null;

  const record: Omit<WakeReportDocument, "createdAt"> = {
    userId,
    alarmId,
    label: alarm.label,
    ringAt,
    outcome: end.outcome,
    level,
    levelLabel: named?.label ?? null,
    stage: named?.stage ?? null,
    rang: end.rang,
    endedAt: end.endedAt,
    verification: {
      required,
      passed: check ? check.type === "verify_pass" : null,
      seconds,
      steps: typeof check?.meta?.steps === "number" ? check.meta.steps : null,
      score: typeof check?.value === "number" ? check.value : null,
      threshold: typeof check?.meta?.threshold === "number" ? check.meta.threshold : null,
    },
  };

  const before = await currentProfile(userId);
  const stored = await WakeReport.findOneAndUpdate(
    { userId, alarmId, ringAt },
    { $setOnInsert: record },
    { upsert: true, new: true },
  ).lean<WakeReportDocument>();
  const after = await currentProfile(userId);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await refreshRingPlans(userId);
  }
  return stored!;
}

function toRing(r: WakeReportDocument): RingRecord {
  return {
    alarmId: r.alarmId,
    label: r.label,
    ringAt: new Date(r.ringAt),
    outcome: r.outcome,
    level: r.level ?? null,
    levelLabel: r.levelLabel ?? null,
    stage: r.stage ?? null,
    rang: r.rang,
    endedAt: r.endedAt ? new Date(r.endedAt) : null,
    verification: {
      required: r.verification.required,
      passed: r.verification.passed ?? null,
      seconds: r.verification.seconds ?? null,
      steps: r.verification.steps ?? null,
      score: r.verification.score ?? null,
      threshold: r.verification.threshold ?? null,
    },
  };
}

/** The bedtime chosen for the night before this ring, if one was. */
async function planFor(userId: string, ringAt: Date): Promise<NightPlanFacts | null> {
  return NightPlan.findOne({
    userId,
    cancelledAt: { $exists: false },
    wakeAt: { $gte: new Date(ringAt.getTime() - PLAN_MATCH_MS), $lte: new Date(ringAt.getTime() + PLAN_MATCH_MS) },
  }).sort({ createdAt: -1 }).lean<NightPlanFacts>();
}

/** When you went to bed that night, from a recorded sleep log; never a simulated one. */
async function bedtimeFor(userId: string, plan: NightPlanFacts, ringAt: Date): Promise<Date | null> {
  const log = await SleepLog.findOne({
    userId,
    source: { $ne: "simulated" },
    sleepTime: { $gte: new Date(plan.bedtime.getTime() - BEDTIME_SEARCH_MS), $lte: ringAt },
  }).sort({ sleepTime: -1 }).lean<{ sleepTime: Date }>();
  return log ? new Date(log.sleepTime) : null;
}

/** The morning report for a stored ring. */
export async function buildReport(userId: string, stored: WakeReportDocument): Promise<MorningReport> {
  const ring = toRing(stored);
  const plan = await planFor(userId, ring.ringAt);
  const bedtime = plan ? await bedtimeFor(userId, plan, ring.ringAt) : null;
  const history = await WakeReport.find({ userId, ringAt: { $lte: ring.ringAt } })
    .sort({ ringAt: -1 })
    .limit(STREAK_WINDOW)
    .lean<{ outcome: WakeOutcome }[]>();
  return buildMorningReport(ring, planVerdict(plan, bedtime), history.map((h) => h.outcome), await currentProfile(userId));
}

/** The newest reports, or the newest for one alarm. */
export async function latestReports(userId: string, opts: { alarmId?: string; limit: number }): Promise<MorningReport[]> {
  const stored = await WakeReport.find({ userId, ...(opts.alarmId ? { alarmId: opts.alarmId } : {}) })
    .sort({ ringAt: -1 })
    .limit(opts.limit)
    .lean<WakeReportDocument[]>();
  return Promise.all(stored.map((s) => buildReport(userId, s)));
}
