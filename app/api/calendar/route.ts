import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, jsonOk, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { calendarDeps, calendarState, disconnectCalendar } from "@/lib/calendarServer";

/** Whether Google Calendar is connected, when it last synced, and why not if it couldn't. */
export async function GET() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    return jsonOk(await calendarState(userId, calendarDeps()));
  });
}

/**
 * Disconnects Google Calendar: Google is asked to drop SomniAI's access, the
 * stored grant is deleted, and the calendar's tasks that aren't done go too.
 */
export async function DELETE() {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    await connectToDatabase();
    const r = await disconnectCalendar(userId, calendarDeps());
    if (!r) {
      return jsonError("Google Calendar isn't connected", 404);
    }
    return jsonOk(r);
  });
}
