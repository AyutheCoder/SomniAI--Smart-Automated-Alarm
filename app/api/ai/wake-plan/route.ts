import { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { buildUserSignals } from "@/lib/aiFeatures";
import { planWake } from "@/lib/aiClient";

interface WakePlanBody {
  /** 0..1. How sure the user needs to be of waking. */
  requiredReliability?: number;
  /** Display-only, echoed back on the plan. */
  wakeTime?: string;
  /** Reject a bedtime that meets reliability but starves sleep. */
  minSleepHours?: number;
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<WakePlanBody>(req)) ?? {};
    const required = Math.min(0.99, Math.max(0.05, body.requiredReliability ?? 0.9));

    const { features, sleepGoalHours } = await buildUserSignals(userId);
    const { data, source } = await planWake({
      features,
      requiredReliability: required,
      wakeTime: body.wakeTime,
      minSleepHours: body.minSleepHours ?? Math.max(0, sleepGoalHours - 1.5),
    });

    if (!data) {
      return jsonError(
        "The wake planner is offline right now. Try again once the AI service is back.",
        503,
      );
    }
    return jsonOk({ plan: data, source, features });
  });
}
