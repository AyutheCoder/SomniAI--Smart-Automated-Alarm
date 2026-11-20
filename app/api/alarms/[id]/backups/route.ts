import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { BACKUP_KINDS, type BackupKind } from "@/lib/backupAdapters";
import { requestBackups } from "@/lib/backupServer";
import { fcmFromEnv } from "@/lib/push";
import { twilioFromEnv } from "@/lib/sms";
import { Alarm, type AlarmDocument } from "@/models/Alarm";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * A ringing alarm has reached its backup level (prompt 3.3, lib/backupServer.ts):
 * ring the user's other devices now, and say when the people will be told.
 * `fromToken` is the asking phone's own push token, so it isn't rung again.
 * The ringing device never waits on this: it asks in the background.
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
    const body = (await parseJson<{ kinds?: unknown; fromToken?: unknown }>(req)) ?? {};
    const kinds = body.kinds;
    if (!Array.isArray(kinds) || kinds.length === 0 || new Set(kinds).size !== kinds.length
      || !kinds.every((k) => (BACKUP_KINDS as readonly unknown[]).includes(k))) {
      return jsonError(`kinds must be a list of distinct backups: ${BACKUP_KINDS.join(", ")}`, 422);
    }
    if (body.fromToken !== undefined && (typeof body.fromToken !== "string" || body.fromToken.length > 4096)) {
      return jsonError("fromToken must be this device's push token", 422);
    }
    const alarm = await Alarm.findOne({ _id: id, userId }).lean<AlarmDocument & { _id: unknown }>();
    if (!alarm) {
      return jsonError("Alarm not found", 404);
    }
    return jsonOk(await requestBackups(userId, alarm, kinds as BackupKind[], body.fromToken as string | undefined, fcmFromEnv(), twilioFromEnv()));
  });
}
