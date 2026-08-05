import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { SleepLog } from "@/models/SleepLog";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { computeMetrics, type BehaviorEventInput, type SleepLogInput } from "@/lib/features";
import { deriveEscalationProfile } from "@/lib/escalation";

export async function GET(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const days = Math.min(180, Math.max(1, Number(searchParams.get("days")) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [logs, events] = await Promise.all([
      SleepLog.find({ userId }).sort({ date: -1 }).limit(days).lean(),
      BehaviorEvent.find({ userId, at: { $gte: since } })
        .sort({ at: -1 })
        .limit(2000)
        .lean(),
    ]);

    const metrics = computeMetrics(logs as unknown as SleepLogInput[], events as unknown as BehaviorEventInput[]);

    // Escalation levels this user actually woke at, newest first. `escalation`
    // events carry the level the alarm reached before it was resolved; a wake
    // with no escalation event resolved at level 1.
    const effectiveLevels = (events as unknown as BehaviorEventInput[])
      .filter((e) => e.type === "escalation" && typeof e.value === "number")
      .map((e) => Number(e.value))
      .filter((n) => n >= 1 && n <= 5)
      .slice(0, 40);
    const escalationProfile = deriveEscalationProfile({ effectiveLevels });

    return jsonOk({
      metrics,
      escalationProfile,
      window: { days, since: since.toISOString() },
    });
  });
}