import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { STATE_COOKIE, calendarDeps, checkOAuthState, connectCalendar } from "@/lib/calendarServer";

/**
 * Where Google's consent screen sends the user back. Connects the calendar
 * for the signed-in user if the answer is theirs, then returns to the home
 * page with the outcome: connected, denied, no_calendar_access or failed.
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const params = req.nextUrl.searchParams;
    const back = (outcome: string) => {
      const res = NextResponse.redirect(new URL(`/?calendar=${outcome}`, req.url));
      res.cookies.set(STATE_COOKIE, "", { path: "/api/calendar", maxAge: 0 });
      return res;
    };
    const deps = calendarDeps();
    if (!checkOAuthState(req.cookies.get(STATE_COOKIE)?.value, params.get("state"), userId, deps.now)) {
      return back("failed");
    }
    if (params.get("error")) {
      // "access_denied": the user said no on Google's screen.
      return back("denied");
    }
    const code = params.get("code");
    if (!code) {
      return back("failed");
    }
    await connectToDatabase();
    const r = await connectCalendar(userId, code, deps);
    if (!r.ok) {
      console.error("calendar not connected:", r.reason, r.error);
      return back(r.reason === "no_calendar_access" ? "no_calendar_access" : "failed");
    }
    return back("connected");
  });
}
