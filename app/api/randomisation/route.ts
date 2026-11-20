import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { isExperiment } from "@/lib/randomisation";
import { randomisationState, startRandomisation, stopRandomisation } from "@/lib/randomisationServer";

/**
 * The per-alarm randomisation (prompt 6.1): what runs, every logged
 * assignment, the arm counts, and an audit recomputing each arm from its seed.
 * Study mode (6.2) starts and stops it for enrolled users.
 */
export async function GET() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    return jsonOk(await randomisationState(userId));
  });
}

/** Starts randomising one aspect, from a seed (given, or a random one that is stored). Stops any other. */
export async function PUT(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<{ experiment?: unknown; seed?: unknown }>(req)) ?? {};
    if (!isExperiment(body.experiment)) {
      return jsonError("experiment must be escalation_pacing or wake_plan", 422);
    }
    if (body.seed !== undefined && (typeof body.seed !== "string" || !/^[\w-]{1,64}$/.test(body.seed))) {
      return jsonError("seed must be 1 to 64 letters, digits, - or _", 422);
    }
    await connectToDatabase();
    await startRandomisation(userId, body.experiment, body.seed as string | undefined);
    return jsonOk(await randomisationState(userId));
  });
}

/** Stops randomising. Alarms already set keep their logged assignment; plans worked out from now are standard. */
export async function DELETE() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    await stopRandomisation(userId);
    return jsonOk(await randomisationState(userId));
  });
}
