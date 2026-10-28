export { default } from "next-auth/middleware";
// api/cron is called by a scheduler, not a signed-in user: each cron route
// checks CRON_SECRET itself and refuses everything without it.
export const config = {
  matcher: [
    "/((?!sign-in|sign-up|api/auth|api/cron|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons).*)",
  ],
};