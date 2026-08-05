import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { Alarm } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { computeWakeConfidence } from "@/lib/wakeConfidence";

interface VerifyBody {
  /** Legacy: a pre-scored value. Only trusted when raw signals are absent. */
  confidence?: number;
  methods?: string[];
  responseMs?: number;
  attempts?: number;
  motion?: number;
  /** Did the user actually solve every challenge in the sequence? */
  solved?: boolean;
  /** Fraction of challenges solved, when a sequence was presented. */
  correctness?: number;
}

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(req: NextRequest, context: RouteContext) {
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
    const body = (await parseJson<VerifyBody>(req)) ?? {};

    // Score from the raw signals here rather than trusting a number the client
    // computed: the posted score decides whether the alarm is satisfied, so a
    // replayed or edited request must not be able to assert its own wakefulness.
    const hasSignals =
      typeof body.responseMs === "number" ||
      typeof body.solved === "boolean" ||
      typeof body.correctness === "number";

    let confidence: number;
    let scoredServerSide = false;
    if (hasSignals) {
      const correctness = typeof body.correctness === "number"
        ? Math.min(1, Math.max(0, body.correctness))
        : body.solved
          ? 1
          : 0;
      confidence = computeWakeConfidence({
        correctness,
        solved: body.solved ?? correctness >= 1,
        responseMs: typeof body.responseMs === "number" ? body.responseMs : 45000,
        attempts: typeof body.attempts === "number" ? body.attempts : 1,
        motion: typeof body.motion === "number" ? body.motion : undefined,
      }).score;
      scoredServerSide = true;
    }
    else {
      confidence = typeof body.confidence === "number"
        ? Math.min(100, Math.max(0, body.confidence))
        : 0;
    }
    const alarm = await Alarm.findOne({ _id: id, userId });
    if (!alarm) {
      return jsonError("Alarm not found", 404);
    }
    const threshold = alarm.minConfidence ?? 70;
    const passed = confidence >= threshold;
    await BehaviorEvent.create({
      userId,
      type: passed ? "verify_pass" : "verify_fail",
      value: confidence,
      meta: {
        alarmId: id,
        methods: body.methods ?? [],
        responseMs: body.responseMs ?? null,
        attempts: body.attempts ?? null,
        motion: body.motion ?? null,
        solved: body.solved ?? null,
        scoredServerSide,
        threshold,
      },
      at: new Date(),
    });
    return jsonOk({ confidence, passed, threshold });
  });
}