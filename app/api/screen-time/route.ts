import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { importScreenNights, invalidScreenNights, type ScreenNightInput } from "@/lib/screenTime";

/**
 * Screen time before bed, measured on the phone (prompt 4.3): minutes per
 * night, never which apps. Each becomes that wake date's ScreenNight, which
 * the predictions' screen_minutes_before_bed is made from.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<{ nights?: unknown }>(req)) ?? {};
    const invalid = invalidScreenNights(body.nights);
    if (invalid) {
      return jsonError(invalid, 422);
    }
    await connectToDatabase();
    return jsonOk(await importScreenNights(userId, body.nights as ScreenNightInput[]));
  });
}
