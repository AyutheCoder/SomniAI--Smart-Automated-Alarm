// Where to go after signing in (7.1, found by the security review).
//
// The sign-in page reads `callbackUrl` from its own address and, after a
// password sign-in, navigates there itself: NextAuth's same-origin check only
// covers redirects NextAuth makes. A `javascript:` URL handed to the router
// runs in the app's origin, with the fresh session (and, in the Android app,
// the native bridge), and an absolute URL elsewhere sends the user off-site.
// So only a place on this site is followed; anything else goes home.

/** A same-origin path (with its query and fragment) for `raw`, or "/". */
export function safeCallbackUrl(raw: string | null | undefined, origin: string): string {
  if (!raw) {
    return "/";
  }
  let url: URL;
  try {
    url = new URL(raw, origin);
  }
  catch {
    return "/";
  }
  // The origin check also refuses javascript:, data: and the like (their origin is "null"),
  // and protocol-relative or backslashed paths ("//evil.example", "/\evil.example") that
  // resolve to another host.
  if (url.origin !== new URL(origin).origin) {
    return "/";
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
