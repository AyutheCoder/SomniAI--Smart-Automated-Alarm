import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { SleepLog } from "@/models/SleepLog";
import { sleepQualityScore } from "@/lib/features";
import { isInt, isIsoDate, isNum } from "@/lib/validate";

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
    // Every one of these used to be stored as sent, so a night could be
    // "yesterday" long, end before it began, or last -3 hours, and each one
    // then fed the sleep metrics and predictions.
    if (!isIsoDate(body.date)) {
      return jsonError("date must be a date like 2026-10-22", 422);
    }
    const sleepTime = body.sleepTime ? new Date(body.sleepTime) : undefined;
    const wakeTime = body.wakeTime ? new Date(body.wakeTime) : undefined;
    if (sleepTime && Number.isNaN(sleepTime.getTime())) {
      return jsonError("sleepTime is not a valid date", 422);
    }
    if (wakeTime && Number.isNaN(wakeTime.getTime())) {
      return jsonError("wakeTime is not a valid date", 422);
    }
    if (sleepTime && wakeTime && wakeTime <= sleepTime) {
      return jsonError("wakeTime must be after sleepTime", 422);
    }
    if (body.durationHours !== undefined && !isNum(body.durationHours, 0, 24)) {
      return jsonError("durationHours must be a number from 0 to 24", 422);
    }
    if (body.snoozeCount !== undefined && !isInt(body.snoozeCount, 0, 1000)) {
      return jsonError("snoozeCount must be a non-negative whole number", 422);
    }
    if (body.alarmResponseMs !== undefined && !isNum(body.alarmResponseMs, 0)) {
      return jsonError("alarmResponseMs must be a non-negative number", 422);
    }
    let durationHours = body.durationHours;
    if (durationHours === undefined && sleepTime && wakeTime) {
      durationHours =
        Math.round(((wakeTime.getTime() - sleepTime.getTime()) / HOUR_MS) * 10) / 10;
      if (durationHours > 24) {
        return jsonError("sleepTime to wakeTime is longer than a day", 422);
      }
    }

    const snoozeCount = body.snoozeCount ?? 0;
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
    }, { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }).lean();

    return jsonOk(doc, { status: 201 });
  });
}