import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { Alarm, type AlarmDocument } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { Task } from "@/models/Task";
import { User } from "@/models/User";
import { recordFeedback } from "@/lib/rlFeedback";
import type { FeedbackOutcome, RlContext } from "@/lib/aiClient";
import { isNum, isOccurredAt } from "@/lib/validate";
import { nextOccurrence } from "@/lib/recurrence";

interface DismissBody {
  responseMs?: number;
  /** When it was dismissed, if it is being reported later (a phone that was offline). */
  at?: string;
  // `verified` and `confidence` used to be read from here, which let a client
  // mark an alarm verified that the server had scored as failed. The verdict
  // now comes only from the verify route's own record.
}

/** A verify result counts for this ring only if it is this recent. */
const VERIFY_WINDOW_MS = 30 * 60_000;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};


export async function POST(req: NextRequest, context: RouteContext) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError("Invalid id", 400);
    }
    const body = (await parseJson<DismissBody>(req)) ?? {};
    if (body.responseMs !== undefined && !isNum(body.responseMs, 0)) {
      return jsonError("responseMs must be a non-negative number", 422);
    }
    if (body.at !== undefined && !isOccurredAt(body.at)) {
      return jsonError("at must be an ISO time within the last 7 days and not in the future", 422);
    }
    const dismissedAt = body.at ? new Date(body.at) : new Date();

    const existing = await Alarm.findOne({ _id: id, userId });
    if (!existing) {
      return jsonError("Alarm not found", 404);
    }

    // The verify route scores the challenge server-side and records the result;
    // that record, not the client's claim, says whether this ring was verified.
    // The window is around the dismissal itself, so a ring a phone reports
    // hours later still finds the verification it made at the time.
    const verdict = await BehaviorEvent.findOne({
      userId,
      type: { $in: ["verify_pass", "verify_fail"] },
      "meta.alarmId": id,
      at: { $gte: new Date(dismissedAt.getTime() - VERIFY_WINDOW_MS), $lte: new Date(dismissedAt.getTime() + 60_000) },
    }).sort({ at: -1 }).lean<{ type: string; value?: number }>();
    const verified = verdict?.type === "verify_pass";
    const confidence = verdict?.value;
    const verificationRequired = existing.verificationRequired && existing.verificationMethod !== "none";

    const priorSnoozes = existing.lastSnoozeCount ?? 0;
    const next = nextOccurrence(existing.snoozedFrom ?? existing.scheduledTime, existing.repeat, new Date());
    existing.snoozedFrom = undefined;
    if (next) {
      existing.scheduledTime = next;
      existing.status = "scheduled";
      existing.lastSnoozeCount = 0;
      existing.enabled = true;
    } else {
      existing.status = verified ? "verified" : "dismissed";
      existing.enabled = false;
    }
    await existing.save();

    await BehaviorEvent.create({
      userId,
      type: "dismiss",
      value: confidence,
      meta: {
        alarmId: id,
        verified,
        responseMs: body.responseMs ?? null,
        recurring: Boolean(next),
        reportedLate: body.at !== undefined,
      },
      at: dismissedAt,
    });
    // No verify_pass/verify_fail here: the verify route already recorded the
    // one verdict, and logging it again double-counted every wake.

    await recordWakeFeedback(userId, id, existing, {
      // An alarm with no challenge to fail cannot have been "missed" by failing it.
      woke: verified || !verificationRequired,
      confidence,
      priorSnoozes,
      responseMs: body.responseMs,
    });

    return jsonOk(existing.toObject());
  });
}

interface WakeFeedbackArgs {
  woke: boolean;
  confidence?: number;
  priorSnoozes: number;
  responseMs?: number;
}

async function recordWakeFeedback(userId: string, alarmId: string, alarm: AlarmDocument, args: WakeFeedbackArgs): Promise<void> {
  try {
    const outcome: FeedbackOutcome = !args.woke
      ? "missed"
      : args.priorSnoozes > 0
        ? "snooze"
        : "success";

    const day = new Date(alarm.scheduledTime).getDay();
    const context: RlContext = { isWeekend: day === 0 || day === 6 };
    const [user, task] = await Promise.all([
      User.findById(userId).lean(),
      alarm.linkedTaskId
        ? Task.findOne({ _id: alarm.linkedTaskId, userId }).lean()
        : Promise.resolve(null),
    ]);

    const chronotype = (user as { chronotype?: RlContext["chronotype"] })
      ?.chronotype;
    if (chronotype) {
      context.chronotype = chronotype;
    }
    const importance = (task as { importanceScore?: number })
      ?.importanceScore;
    if (typeof importance === "number") {
      context.taskImportance = Math.min(1, Math.max(0, importance / 100));
    }

    const satisfaction = typeof args.confidence === "number" ? (args.confidence - 50) / 50 : 0;
    const ttwMin = typeof args.responseMs === "number" ? args.responseMs / 60000 : undefined;

    await recordFeedback({
      userId,
      alarmId,
      context,
      action: {
        offsetMin: 0,
        strategy: alarm.wakeStrategy,
        intensity: alarm.intensity,
      },
      outcome,
      snoozes: args.priorSnoozes,
      ttwMin,
      satisfaction,
    });
  } catch {
    // Ignore feedback error
  }
}