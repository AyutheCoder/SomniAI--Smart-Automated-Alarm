import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { isInt } from "@/lib/validate";
import { reportLines } from "@/lib/morningReport";
import { latestReports } from "@/lib/wakeReportServer";

/**
 * The newest morning reports (prompt 3.4), each with its lines in the
 * reader's time zone (`tz`, an IANA name such as Asia/Kolkata), so the page
 * and the phone's notification word them the same way.
 * `alarmId` narrows to one alarm's rings; `limit` is 1 to 30 (default 1).
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const params = new URL(req.url).searchParams;
    const limit = params.get("limit") === null ? 1 : Number(params.get("limit"));
    if (!isInt(limit, 1, 30)) {
      return jsonError("limit must be a whole number from 1 to 30", 422);
    }
    const alarmId = params.get("alarmId") ?? undefined;
    if (alarmId !== undefined && !mongoose.Types.ObjectId.isValid(alarmId)) {
      return jsonError("Invalid alarmId", 400);
    }
    const tz = params.get("tz") ?? "UTC";
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    }
    catch {
      return jsonError("tz must be a time zone name such as Asia/Kolkata", 422);
    }
    await connectToDatabase();
    const reports = await latestReports(userId, { alarmId, limit });
    return jsonOk({ reports: reports.map((report) => ({ ...report, lines: reportLines(report, tz) })), tz });
  });
}
