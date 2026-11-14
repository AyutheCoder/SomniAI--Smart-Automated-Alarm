import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { setConsent } from "@/lib/telemetry";
import { TELEMETRY_CONSENT } from "@/lib/telemetryConsent";

/**
 * Gives or withdraws consent to telemetry. Giving it names the version of
 * the text the user saw, which must be the current one: consent to an older
 * text isn't consent to what is recorded now.
 */
export async function PUT(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<{ granted?: unknown; version?: unknown }>(req)) ?? {};
    if (typeof body.granted !== "boolean") {
      return jsonError("granted must be true or false", 422);
    }
    if (body.granted && body.version !== TELEMETRY_CONSENT.version) {
      return jsonError(`version must be the text shown, ${TELEMETRY_CONSENT.version}`, 422);
    }
    await connectToDatabase();
    return jsonOk(await setConsent(userId, body.granted));
  });
}
