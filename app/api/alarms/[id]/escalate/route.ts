import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { isInt, isStringList } from "@/lib/validate";
import { Alarm } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";

interface EscalateBody {
  level?: number;
  backups?: string[];
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
    const body = (await parseJson<EscalateBody>(req)) ?? {};
    if (body.level !== undefined && !isInt(body.level, 1, 5)) {
      return jsonError("level must be a whole number from 1 to 5", 422);
    }
    if (body.backups !== undefined && !isStringList(body.backups)) {
      return jsonError("backups must be a list of backup names", 422);
    }
    const level = body.level ?? 5;
    const backups = body.backups ?? [];
    const alarm = await Alarm.findOne({ _id: id, userId });
    if (!alarm) {
      return jsonError("Alarm not found", 404);
    }
    await BehaviorEvent.create({
      userId,
      type: "escalation",
      value: level,
      meta: { alarmId: id, backups },
      at: new Date(),
    });
    // This records that the ladder reached a level. It contacts nobody, so it
    // must not say it did (it used to return emergencyContacted: true).
    return jsonOk({ level, backups });
  });
}