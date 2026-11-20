import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { ContextSnapshot } from "@/models/ContextSnapshot";
import { buildContextData } from "@/lib/context";
import { invalidLocation, saveContextSnapshot, type LocationBody } from "@/lib/contextSnapshot";
import { describeDataSources } from "@/lib/aiFeatures";

function invalidContext(body: LocationBody & Record<string, unknown>): string | null {
  // `override` (caller-typed values) went in 1.2; `simulate` in 4.4: made-up
  // context is only the developer simulator's, never this route's.
  if ("override" in body) {
    return "override is no longer accepted; context is built from connected sources";
  }
  if ("simulate" in body) {
    return "simulate is no longer accepted; made-up context exists only on the developer simulator";
  }
  return invalidLocation(body);
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

/** A snapshot of real context now: live weather with a location, the rest missing. */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<LocationBody & Record<string, unknown>>(req)) ?? {};
    const invalid = invalidContext(body);
    if (invalid) {
      return jsonError(invalid, 422);
    }
    const data = await buildContextData({ lat: body.lat, lon: body.lon });
    return jsonOk(await saveContextSnapshot(userId, data), { status: 201 });
  });
}
