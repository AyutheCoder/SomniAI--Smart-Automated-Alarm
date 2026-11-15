import { timingSafeEqual } from "node:crypto";
import { jsonError } from "@/lib/http";

/**
 * The scheduler's key (CRON_SECRET), for routes that run without a user
 * session (api/cron/*): null when the request carries it, else the refusal.
 * Without a secret set, everything is refused.
 */
export function cronRefusal(authorization: string | null, what: string): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return jsonError(`CRON_SECRET is not set, so ${what} is off on this server`, 503);
  }
  const given = Buffer.from(authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return jsonError("Unauthorized", 401);
  }
  return null;
}
