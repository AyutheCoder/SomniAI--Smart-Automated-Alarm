import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { normalizeCode } from "@/lib/buddy";
import { activePairFor, publicName } from "@/lib/buddyServer";
import { BuddyInvite, BuddyPair } from "@/models/Buddy";

/**
 * Ask to pair, with the code someone gave you: your consent. Nothing is
 * active until they accept (requests/[id]): theirs.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const body = (await parseJson<{ code?: unknown }>(req)) ?? {};
    const code = normalizeCode(body.code);
    if (!code) {
      return jsonError("That isn't an invite code: it's 8 letters and numbers, like ABCD-EFGH", 422);
    }
    const invite = await BuddyInvite.findOne({ code, expiresAt: { $gt: new Date() } }).lean<{ userId: string }>();
    if (!invite) {
      return jsonError("No invite has that code, or it has expired. Ask for a new one.", 404);
    }
    if (invite.userId === userId) {
      return jsonError("That's your own invite code. Give it to the person you want as your buddy.", 422);
    }
    if (await activePairFor(userId)) {
      return jsonError("You already have a buddy. Unpair first.", 409);
    }
    if (await activePairFor(invite.userId)) {
      return jsonError("They already have a buddy.", 409);
    }
    const pending = await BuddyPair.findOne({ status: "requested", ownerId: invite.userId, requesterId: userId }).lean<{ _id: unknown }>();
    if (pending) {
      return jsonError("You've already asked them. They need to accept.", 409);
    }
    const created = await BuddyPair.create({ ownerId: invite.userId, requesterId: userId, status: "requested", requestedAt: new Date() });
    return jsonOk({ requestId: String(created._id), name: await publicName(invite.userId), status: "requested" }, { status: 201 });
  });
}
