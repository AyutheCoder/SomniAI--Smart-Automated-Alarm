import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { ContextSnapshot } from "@/models/ContextSnapshot";
import { buildContextData, type ContextData } from "@/lib/context";
import { isNum } from "@/lib/validate";

interface ContextBody {
  simulate?: boolean;
  lat?: number;
  lon?: number;
  override?: ContextData;
}

function invalidContext(body: ContextBody): string | null {
  const hasLat = body.lat !== undefined;
  const hasLon = body.lon !== undefined;
  if (hasLat !== hasLon) {
    return "lat and lon must be given together";
  }
  if (hasLat && !isNum(body.lat, -90, 90)) {
    return "lat must be a number from -90 to 90";
  }
  if (hasLon && !isNum(body.lon, -180, 180)) {
    return "lon must be a number from -180 to 180";
  }
  if (body.simulate !== undefined && typeof body.simulate !== "boolean") {
    return "simulate must be true or false";
  }
  if (body.override !== undefined) {
    const o = body.override as unknown;
    if (o === null || typeof o !== "object" || Array.isArray(o)) {
      return "override must be an object";
    }
    const calendar = (o as ContextData).calendar;
    if (calendar !== undefined) {
      const ok = Array.isArray(calendar) && calendar.every((c) =>
        c !== null && typeof c === "object" && typeof c.title === "string" && c.title.trim() !== ""
        && !Number.isNaN(new Date(c.start).getTime()));
      if (!ok) {
        return "Each calendar entry needs a title and a valid start";
      }
    }
  }
  return null;
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
    const invalid = invalidContext(body);
    if (invalid) {
      return jsonError(invalid, 422);
    }
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
      // This used to say "live" when simulate was true, i.e. exactly when
      // everything was simulated, and called the user's own data simulated.
      // Calendar and wearable values are always simulated today, so a built
      // snapshot is never wholly live; per-source labels come with real sources.
      source: body.override ? "manual" : "simulated",
    });
    return jsonOk(doc.toObject(), { status: 201 });
  });
}