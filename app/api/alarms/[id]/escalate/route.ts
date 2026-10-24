import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { isInt, isOccurredAt } from "@/lib/validate";
import { BACKUP_KINDS, BACKUP_STATUSES, type BackupKind, type BackupStatus } from "@/lib/backupAdapters";
import { Alarm } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";

interface BackupReport {
  kind: BackupKind;
  status: BackupStatus;
}

interface EscalateBody {
  /** The level the ring had reached when it was stopped: how hard this wake was. */
  level?: number;
  /** What each backup channel the client tried actually did. */
  backups?: BackupReport[];
  /** When, if it is being reported later (a phone that was offline). */
  at?: string;
}

function isBackupReports(v: unknown): v is BackupReport[] {
  return Array.isArray(v) && v.every((b) =>
    b !== null && typeof b === "object"
    && (BACKUP_KINDS as readonly string[]).includes((b as BackupReport).kind)
    && BACKUP_STATUSES.includes((b as BackupReport).status));
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
    if (body.at !== undefined && !isOccurredAt(body.at)) {
      return jsonError("at must be an ISO time within the last 7 days and not in the future", 422);
    }
    if (body.backups !== undefined && !isBackupReports(body.backups)) {
      return jsonError(
        `backups must be a list of { kind, status }: kind one of ${BACKUP_KINDS.join(", ")}; `
        + `status one of ${BACKUP_STATUSES.join(", ")}`,
        422,
      );
    }
    const level = body.level ?? 5;
    const backups = (body.backups ?? []).map(({ kind, status }) => ({ kind, status }));
    const alarm = await Alarm.findOne({ _id: id, userId });
    if (!alarm) {
      return jsonError("Alarm not found", 404);
    }
    await BehaviorEvent.create({
      userId,
      type: "escalation",
      value: level,
      meta: { alarmId: id, backups, reportedLate: body.at !== undefined },
      at: body.at ? new Date(body.at) : new Date(),
    });
    // This records that the ladder reached a level and what the client's
    // backup channels reported. The route itself contacts nobody, so it must
    // not say it did (it used to return emergencyContacted: true).
    return jsonOk({ level, backups });
  });
}