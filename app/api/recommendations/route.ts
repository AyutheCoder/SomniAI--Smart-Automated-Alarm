import { NextRequest } from "next/server";
import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { buildUserSignals, type UserSignals } from "@/lib/aiFeatures";
import { buildInsights } from "@/lib/aiClient";
import { computeMetrics } from "@/lib/features";

function neutralSignals(): UserSignals {
  return {
    features: {},
    metrics: computeMetrics([], []),
    recentSleepHours: null,
    sleepGoalHours: 8,
  };
}

export async function GET(_req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    let signals: UserSignals;
    try {
      signals = await buildUserSignals(userId);
    } catch {
      signals = neutralSignals();
    }
    const insights = await buildInsights({
      features: signals.features,
      metrics: signals.metrics,
      recentSleepHours: signals.recentSleepHours,
      sleepGoalHours: signals.sleepGoalHours,
    });
    return jsonOk({
      ...insights,
      metrics: signals.metrics,
      recentSleepHours: signals.recentSleepHours,
      sleepGoalHours: signals.sleepGoalHours,
    });
  });
}