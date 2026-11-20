import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { deleteTelemetry, invalidWake, recordWake, telemetrySummary, type WakeInput } from "@/lib/telemetry";
import { withIdempotency } from "@/lib/idempotency";

/** The user's telemetry: their consent, how many wakes are held, the latest few. */
export async function GET() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    return jsonOk(await telemetrySummary(userId));
  });
}

/**
 * One wake from the phone (WakeTelemetry.java). Stored only under consent
 * that covers it (lib/telemetry.ts); otherwise refused with 403, which the
 * phone's outbox treats as final and drops.
 */
export async function POST(req: NextRequest) {
  // Sent again by an outbox after a dropped connection: answered once (lib/idempotency.ts, 7.3).
  return repeatSafePost(req, undefined);
}

const repeatSafePost = withIdempotency(async (req: NextRequest) => {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = await parseJson<unknown>(req);
    const invalid = invalidWake(body);
    if (invalid) {
      return jsonError(invalid, 422);
    }
    await connectToDatabase();
    const result = await recordWake(userId, body as WakeInput);
    if (result === "no_consent") {
      return jsonError("No consent covers this wake, so it isn't stored", 403);
    }
    return jsonOk({ result }, { status: result === "stored" ? 201 : 200 });
  });
});

/** Deletes every wake the user has. Consent stays as it is. */
export async function DELETE() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    return jsonOk(await deleteTelemetry(userId));
  });
}
