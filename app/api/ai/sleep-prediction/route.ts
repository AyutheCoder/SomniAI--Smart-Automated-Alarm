import { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { buildUserSignals } from "@/lib/aiFeatures";
import { predictSleep, predictWakeSuccess, type ModelFeatures } from "@/lib/aiClient";

interface PredictionBody {
  features?: ModelFeatures;
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = await parseJson<PredictionBody>(req);
    let features: ModelFeatures = body?.features ?? {};
    if (!body?.features) {
      try {
        features = (await buildUserSignals(userId)).features;
      } catch {
        features = {};
      }
    }
    const [sleep, wake] = await Promise.all([
      predictSleep(features),
      predictWakeSuccess(features),
    ]);
    return jsonOk({
      prediction: { ...sleep.data, ...wake.data },
      source: sleep.source === "ai" && wake.source === "ai" ? "ai" : "fallback",
      features,
    });
  });
}