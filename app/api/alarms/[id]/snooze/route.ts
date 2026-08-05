import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { Alarm } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";

interface SnoozeBody {
  snoozeMinutes?: number;
  responseMs?: number;
}

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
    const minutes = Math.min(60, Math.max(1, Number(body.snoozeMinutes) || 5));
    const nextTime = new Date(Date.now() + minutes * 60000);
    const alarm = await Alarm.findOneAndUpdate({ _id: id, userId }, {
      $set: { scheduledTime: nextTime, status: "scheduled" },
      $inc: { lastSnoozeCount: 1 },
    }, { new: true }).lean<{
      _id: unknown;
      lastSnoozeCount: number;
    } | null>();
    if (!alarm) {
      return jsonError("Alarm not found", 404);
    }
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
    return jsonOk(alarm);
  });
}