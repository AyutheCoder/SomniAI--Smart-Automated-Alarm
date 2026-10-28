import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { stopBackups } from "@/lib/backupServer";
import { fcmFromEnv } from "@/lib/push";
import { Alarm } from "@/models/Alarm";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The alarm was stopped on the device that rang first: stop the backup ring
 * on the user's other devices. Sent through the phone's queue, so it arrives
 * once there's a network.
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
    const body = (await parseJson<{ fromToken?: unknown }>(req)) ?? {};
    if (body.fromToken !== undefined && typeof body.fromToken !== "string") {
      return jsonError("fromToken must be this device's push token", 422);
    }
    if (!(await Alarm.exists({ _id: id, userId }))) {
      return jsonError("Alarm not found", 404);
    }
    return jsonOk(await stopBackups(userId, id, body.fromToken as string | undefined, fcmFromEnv()));
  });
}
