import { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonOk, guard } from "@/lib/http";
import { cronRefusal } from "@/lib/cronAuth";
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
    const refused = cronRefusal(req.headers.get("authorization"), "buddy alerts");
    if (refused) {
      return refused;
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
