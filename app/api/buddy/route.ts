import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { formatCode, sharedPhone } from "@/lib/buddy";
import { activePairFor, contactFor, otherSide, publicName, settingsFor } from "@/lib/buddyServer";
import { fcmFromEnv } from "@/lib/push";
import { twilioFromEnv } from "@/lib/sms";
import { BuddyAlert, BuddyInvite, BuddyPair, PushToken } from "@/models/Buddy";

/**
 * Everything the buddy panel shows: the active buddy, this user's open
 * invite, requests waiting on either side, their settings, whether this
 * account has a phone that can receive alerts, and the last alerts sent
 * about them.
 */
export async function GET() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const now = new Date();
    const [pair, invite, incoming, outgoing, settings, devices, alerts] = await Promise.all([
      activePairFor(userId),
      BuddyInvite.findOne({ userId, expiresAt: { $gt: now } }).lean<{ code: string; expiresAt: Date }>(),
      BuddyPair.find({ ownerId: userId, status: "requested" }).sort({ requestedAt: -1 }).lean<{ _id: unknown; requesterId: string; requestedAt: Date }[]>(),
      BuddyPair.find({ requesterId: userId, status: "requested" }).sort({ requestedAt: -1 }).lean<{ _id: unknown; ownerId: string; requestedAt: Date }[]>(),
      settingsFor(userId),
      PushToken.countDocuments({ userId }),
      BuddyAlert.find({ sleeperId: userId }).sort({ at: -1 }).limit(10).lean<{ channel?: string; status: string; at: Date; alarmId: string }[]>(),
    ]);
    let buddy = null;
    if (pair) {
      const id = otherSide(pair, userId);
      const theirs = await settingsFor(id);
      buddy = {
        pairId: String(pair._id),
        name: await publicName(id),
        since: pair.acceptedAt,
        // Whether their alerts about you can call you, and theirs can be called.
        canCallThem: sharedPhone(theirs) !== null,
        hasDevice: (await PushToken.countDocuments({ userId: id })) > 0,
      };
    }
    return jsonOk({
      buddy,
      invite: invite ? { code: formatCode(invite.code), expiresAt: invite.expiresAt } : null,
      incoming: await Promise.all(incoming.map(async (r) => ({ requestId: String(r._id), name: await publicName(r.requesterId), at: r.requestedAt }))),
      outgoing: await Promise.all(outgoing.map(async (r) => ({ requestId: String(r._id), name: await publicName(r.ownerId), at: r.requestedAt }))),
      settings,
      emergencyContact: await contactFor(userId),
      // Whether this server can send at all: said, so the panel doesn't promise what it can't do.
      channels: { push: fcmFromEnv().configured, sms: twilioFromEnv().configured },
      hasDevice: devices > 0,
      alerts: alerts.map((a) => ({ channel: a.channel ?? "buddy", status: a.status, at: a.at, alarmId: a.alarmId })),
    });
  });
}

/** Unpair. Either side can, at any time; alerts stop at once. */
export async function DELETE() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const pair = await activePairFor(userId);
    if (!pair) {
      return jsonError("You have no buddy to unpair from", 404);
    }
    await BuddyPair.updateOne({ _id: pair._id, status: "active" }, { $set: { status: "ended", closedAt: new Date(), closedBy: userId } });
    return jsonOk({ unpaired: true });
  });
}
