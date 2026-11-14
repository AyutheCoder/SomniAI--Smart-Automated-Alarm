import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { importNights, invalidNights } from "@/lib/sleepImport";

/**
 * Nights read from Health Connect on the phone (prompt 4.2), already folded
 * one per wake date (HealthNights.java). Each becomes that date's sleep log;
 * a night the user entered by hand is kept as they wrote it.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<{ nights?: unknown }>(req)) ?? {};
    const invalid = invalidNights(body.nights);
    if (invalid) {
      return jsonError(invalid, 422);
    }
    await connectToDatabase();
    return jsonOk(await importNights(userId, body.nights as Parameters<typeof importNights>[1]));
  });
}
