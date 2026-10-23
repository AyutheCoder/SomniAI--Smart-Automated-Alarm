import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { ContextSnapshot } from "@/models/ContextSnapshot";
import { buildContextData } from "@/lib/context";
import { describeDataSources } from "@/lib/aiFeatures";
import { isNum } from "@/lib/validate";

interface ContextBody {
  simulate?: boolean;
  lat?: number;
  lon?: number;
  // `override` (store whatever values the caller sends) is gone: no client
  // used it, and values typed in by a caller are neither live nor simulated.
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
  if ("override" in body) {
    return "override is no longer accepted; context is built from connected sources";
  }
  return null;
}

/** Recent snapshots, and which of the user's data sources are connected. */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 10));
    const [items, sources] = await Promise.all([
      ContextSnapshot.find({ userId }).sort({ at: -1 }).limit(limit).lean(),
      describeDataSources(userId),
    ]);
    return jsonOk({ items, total: items.length, sources });
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
    const data = await buildContextData({ simulate: body.simulate, lat: body.lat, lon: body.lon });

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
      // One label per group. The single `source` this replaced said "live"
      // exactly when everything was simulated.
      sources: data.sources,
    });
    return jsonOk(doc.toObject(), { status: 201 });
  });
}
