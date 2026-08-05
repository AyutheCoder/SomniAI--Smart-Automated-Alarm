import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { Alarm } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_req: NextRequest, context: RouteContext) {
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
    const alarm = await Alarm.findOneAndUpdate({ _id: id, userId }, { $set: { status: "ringing" } }, { new: true }).lean();
    if (!alarm) {
      return jsonError("Alarm not found", 404);
    }
    await BehaviorEvent.create({
      userId,
      type: "alarm_fire",
      meta: { alarmId: id },
      at: new Date(),
    });
    return jsonOk(alarm);
  });
}