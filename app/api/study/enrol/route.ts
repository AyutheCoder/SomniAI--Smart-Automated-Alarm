import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { enrol, StudyError } from "@/lib/studyServer";

/** Joins the study with an enrolment code, agreeing to the consent document's version shown (prompt 6.2). */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<{ code?: unknown; consentVersion?: unknown; agree?: unknown; tz?: unknown }>(req)) ?? {};
    if (typeof body.code !== "string" || body.code.trim().length === 0 || body.code.length > 40) {
      return jsonError("code is required", 422);
    }
    if (body.agree !== true || typeof body.consentVersion !== "string") {
      return jsonError("agreeing to the consent document is required, with its version", 422);
    }
    let tz = "UTC";
    if (typeof body.tz === "string") {
      try {
        new Intl.DateTimeFormat("en", { timeZone: body.tz });
        tz = body.tz;
      }
      catch {
        return jsonError("tz must be a timezone like Asia/Kolkata", 422);
      }
    }
    await connectToDatabase();
    try {
      return jsonOk(await enrol(userId, body.code, body.consentVersion, tz), { status: 201 });
    }
    catch (e) {
      if (e instanceof StudyError) {
        return jsonError(e.message, e.status);
      }
      throw e;
    }
  });
}
