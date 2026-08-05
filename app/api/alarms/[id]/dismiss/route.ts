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

interface DismissBody {
  confidence?: number;
  responseMs?: number;
  verified?: boolean;
}

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const WEEKDAYS = [1, 2, 3, 4, 5];

function nextOccurrence(from: Date, repeat: AlarmDocument["repeat"]): Date | null {
  if (!repeat || repeat.type === "none") {
    return null;
  }
  const allowedDays = repeat.type === "weekdays"
    ? WEEKDAYS
    : repeat.type === "custom"
      ? repeat.days ?? []
      : null;

  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  for (let i = 1; i <= 14; i++) {
    candidate.setDate(candidate.getDate() + 1);
    if (!allowedDays || allowedDays.includes(candidate.getDay())) {
      return candidate;
    }
  }
  return null;
}

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
    const verified = body.verified ?? true;
    const confidence = typeof body.confidence === "number"
      ? Math.min(100, Math.max(0, body.confidence))
      : undefined;

    const existing = await Alarm.findOne({ _id: id, userId });
    if (!existing) {
      return jsonError("Alarm not found", 404);
    }
    const priorSnoozes = existing.lastSnoozeCount ?? 0;
    const next = nextOccurrence(existing.scheduledTime, existing.repeat);
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
      },
      at: new Date(),
    });

    await BehaviorEvent.create({
      userId,
      type: verified ? "verify_pass" : "verify_fail",
      value: confidence,
      meta: { alarmId: id },
      at: new Date(),
    });

    await recordWakeFeedback(userId, id, existing, {
      verified,
      confidence,
      priorSnoozes,
      responseMs: body.responseMs,
    });

    return jsonOk(existing.toObject());
  });
}

interface WakeFeedbackArgs {
  verified: boolean;
  confidence?: number;
  priorSnoozes: number;
  responseMs?: number;
}

async function recordWakeFeedback(userId: string, alarmId: string, alarm: AlarmDocument, args: WakeFeedbackArgs): Promise<void> {
  try {
    const outcome: FeedbackOutcome = !args.verified
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