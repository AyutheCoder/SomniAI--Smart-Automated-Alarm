import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, guard } from "@/lib/http";
import { exportStudy } from "@/lib/studyServer";

/**
 * The anonymised export, for the researchers (prompt 6.2): with
 * "Authorization: Bearer <STUDY_EXPORT_TOKEN>". Not a participant's route,
 * and off unless the token is set. Participant codes, study days and times of
 * day; never a name, email, account, alarm id or label.
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const token = process.env.STUDY_EXPORT_TOKEN;
    if (!token) {
      return jsonError("STUDY_EXPORT_TOKEN is not set, so the study export is off on this server", 503);
    }
    const given = Buffer.from(req.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const data = await exportStudy();
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${data.study}-${data.exportedOn}.json"`,
        "cache-control": "no-store",
      },
    });
  });
}
