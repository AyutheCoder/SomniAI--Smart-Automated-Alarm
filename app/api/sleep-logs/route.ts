import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { SleepLog } from "@/models/SleepLog";
import { sleepQualityScore } from "@/lib/features";

interface SleepLogBody {
  date?: string;
  sleepTime?: string;
  wakeTime?: string;
  durationHours?: number;
  snoozeCount?: number;
  alarmResponseMs?: number;
  wakeConfidence?: number;
  source?: "manual" | "sensor" | "wearable";
}

const HOUR_MS = 3600000;

export async function GET(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(180, Math.max(1, Number(searchParams.get("limit")) || 60));
    const items = await SleepLog.find({ userId }).sort({ date: -1 }).limit(limit).lean();
    return jsonOk({ items, total: items.length });
  });
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = await parseJson<SleepLogBody>(req);
    if (!body) {
      return jsonError("Invalid JSON body", 400);
    }
    if (!body.date) {
      return jsonError("date is required", 422);
    }
    const sleepTime = body.sleepTime ? new Date(body.sleepTime) : undefined;
    const wakeTime = body.wakeTime ? new Date(body.wakeTime) : undefined;
    let durationHours = body.durationHours;
    if (durationHours === undefined &&
      sleepTime &&
      wakeTime &&
      !Number.isNaN(sleepTime.getTime()) &&
      !Number.isNaN(wakeTime.getTime())) {
      durationHours =
        Math.round(((wakeTime.getTime() - sleepTime.getTime()) / HOUR_MS) * 10) / 10;
    }

    const snoozeCount = typeof body.snoozeCount === "number" ? Math.max(0, body.snoozeCount) : 0;
    const wakeConfidence = typeof body.wakeConfidence === "number"
      ? Math.min(100, Math.max(0, body.wakeConfidence))
      : undefined;

    const qualityScore = sleepQualityScore({
      date: body.date,
      durationHours,
      snoozeCount,
      wakeConfidence,
    });

    await connectToDatabase();
    const doc = await SleepLog.findOneAndUpdate({ userId, date: body.date }, {
      $set: {
        userId,
        date: body.date,
        sleepTime,
        wakeTime,
        durationHours,
        snoozeCount,
        alarmResponseMs: body.alarmResponseMs,
        wakeConfidence,
        qualityScore,
        source: body.source || "manual",
      },
    }, { new: true, upsert: true, setDefaultsOnInsert: true }).lean();

    return jsonOk(doc, { status: 201 });
  });
}