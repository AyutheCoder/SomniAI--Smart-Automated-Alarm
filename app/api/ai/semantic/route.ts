import { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { analyzeSemantic } from "@/lib/aiClient";

interface AnalyzeBody {
  text?: string;
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = await parseJson<AnalyzeBody>(req);
    const text = (body?.text || "").trim();
    if (!text) {
      return jsonError("Text is required", 422);
    }
    const { data, source } = await analyzeSemantic(text);
    return jsonOk({ analysis: data, source });
  });
}