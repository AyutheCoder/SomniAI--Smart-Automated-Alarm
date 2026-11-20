import { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJson, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { buildContextData } from "@/lib/context";
import { invalidLocation, saveContextSnapshot, type LocationBody } from "@/lib/contextSnapshot";
import { withSimulated } from "@/lib/simulators/context";

/**
 * The developer simulator's context (prompt 4.4): real context, with what
 * isn't live made up and labelled "simulated", so the data-source panel and
 * the provenance filters can be exercised. A ".dev.ts" route: production
 * builds don't have it (next.config.ts).
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = (await parseJson<LocationBody>(req)) ?? {};
    const invalid = invalidLocation(body);
    if (invalid) {
      return jsonError(invalid, 422);
    }
    const data = withSimulated(await buildContextData({ lat: body.lat, lon: body.lon }));
    return jsonOk(await saveContextSnapshot(userId, data), { status: 201 });
  });
}
