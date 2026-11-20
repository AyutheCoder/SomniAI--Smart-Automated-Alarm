// Encrypts a secret before it is stored (prompt 4.1: Google's refresh token),
// so a copy of the database alone doesn't hand over the user's calendar.
// AES-256-GCM, keyed from NEXTAUTH_SECRET and a purpose, so the same server
// secret yields a different key for each use. Server-only.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function keyFor(purpose: string, secret: string | undefined): Buffer {
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not set, so secrets can't be stored");
  }
  return createHash("sha256").update(`somniai:${purpose}:${secret}`).digest();
}

export function seal(plain: string, purpose: string, secret = process.env.NEXTAUTH_SECRET): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(purpose, secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** The secret, or null if it can't be opened (another key, or altered). */
export function open(sealed: string, purpose: string, secret = process.env.NEXTAUTH_SECRET): string | null {
  const [version, data] = sealed.split(":");
  if (version !== VERSION || !data) {
    return null;
  }
  try {
    const raw = Buffer.from(data, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", keyFor(purpose, secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
  catch {
    return null;
  }
}
