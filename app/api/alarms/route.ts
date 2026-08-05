import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { Alarm } from "@/models/Alarm";

interface CreateAlarmBody {
  label?: string;
  scheduledTime?: string;
  source?: "manual" | "assisted" | "autonomous";
  linkedTaskId?: string;
  intensity?: number;
  wakeStrategy?: "gentle" | "adaptive" | "aggressive";
  verificationRequired?: boolean;
  verificationMethod?: "math" | "typing" | "tap" | "none";
  verificationMethods?: string[];
  minConfidence?: number;
  repeat?: {
    type: "none" | "daily" | "weekdays" | "custom";
    days?: number[];
  };
}

export async function GET(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const enabled = searchParams.get("enabled");
    const filter: Record<string, unknown> = { userId };
    if (enabled === "true") {
      filter.enabled = true;
    }
    if (enabled === "false") {
      filter.enabled = false;
    }
    const items = await Alarm.find(filter).sort({ scheduledTime: 1 }).lean();
    return jsonOk({ items, total: items.length });
  });
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const body = await parseJson<CreateAlarmBody>(req);
    if (!body) {
      return jsonError("Invalid JSON body", 400);
    }
    const label = (body.label || "").trim();
    if (!label) {
      return jsonError("Label is required", 422);
    }
    if (!body.scheduledTime) {
      return jsonError("scheduledTime is required", 422);
    }
    const scheduledTime = new Date(body.scheduledTime);
    if (Number.isNaN(scheduledTime.getTime())) {
      return jsonError("scheduledTime is not a valid date", 422);
    }
    const doc = await Alarm.create({
      userId,
      label,
      scheduledTime,
      source: body.source || "manual",
      linkedTaskId: body.linkedTaskId || undefined,
      intensity: body.intensity ?? 60,
      wakeStrategy: body.wakeStrategy || "adaptive",
      verificationRequired: body.verificationRequired ?? true,
      verificationMethod: body.verificationMethod || "math",
      verificationMethods: Array.isArray(body.verificationMethods) && body.verificationMethods.length > 0
        ? body.verificationMethods
        : [body.verificationMethod || "math"],
      minConfidence: body.minConfidence ?? 70,
      repeat: body.repeat || { type: "none" },
    });
    return jsonOk(doc, { status: 201 });
  });
}