import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { Alarm } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { isOccurredAt } from "@/lib/validate";

interface FireBody {
  /** When it rang, if it is being reported later (a phone that was offline). */
  at?: string;
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
    const body = (await parseJson<FireBody>(req)) ?? {};
    if (body.at !== undefined && !isOccurredAt(body.at)) {
      return jsonError("at must be an ISO time within the last 7 days and not in the future", 422);
    }
    const alarm = await Alarm.findOneAndUpdate({ _id: id, userId }, { $set: { status: "ringing" } }, { new: true }).lean();
    if (!alarm) {
      return jsonError("Alarm not found", 404);
    }
    await BehaviorEvent.create({
      userId,
      type: "alarm_fire",
      meta: { alarmId: id, reportedLate: body.at !== undefined },
      at: body.at ? new Date(body.at) : new Date(),
    });
    return jsonOk(alarm);
  });
}
