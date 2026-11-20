import { NextRequest } from "next/server";
import { jsonOk, guard } from "@/lib/http";
import { cronRefusal } from "@/lib/cronAuth";
import { sendOpsAlert } from "@/lib/opsAlert";
import { checkAiBrain } from "@/lib/uptime";

/**
 * One uptime check of the AI Brain (lib/uptime.ts, prompt 7.3). Called every
 * minute by the scheduler that runs the buddy alerts (MONITORING.md), with
 * "Authorization: Bearer <CRON_SECRET>".
 */
async function run(req: NextRequest) {
  return guard(async () => {
    const refused = cronRefusal(req.headers.get("authorization"), "uptime monitoring");
    if (refused) {
      return refused;
    }
    return jsonOk(await checkAiBrain({
      url: process.env.AI_BRAIN_URL?.trim() ?? "",
      fetch: fetch as never,
      timeoutMs: Number(process.env.AI_BRAIN_TIMEOUT_MS) > 0 ? Number(process.env.AI_BRAIN_TIMEOUT_MS) : 4000,
      now: new Date(),
      alert: (text) => sendOpsAlert(text),
    }));
  });
}

/** Vercel Cron calls with GET. */
export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
