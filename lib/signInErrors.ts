// What the sign-in page says when signing in fails (prompt 7.3).
//
// NextAuth hands the page "CredentialsSignin" for a wrong email or password,
// and the message of anything the credentials check threw. The page used to
// say "Invalid email or password." for all of them, so a database outage or
// the per-account limit (7.1) told people their password was wrong. The check
// now throws only these messages, and the page shows them as they are.

export const SIGN_IN_TROUBLE = {
  rateLimited: "Too many sign-in attempts for this account. Try again in a few minutes.",
  unavailable: "SomniAI can't check your password right now: its database isn't answering. Try again in a minute. Alarms on your phone ring as set.",
} as const;

const OURS = new Set<string>(Object.values(SIGN_IN_TROUBLE));

/** The sentence to show for NextAuth's `error`. */
export function signInErrorText(error: string): string {
  if (OURS.has(error)) {
    return error;
  }
  return "Invalid email or password.";
}
