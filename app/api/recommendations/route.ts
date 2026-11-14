import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { buildUserSignals, type UserSignals } from "@/lib/aiFeatures";
import { buildInsights } from "@/lib/aiClient";
import { computeMetrics } from "@/lib/features";
import { personalPredictions, type PersonalPredictions } from "@/lib/personalServer";
import type { NextRequest } from "next/server";

function neutralSignals(): UserSignals {
  return {
    features: {},
    metrics: computeMetrics([], []),
    recentSleepHours: null,
    sleepGoalHours: 8,
  };
}

export async function GET(req: NextRequest) {
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
    // Personal predictions (prompt 5.3), on top of tonight's population model.
    const tz = new URL(req.url).searchParams.get("tz") ?? undefined;
    let personal: PersonalPredictions;
    try {
      personal = await personalPredictions(userId, {
        features: signals.features,
        sleep: insights.prediction.predictedSleepDuration,
        regular: insights.prediction.wakeSuccessProbability,
        fromModel: insights.predictionSource === "ai",
      }, tz);
    }
    catch {
      personal = { available: false, reason: "Your own data couldn't be read just now.", alarm: { basis: "off" } };
    }
    return jsonOk({
      ...insights,
      personal,
      metrics: signals.metrics,
      recentSleepHours: signals.recentSleepHours,
      sleepGoalHours: signals.sleepGoalHours,
    });
  });
}