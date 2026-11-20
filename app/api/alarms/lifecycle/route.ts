import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { runLifecycle } from "@/lib/lifecycle";

interface LifecycleBody {
  dryRun?: boolean;
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<LifecycleBody>(req)) ?? {};
    // Boolean("false") is true; a stringly dry run must not quietly delete.
    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
      return jsonError("dryRun must be true or false", 422);
    }
    await connectToDatabase();
    const summary = await runLifecycle(userId, new Date(), body.dryRun ?? false);
    return jsonOk(summary);
  });
}