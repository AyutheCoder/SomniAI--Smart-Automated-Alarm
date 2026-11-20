// Storing a context snapshot (shared by /api/context and the developer
// simulator's /api/dev/simulated-context). Server-only.

import { connectToDatabase } from "@/lib/mongoose";
import type { ContextData } from "@/lib/context";
import { isNum } from "@/lib/validate";
import { ContextSnapshot } from "@/models/ContextSnapshot";

export interface LocationBody {
  lat?: number;
  lon?: number;
}

/** Why a location can't be used, or null. */
export function invalidLocation(body: LocationBody): string | null {
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
  return null;
}

export async function saveContextSnapshot(userId: string, data: ContextData) {
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
  return doc.toObject();
}
