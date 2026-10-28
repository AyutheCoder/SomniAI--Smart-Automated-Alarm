import { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { buildUserSignals } from "@/lib/aiFeatures";
import { planWake } from "@/lib/aiClient";
import { isClockTime, isNum } from "@/lib/validate";

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
    // "very" used to become NaN here and go to the planner as the target.
    if (body.requiredReliability !== undefined
      && !(isNum(body.requiredReliability, 0, 1) && body.requiredReliability > 0)) {
      return jsonError("requiredReliability must be a number above 0 and at most 1", 422);
    }
    if (body.minSleepHours !== undefined && !isNum(body.minSleepHours, 0, 14)) {
      return jsonError("minSleepHours must be a number from 0 to 14", 422);
    }
    if (body.wakeTime !== undefined && !isClockTime(body.wakeTime)) {
      return jsonError("wakeTime must be a 24-hour time like 05:40", 422);
    }
    // The planner cannot promise certainty, nor plan for near-zero targets.
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
