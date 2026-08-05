import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
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
    const level = Math.min(5, Math.max(1, body.level ?? 5));
    const backups = Array.isArray(body.backups) ? body.backups : [];
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
    const emergencyContacted = backups.includes("emergencyContact");
    return jsonOk({
      ok: true,
      level,
      backups,
      emergencyContacted,
    });
  });
}