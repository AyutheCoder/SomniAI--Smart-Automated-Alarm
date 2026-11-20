// Signing in with Google onto an account (7.1, found by the security review).
//
// Sign-up with a password doesn't prove the address is the registrant's. Google
// sign-in used to join whichever account had the same address, so someone could
// register a victim's address with a password first, wait for the victim to
// "Continue with Google" into that account, and then read everything the victim
// put there (sleep, calendar, emergency contact) by signing in with the password.
//
// Now Google joins an account only if Google itself has verified the address and
// the account was made by Google sign-in. An account with a password is signed
// into with the password; Google is refused there with a message saying so.
// (Linking the two from inside a signed-in session would be the way to add it.)

export type GoogleVerdict = "ok" | "unverified" | "has-password";

/** Error codes on /sign-in?error=..., and what the page says for each. */
export const GOOGLE_REFUSED: Record<string, string> = {
  GoogleEmailUnverified: "Google hasn't verified this email address, so it can't be used to sign in.",
  GoogleHasPassword: "This email already has an account with a password. Sign in with your password.",
};

export const GOOGLE_REFUSED_PATH: Record<Exclude<GoogleVerdict, "ok">, string> = {
  "unverified": "/sign-in?error=GoogleEmailUnverified",
  "has-password": "/sign-in?error=GoogleHasPassword",
};

/** May this Google sign-in go ahead, onto `existing` (the account with its address, if any)? */
export function googleVerdict(
  profile: { email_verified?: unknown } | undefined,
  existing: { passwordHash?: string | null } | null,
): GoogleVerdict {
  // Google's OpenID profile says true for a verified address; anything else isn't.
  if (profile?.email_verified !== true) {
    return "unverified";
  }
  if (existing?.passwordHash) {
    return "has-password";
  }
  return "ok";
}
