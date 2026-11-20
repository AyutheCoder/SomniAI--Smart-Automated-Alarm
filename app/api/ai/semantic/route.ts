import { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { analyzeSemantic } from "@/lib/aiClient";

interface AnalyzeBody {
  text?: string;
}

/** A task's title plus description, at their schema limits (200 + 2000). */
const MAX_TEXT = 2000;

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = await parseJson<AnalyzeBody>(req);
    // A non-string text used to reach .trim() and crash the route with a 500.
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return jsonError("Text is required", 422);
    }
    if (text.length > MAX_TEXT) {
      return jsonError(`Text must be ${MAX_TEXT} characters or fewer`, 422);
    }
    const { data, source } = await analyzeSemantic(text);
    return jsonOk({ analysis: data, source });
  });
}