import { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { connectToDatabase } from "@/lib/mongoose";
import { ModelFeedback } from "@/models/ModelFeedback";
import { RlPolicy } from "@/models/RlPolicy";
import { recordFeedback } from "@/lib/rlFeedback";
import { foreignAlarmError } from "@/lib/ownership";
import { isInt, isNum } from "@/lib/validate";
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

const isPlainObject = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);

function invalidFeedback(body: FeedbackBody): string | null {
  if (!OUTCOMES.includes(body.outcome as FeedbackOutcome)) {
    return `outcome must be one of ${OUTCOMES.join(", ")}`;
  }
  if (body.snoozes !== undefined && !isInt(body.snoozes, 0, 1000)) {
    return "snoozes must be a non-negative whole number";
  }
  if (body.ttwMin !== undefined && !isNum(body.ttwMin, 0)) {
    return "ttwMin must be a non-negative number";
  }
  if (body.satisfaction !== undefined && !isNum(body.satisfaction, -1, 1)) {
    return "satisfaction must be a number from -1 to 1";
  }
  if (body.reward !== undefined && !isNum(body.reward)) {
    return "reward must be a number";
  }
  if (body.context !== undefined && !isPlainObject(body.context)) {
    return "context must be an object";
  }
  if (body.action !== undefined && !isPlainObject(body.action)) {
    return "action must be an object";
  }
  return null;
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<FeedbackBody>(req)) ?? {};
    // A missing outcome used to default to "success", so an empty request
    // trained the policy on a wake that never happened.
    const invalid = invalidFeedback(body);
    if (invalid) {
      return jsonError(invalid, 422);
    }
    const outcome = body.outcome as FeedbackOutcome;
    if (body.alarmId !== undefined) {
      await connectToDatabase();
      const alarmError = await foreignAlarmError(userId, body.alarmId);
      if (alarmError) {
        return jsonError(alarmError, 422);
      }
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