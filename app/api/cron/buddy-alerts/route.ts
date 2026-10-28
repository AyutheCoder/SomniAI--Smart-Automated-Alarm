import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, guard } from "@/lib/http";
import { runBuddyAlerts } from "@/lib/buddyAlerts";
import { fcmFromEnv } from "@/lib/push";

/**
 * Runs the wake-buddy alert check (lib/buddyAlerts.ts). Called every minute by
 * a scheduler (BUDDY.md: Vercel Cron in production, `npm run buddy:cron`
 * locally), with "Authorization: Bearer <CRON_SECRET>". There is no user
 * session here, so the secret is the only way in, and without one set the
 * route refuses everything.
 */
async function run(req: NextRequest) {
  return guard(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return jsonError("CRON_SECRET is not set, so buddy alerts are off on this server", 503);
    }
    const given = Buffer.from(req.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    return jsonOk(await runBuddyAlerts(fcmFromEnv()));
  });
}

/** Vercel Cron calls with GET. */
export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
