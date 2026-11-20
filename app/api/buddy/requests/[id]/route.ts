import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { activePairFor } from "@/lib/buddyServer";
import { BuddyInvite, BuddyPair } from "@/models/Buddy";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Accept or decline a request to pair. Only the person who shared the code
 * can, and accepting is their consent: only then is the pairing active.
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError("Invalid id", 400);
    }
    const body = (await parseJson<{ accept?: unknown }>(req)) ?? {};
    if (typeof body.accept !== "boolean") {
      return jsonError("accept (true or false) is required", 422);
    }
    const request = await BuddyPair.findOne({ _id: id, ownerId: userId, status: "requested" }).lean<{ requesterId: string }>();
    if (!request) {
      return jsonError("No such request waiting for you", 404);
    }
    const now = new Date();
    if (!body.accept) {
      await BuddyPair.updateOne({ _id: id, status: "requested" }, { $set: { status: "declined", closedAt: now, closedBy: userId } });
      return jsonOk({ status: "declined" });
    }
    if (await activePairFor(userId)) {
      return jsonError("You already have a buddy. Unpair first.", 409);
    }
    if (await activePairFor(request.requesterId)) {
      return jsonError("They have paired with someone else since asking.", 409);
    }
    // Conditional on still being a request: two accepts at once make one pairing.
    const { modifiedCount } = await BuddyPair.updateOne({ _id: id, status: "requested" }, { $set: { status: "active", acceptedAt: now } });
    if (modifiedCount === 0) {
      return jsonError("That request was withdrawn", 409);
    }
    // The code did its job; other requests to or from either of them are moot.
    await BuddyInvite.deleteOne({ userId });
    await BuddyPair.updateMany(
      {
        _id: { $ne: id },
        status: "requested",
        $or: [
          { ownerId: { $in: [userId, request.requesterId] } },
          { requesterId: { $in: [userId, request.requesterId] } },
        ],
      },
      { $set: { status: "declined", closedAt: now, closedBy: userId } },
    );
    return jsonOk({ status: "active" });
  });
}

/** Withdraw your own request, or decline one made to you. */
export async function DELETE(_req: NextRequest, context: RouteContext) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError("Invalid id", 400);
    }
    const { modifiedCount } = await BuddyPair.updateOne(
      { _id: id, status: "requested", $or: [{ ownerId: userId }, { requesterId: userId }] },
      { $set: { status: "declined", closedAt: new Date(), closedBy: userId } },
    );
    if (modifiedCount === 0) {
      return jsonError("No such request", 404);
    }
    return jsonOk({ status: "declined" });
  });
}
