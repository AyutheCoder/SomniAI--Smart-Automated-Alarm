import type { NextRequest } from "next/server";
import { jsonError, guard, parseJson } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { recordError } from "@/lib/errorTracking";

/**
 * An error the page hit (7.3): from lib/errorReporter.ts and the error
 * boundaries. Signed in only, so the collection can't be filled by anyone on
 * the internet; the write rate limit applies (middleware.ts). Nothing about
 * the account is stored with it (lib/errorTracking.ts).
 *
 * Body: { kind, message, stack?, where? }, all strings.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const body = await parseJson<Record<string, unknown>>(req);
    if (!body || typeof body !== "object") {
      return jsonError("Invalid request body", 400);
    }
    const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);
    const kind = str(body.kind, 200);
    const message = str(body.message, 5000);
    if (!kind || message === undefined) {
      return jsonError("kind and message are required strings", 422);
    }
    for (const k of ["stack", "where"] as const) {
      if (body[k] !== undefined && str(body[k], k === "stack" ? 20_000 : 2000) === undefined) {
        return jsonError(`${k} must be a string`, 422);
      }
    }
    const result = await recordError({ source: "browser", kind, message, stack: str(body.stack, 20_000), where: str(body.where, 2000) });
    return new Response(JSON.stringify({ ok: true, data: { result } }), { status: 202, headers: { "content-type": "application/json" } });
  });
}
