import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { aiBrainStatus } from "@/lib/uptime";

/** Whether the AI Brain is up, as the last uptime check found it (7.3); "unknown" if checks aren't running. */
export async function GET() {
  return guard(async () => {
    if (!(await getUserId())) {
      return jsonError("Unauthorized", 401);
    }
    return jsonOk({ aiBrain: await aiBrainStatus() });
  });
}
