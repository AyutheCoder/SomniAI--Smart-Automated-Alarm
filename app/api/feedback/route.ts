import { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { connectToDatabase } from "@/lib/mongoose";
import { ModelFeedback } from "@/models/ModelFeedback";
import { RlPolicy } from "@/models/RlPolicy";
import { recordFeedback } from "@/lib/rlFeedback";
import type { FeedbackOutcome, RlAction, RlContext } from "@/lib/aiClient";

interface FeedbackBody {
  alarmId?: string;
  context?: RlContext;
  action?: Partial<RlAction>;
  outcome?: FeedbackOutcome;
  snoozes?: number;
  ttwMin?: number;
  satisfaction?: number;
  reward?: number;
}

const OUTCOMES: FeedbackOutcome[] = ["success", "snooze", "missed"];

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<FeedbackBody>(req)) ?? {};
    const outcome = body.outcome ?? "success";
    if (!OUTCOMES.includes(outcome)) {
      return jsonError("Invalid outcome", 400);
    }
    try {
      const { data, source, explanation } = await recordFeedback({
        userId,
        alarmId: body.alarmId,
        context: body.context ?? {},
        action: body.action ?? { strategy: "adaptive", offsetMin: 0, intensity: 70 },
        outcome,
        snoozes: body.snoozes,
        ttwMin: body.ttwMin,
        satisfaction: body.satisfaction,
        reward: body.reward,
      });
      return jsonOk({
        reward: data.reward,
        recommendedAction: data.recommendedAction,
        summary: data.summary,
        explanation,
        source,
      });
    } catch {
      return jsonError("Failed to record feedback", 500);
    }
  });
}

export async function GET(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));
    const [history, pol] = await Promise.all([
      ModelFeedback.find({ userId }).sort({ at: -1 }).limit(limit).lean(),
      RlPolicy.findOne({ userId }).lean(),
    ]);

    const policy = pol as unknown as {
      updates?: number;
      meanReward?: number;
      summary?: Record<string, unknown>;
    } | null;

    return jsonOk({
      history,
      policy: policy
        ? {
            updates: policy.updates ?? 0,
            meanReward: policy.meanReward ?? 0,
            summary: policy.summary ?? null,
          }
        : { updates: 0, meanReward: 0, summary: null },
    });
  });
}