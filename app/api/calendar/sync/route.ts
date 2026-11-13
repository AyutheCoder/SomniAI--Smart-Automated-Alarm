import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { calendarDeps, syncCalendar } from "@/lib/calendarServer";

const STATUS = { not_configured: 503, not_connected: 404, revoked: 409, no_permission: 409, failed: 502 } as const;

/** Reads the next week of Google Calendar into tasks now. */
export async function POST() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const r = await syncCalendar(userId, calendarDeps());
    return r.ok ? jsonOk(r) : jsonError(r.error, STATUS[r.reason]);
  });
}
