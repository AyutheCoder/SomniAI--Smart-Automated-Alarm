import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { SleepLog } from "@/models/SleepLog";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { computeMetrics, type BehaviorEventInput, type SleepLogInput } from "@/lib/features";
import { currentProfile } from "@/lib/wakeHistory";
import { isInt } from "@/lib/validate";

export async function GET(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const rawDays = searchParams.get("days");
    const days = rawDays === null ? 30 : Number(rawDays);
    if (!isInt(days, 1, 180)) {
      return jsonError("days must be a whole number from 1 to 180", 422);
    }
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [logs, events] = await Promise.all([
      SleepLog.find({ userId }).sort({ date: -1 }).limit(days).lean(),
      BehaviorEvent.find({ userId, at: { $gte: since } })
        .sort({ at: -1 })
        .limit(2000)
        .lean(),
    ]);

    const metrics = computeMetrics(logs as unknown as SleepLogInput[], events as unknown as BehaviorEventInput[]);

    // The same profile the ring plans use: learnt from the morning reports,
    // one per ring including missed ones (lib/wakeHistory.ts), not only from
    // this window.
    const escalationProfile = await currentProfile(userId);

    return jsonOk({
      metrics,
      escalationProfile,
      window: { days, since: since.toISOString() },
    });
  });
}