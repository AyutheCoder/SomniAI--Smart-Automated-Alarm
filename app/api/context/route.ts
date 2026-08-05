import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { ContextSnapshot } from "@/models/ContextSnapshot";
import { buildContextData, type ContextData } from "@/lib/context";

interface ContextBody {
  simulate?: boolean;
  lat?: number;
  lon?: number;
  override?: ContextData;
}

export async function GET(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 10));
    const items = await ContextSnapshot.find({ userId })
      .sort({ at: -1 })
      .limit(limit)
      .lean();
    return jsonOk({ items, total: items.length });
  });
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<ContextBody>(req)) ?? {};
    const data = body.override
      ? body.override
      : await buildContextData({
          simulate: body.simulate,
          lat: body.lat,
          lon: body.lon,
        });

    const calendar = (data.calendar ?? []).map((c) => ({
      title: c.title,
      start: new Date(c.start),
      importanceScore: c.importanceScore,
    }));

    await connectToDatabase();
    const doc = await ContextSnapshot.create({
      userId,
      at: new Date(),
      weather: data.weather,
      calendar: calendar.length > 0 ? calendar : undefined,
      wearable: data.wearable,
      source: body.simulate && typeof body.lat === "number" && typeof body.lon === "number"
        ? "live"
        : "simulated",
    });
    return jsonOk(doc.toObject(), { status: 201 });
  });
}