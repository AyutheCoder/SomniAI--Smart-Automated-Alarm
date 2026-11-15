import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { clientIp, hit, policyFor, stagingTester } from "@/lib/rateLimit";

/**
 * Every request, before its route (prompt 7.1):
 *
 * 1. Rate limits: sign-up and sign-in by address, every write under /api by
 *    account (or address, signed out); see lib/rateLimit.ts. Over the limit:
 *    429 with Retry-After.
 * 2. Sign-in: a page needs a session or goes to /sign-in; an /api call needs
 *    one or gets a JSON 401 (it used to get the sign-in page's redirect, which
 *    no client could read). Routes that authenticate with their own secret
 *    instead of a session are let through to check it: the scheduler's
 *    (api/cron, CRON_SECRET) and the researchers' export (STUDY_EXPORT_TOKEN).
 *
 * Runs on Node, not the edge, to reach the shared counts in MongoDB.
 */
// The legal pages are public (7.2): Google Play needs the policy and the deletion page reachable signed out.
const PUBLIC_PAGES = ["/sign-in", "/sign-up", "/privacy", "/terms", "/delete-account"];
const OWN_SECRET = ["/api/auth/", "/api/cron/", "/api/study/export"];
/** Public on purpose: the health check (7.4) says only whether the database and AI Brain answer. */
const PUBLIC_API = ["/api/health"];

/** Larger than any request the app or the phone sends; a bigger one is refused before it is read. */
export const MAX_BODY_BYTES = 1_000_000;

const isPublic = (path: string) =>
  PUBLIC_PAGES.some((p) => path === p || path.startsWith(`${p}/`)) || OWN_SECRET.some((p) => path.startsWith(p)) || PUBLIC_API.includes(path);

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
  const userId = typeof token?.sub === "string" ? token.sub : null;

  // Route handlers read JSON bodies whole, with no size limit of their own (found in 7.1's audit).
  const length = Number(req.headers.get("content-length") ?? 0);
  if (path.startsWith("/api/") && length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Request too large" }, { status: 413 });
  }

  // The staging-only exemption for the end-to-end flows (lib/rateLimit.ts, 7.4).
  const policy = stagingTester(req.headers) ? null : policyFor(req.method, path);
  if (policy) {
    // Writes count per account when signed in, so one busy household address doesn't lock everyone out.
    const key = userId && policy.name !== "sign-up" && policy.name !== "sign-in" ? `user:${userId}` : `ip:${clientIp(req.headers)}`;
    const verdict = await hit(policy, key);
    if (!verdict.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(verdict.retryAfter), "RateLimit-Limit": String(verdict.limit), "RateLimit-Remaining": "0" } },
      );
    }
  }

  if (isPublic(path) || userId) {
    return NextResponse.next();
  }
  if (path.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const signIn = new URL("/sign-in", req.url);
  signIn.searchParams.set("callbackUrl", req.nextUrl.href);
  return NextResponse.redirect(signIn);
}

export const config = {
  runtime: "nodejs",
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons).*)",
  ],
};
