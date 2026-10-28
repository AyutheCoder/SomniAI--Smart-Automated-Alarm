import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { PushToken } from "@/models/Buddy";

/** FCM registration tokens are long opaque strings; this only keeps out obvious junk. */
function isToken(v: unknown): v is string {
  return typeof v === "string" && v.length >= 20 && v.length <= 4096 && !/\s/.test(v);
}

/**
 * This phone can receive buddy alerts for the signed-in user. A token is one
 * phone's; if another account signs in there, the token moves to it.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const body = (await parseJson<{ token?: unknown }>(req)) ?? {};
    if (!isToken(body.token)) {
      return jsonError("token must be the phone's push token", 422);
    }
    await PushToken.findOneAndUpdate(
      { token: body.token },
      { $set: { userId, platform: "android", updatedAt: new Date() } },
      { upsert: true },
    );
    return jsonOk({ registered: true });
  });
}

/** This phone stops receiving alerts for this user (signing out). */
export async function DELETE(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const body = (await parseJson<{ token?: unknown }>(req)) ?? {};
    if (!isToken(body.token)) {
      return jsonError("token must be the phone's push token", 422);
    }
    const { deletedCount } = await PushToken.deleteOne({ token: body.token, userId });
    return jsonOk({ removed: deletedCount > 0 });
  });
}
