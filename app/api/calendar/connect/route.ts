import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongoose";
import { jsonError, guard } from "@/lib/http";
import { getUserId } from "@/lib/session";
import { authorizationUrl } from "@/lib/googleCalendar";
import { STATE_COOKIE, calendarDeps, makeOAuthState } from "@/lib/calendarServer";
import { User } from "@/models/User";

/**
 * Starts connecting Google Calendar (prompt 4.1): off to Google's consent
 * screen, asking only for read-only calendar events on top of what sign-in
 * granted. The signed-in user is bound to the request by a sealed cookie.
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const userId = await getUserId();
    if (!userId) {
      return jsonError("Unauthorized", 401);
    }
    const deps = calendarDeps();
    if (!deps.google) {
      return NextResponse.redirect(new URL("/?calendar=not_configured", req.url));
    }
    await connectToDatabase();
    const user = await User.findById(userId).lean<{ email?: string }>();
    const { state, cookie } = makeOAuthState(userId, deps.now);
    const res = NextResponse.redirect(authorizationUrl(deps.google, state, user?.email));
    res.cookies.set(STATE_COOKIE, cookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/api/calendar",
      maxAge: 600,
    });
    return res;
  });
}
