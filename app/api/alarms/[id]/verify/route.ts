import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { Alarm } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { computeWakeConfidence } from "@/lib/wakeConfidence";
import { isInt, isNum, isOccurredAt, isStringList } from "@/lib/validate";

interface VerifyBody {
  /** The client's own score. Ignored: the server scores from the signals. */
  confidence?: number;
  methods?: string[];
  responseMs?: number;
  /** How many answers responseMs covers (sums in a maths challenge); speed is judged per answer. */
  steps?: number;
  attempts?: number;
  motion?: number;
  /** Did the user actually solve every challenge in the sequence? */
  solved?: boolean;
  /** Fraction of challenges solved, when a sequence was presented. */
  correctness?: number;
  /** When it was answered, if it is being reported later (a phone that was offline). */
  at?: string;
}

function invalidSignals(body: VerifyBody): string | null {
  if (typeof body.solved !== "boolean") {
    return "solved (true or false) is required; the server scores the challenge itself";
  }
  if (body.correctness !== undefined && !isNum(body.correctness, 0, 1)) {
    return "correctness must be a number from 0 to 1";
  }
  if (body.responseMs !== undefined && !isNum(body.responseMs, 0)) {
    return "responseMs must be a non-negative number";
  }
  if (body.steps !== undefined && !isInt(body.steps, 1, 1000)) {
    return "steps must be a whole number from 1";
  }
  if (body.attempts !== undefined && !isInt(body.attempts, 0, 1000)) {
    return "attempts must be a non-negative whole number";
  }
  if (body.motion !== undefined && !isNum(body.motion, 0, 1)) {
    return "motion must be a number from 0 to 1";
  }
  if (body.methods !== undefined && !isStringList(body.methods)) {
    return "methods must be a list of challenge names";
  }
  if (body.at !== undefined && !isOccurredAt(body.at)) {
    return "at must be an ISO time within the last 7 days and not in the future";
  }
  return null;
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
    const invalid = invalidSignals(body);
    if (invalid) {
      return jsonError(invalid, 422);
    }

    // Score from the raw signals here rather than trusting a number the client
    // computed: the verdict decides whether the alarm counts as verified, so a
    // replayed or edited request must not be able to assert its own
    // wakefulness. A request carrying only a score used to be trusted as-is,
    // which let `{ "confidence": 100 }` pass any alarm.
    const solved = body.solved as boolean;
    const confidence = computeWakeConfidence({
      correctness: body.correctness ?? (solved ? 1 : 0),
      solved,
      responseMs: body.responseMs ?? 45000,
      steps: body.steps,
      attempts: body.attempts ?? 1,
      motion: body.motion,
    }).score;
    const scoredServerSide = true;
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
        steps: body.steps ?? null,
        attempts: body.attempts ?? null,
        motion: body.motion ?? null,
        solved: body.solved ?? null,
        scoredServerSide,
        threshold,
        reportedLate: body.at !== undefined,
      },
      at: body.at ? new Date(body.at) : new Date(),
    });
    return jsonOk({ confidence, passed, threshold });
  });
}