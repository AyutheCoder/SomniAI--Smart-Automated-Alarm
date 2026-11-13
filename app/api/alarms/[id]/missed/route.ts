import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { isInt, isOccurredAt } from "@/lib/validate";
import { recordWakeReport, ringAtOf } from "@/lib/wakeReportServer";
import { Alarm, type AlarmDocument } from "@/models/Alarm";

interface MissedBody {
  /** When the ring ended unanswered (or, if it never rang, when it was noticed). */
  at?: string;
  /** The level it reached; the phone knows, a ring that never happened has none. */
  level?: number;
  /** False when no device rang it: a page that wasn't open, for one. */
  rang?: boolean;
}

type RouteContext = { params: Promise<{ id: string }> };

/**
 * A ring nobody answered (prompt 3.4): the phone sends this when a ring gives
 * up after 20 minutes, the web page for an alarm whose time passed while it
 * was closed. It records the morning report, which counts against the streak
 * and tells the escalation profile the whole ladder wasn't enough. The alarm
 * itself is left as it is: a wake buddy is still told about it.
 */
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
    const body = (await parseJson<MissedBody>(req)) ?? {};
    if (body.at !== undefined && !isOccurredAt(body.at)) {
      return jsonError("at must be an ISO time within the last 7 days and not in the future", 422);
    }
    if (body.level !== undefined && !isInt(body.level, 1, 5)) {
      return jsonError("level must be a whole number from 1 to 5", 422);
    }
    if (body.rang !== undefined && typeof body.rang !== "boolean") {
      return jsonError("rang must be true or false", 422);
    }
    const alarm = await Alarm.findOne({ _id: id, userId }).lean<AlarmDocument & { _id: unknown }>();
    if (!alarm) {
      return jsonError("Alarm not found", 404);
    }
    const rang = body.rang ?? true;
    await recordWakeReport(userId, alarm, ringAtOf(alarm), {
      outcome: "missed",
      endedAt: body.at ? new Date(body.at) : new Date(),
      rang,
      level: rang ? body.level ?? null : null,
    });
    return jsonOk((await Alarm.findOne({ _id: id, userId }).lean()) ?? alarm);
  });
}
