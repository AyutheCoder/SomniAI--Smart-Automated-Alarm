import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { isInt, isNum } from "@/lib/validate";
import { Alarm } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";

interface SnoozeBody {
  snoozeMinutes?: number;
  responseMs?: number;
  /**
   * When the browser set the alarm to ring again. Sent because the snooze is
   * recorded after the ring, possibly much later if the server was down, and
   * "now + minutes" at that point would be the wrong time.
   */
  until?: string;
}

const DAY_MS = 86_400_000;

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
    const body = (await parseJson<SnoozeBody>(req)) ?? {};
    if (body.snoozeMinutes !== undefined && !isInt(body.snoozeMinutes, 1, 60)) {
      return jsonError("snoozeMinutes must be a whole number from 1 to 60", 422);
    }
    if (body.responseMs !== undefined && !isNum(body.responseMs, 0)) {
      return jsonError("responseMs must be a non-negative number", 422);
    }
    let until: Date | null = null;
    if (body.until !== undefined) {
      until = typeof body.until === "string" ? new Date(body.until) : null;
      const offset = until ? until.getTime() - Date.now() : NaN;
      if (!until || Number.isNaN(offset) || offset > 60 * 60_000 || offset < -DAY_MS) {
        return jsonError("until must be a time within the last day or the next hour", 422);
      }
    }
    const minutes = body.snoozeMinutes ?? 5;
    const alarm = await Alarm.findOne({ _id: id, userId });
    if (!alarm) {
      return jsonError("Alarm not found", 404);
    }
    // Keep the time the alarm was meant to ring. Snoozing moves scheduledTime,
    // and a recurring alarm re-armed from the snoozed time would drift later
    // every morning it is snoozed.
    alarm.snoozedFrom = alarm.snoozedFrom ?? alarm.scheduledTime;
    alarm.scheduledTime = until ?? new Date(Date.now() + minutes * 60000);
    alarm.status = "scheduled";
    alarm.lastSnoozeCount = (alarm.lastSnoozeCount ?? 0) + 1;
    await alarm.save();
    await BehaviorEvent.create({
      userId,
      type: "snooze",
      value: alarm.lastSnoozeCount,
      meta: {
        alarmId: id,
        snoozeMinutes: minutes,
        responseMs: body.responseMs ?? null,
      },
      at: new Date(),
    });
    return jsonOk(alarm.toObject());
  });
}