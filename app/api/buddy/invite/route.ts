import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { INVITE_TTL_MS, formatCode, makeInviteCode } from "@/lib/buddy";
import { activePairFor } from "@/lib/buddyServer";
import { BuddyInvite } from "@/models/Buddy";

/**
 * A code to give one person, valid for a day. Making a new one replaces the
 * old, so a code that went to the wrong person stops working.
 */
export async function POST() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    if (await activePairFor(userId)) {
      return jsonError("You already have a buddy. Unpair first to invite someone else.", 409);
    }
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    // 31^8 codes; a clash is unlikely, and the unique index makes it a retry rather than a mix-up.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeInviteCode();
      try {
        await BuddyInvite.findOneAndUpdate({ userId }, { $set: { code, expiresAt } }, { upsert: true });
        return jsonOk({ code: formatCode(code), expiresAt }, { status: 201 });
      }
      catch (e) {
        if ((e as { code?: number }).code !== 11000) {
          throw e;
        }
      }
    }
    return jsonError("Couldn't make a code. Try again.", 503);
  });
}

/** Withdraw the invite: the code stops working. */
export async function DELETE() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { deletedCount } = await BuddyInvite.deleteOne({ userId });
    return jsonOk({ withdrawn: deletedCount > 0 });
  });
}
