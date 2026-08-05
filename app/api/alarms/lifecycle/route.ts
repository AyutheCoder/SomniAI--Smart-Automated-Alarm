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
    await connectToDatabase();
    const body = (await parseJson<LifecycleBody>(req)) ?? {};
    const summary = await runLifecycle(userId, new Date(), Boolean(body.dryRun));
    return jsonOk(summary);
  });
}