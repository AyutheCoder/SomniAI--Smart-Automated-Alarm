import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { NightPlan } from "@/models/WakeReport";

const DAY_MS = 24 * 3_600_000;

/** A full ISO time, such as the page's Date.toISOString(). */
function isInstant(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * Tonight's plan (prompt 3.4): the bedtime chosen in the wake planner and the
 * wake it's for, so the morning report can say whether it was kept. The page
 * sends it when the bedtime reminder is set.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<{ bedtime?: unknown; wakeAt?: unknown }>(req)) ?? {};
    if (!isInstant(body.bedtime) || !isInstant(body.wakeAt)) {
      return jsonError("bedtime and wakeAt must be ISO times", 422);
    }
    const bedtime = new Date(body.bedtime);
    const wakeAt = new Date(body.wakeAt);
    if (bedtime.getTime() >= wakeAt.getTime() || wakeAt.getTime() - bedtime.getTime() > DAY_MS) {
      return jsonError("bedtime must come before wakeAt, within a day of it", 422);
    }
    if (wakeAt.getTime() < Date.now() - DAY_MS || wakeAt.getTime() > Date.now() + 8 * DAY_MS) {
      return jsonError("wakeAt must be no more than a day ago and within the next week", 422);
    }
    await connectToDatabase();
    // One plan per night: a new one for the same wake replaces the old.
    await NightPlan.updateMany(
      { userId, cancelledAt: { $exists: false }, wakeAt: { $gte: new Date(wakeAt.getTime() - DAY_MS / 2), $lte: new Date(wakeAt.getTime() + DAY_MS / 2) } },
      { $set: { cancelledAt: new Date() } },
    );
    const plan = await NightPlan.create({ userId, bedtime, wakeAt });
    return jsonOk({ id: String(plan._id), bedtime: bedtime.toISOString(), wakeAt: wakeAt.toISOString() }, { status: 201 });
  });
}

/** The reminder was cancelled: so is every plan for a wake still to come. */
export async function DELETE() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const r = await NightPlan.updateMany(
      { userId, cancelledAt: { $exists: false }, wakeAt: { $gt: new Date() } },
      { $set: { cancelledAt: new Date() } },
    );
    return jsonOk({ cancelled: r.modifiedCount });
  });
}
