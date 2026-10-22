import { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { buildUserSignals } from "@/lib/aiFeatures";
import { predictSleep, predictWakeSuccess, type ModelFeatures } from "@/lib/aiClient";
import { isNum } from "@/lib/validate";

interface PredictionBody {
  features?: ModelFeatures;
}

function isFeatureMap(v: unknown): v is ModelFeatures {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    && Object.values(v).every((x) => isNum(x));
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = await parseJson<PredictionBody>(req);
    const supplied = body?.features as unknown;
    if (supplied !== undefined && !isFeatureMap(supplied)) {
      return jsonError("features must map feature names to numbers", 422);
    }
    let features: ModelFeatures = supplied ?? {};
    if (supplied === undefined) {
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