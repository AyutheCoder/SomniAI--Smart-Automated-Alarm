// Rate limiting (prompt 7.1). Fixed windows, counted in MongoDB so that every
// server instance shares them (an in-memory count would reset per instance and
// per deploy). Applied in middleware.ts to sign-up, sign-in and every write
// under /api, and per e-mail address inside sign-in itself (lib/auth.ts).
//
// A limited request gets 429 with Retry-After. The phone's outbox and the web
// outbox treat 429 as "later", never as "drop", so a burst of alarm syncs is
// delayed, not lost. If the count can't be read (the database is down), the
// request is let through: the route then fails or succeeds on its own, and a
// limiter must never be why an alarm's result isn't recorded.

import { createHash } from "node:crypto";
import { connectToDatabase } from "@/lib/mongoose";
import { RateLimit } from "@/models/RateLimit";

export interface Policy {
  name: string;
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;

export const POLICIES = {
  /** New accounts from one address: generous enough for a shared university or office network. */
  signUp: { name: "sign-up", limit: 10, windowMs: 60 * MINUTE },
  /** Sign-in attempts from one address. */
  signInIp: { name: "sign-in", limit: 30, windowMs: 15 * MINUTE },
  /** Sign-in attempts for one account, from anywhere: password guessing spread over many addresses. */
  signInAccount: { name: "sign-in-account", limit: 10, windowMs: 15 * MINUTE },
  /** The AI routes, which each call the AI Brain. */
  ai: { name: "ai", limit: 30, windowMs: MINUTE },
  /** Every other write: far above what the app or a phone's outbox sends. */
  write: { name: "write", limit: 120, windowMs: MINUTE },
} as const satisfies Record<string, Policy>;

export interface Verdict {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

export interface Counter {
  /** Adds one to the key's count in this window and returns the new count. */
  increment(id: string, expiresAt: Date): Promise<number>;
}

const mongoCounter: Counter = {
  async increment(id, expiresAt) {
    await connectToDatabase();
    const doc = await RateLimit.findOneAndUpdate(
      { _id: id },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, new: true, lean: true },
    );
    return (doc as unknown as { count: number }).count;
  },
};

/** Off only outside production, and only when asked (the e2e server signs up many users from one address). */
export function limitingOff(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && env.RATE_LIMIT_DISABLED === "1";
}

/** Counts one request for `key` under `policy`. */
export async function hit(policy: Policy, key: string, now = Date.now(), counter: Counter = mongoCounter): Promise<Verdict> {
  const window = Math.floor(now / policy.windowMs);
  const resetAt = (window + 1) * policy.windowMs;
  const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
  if (limitingOff()) {
    return { ok: true, limit: policy.limit, remaining: policy.limit, retryAfter };
  }
  let count: number;
  try {
    // The window's document expires a window after it ends: MongoDB's TTL monitor removes it.
    count = await counter.increment(`${policy.name}|${key}|${window}`, new Date(resetAt + policy.windowMs));
  }
  catch (e) {
    console.error(`[rate-limit] couldn't count ${policy.name}; letting it through:`, e instanceof Error ? e.message : e);
    return { ok: true, limit: policy.limit, remaining: policy.limit, retryAfter };
  }
  return { ok: count <= policy.limit, limit: policy.limit, remaining: Math.max(0, policy.limit - count), retryAfter };
}

/** Which policy a request falls under, if any. */
export function policyFor(method: string, path: string): Policy | null {
  if (method === "POST" && path === "/api/auth/register") {
    return POLICIES.signUp;
  }
  if (method === "POST" && path.startsWith("/api/auth/callback/credentials")) {
    return POLICIES.signInIp;
  }
  if (!path.startsWith("/api/") || path.startsWith("/api/auth/") || path.startsWith("/api/cron/")) {
    return null;
  }
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return null;
  }
  return path.startsWith("/api/ai/") ? POLICIES.ai : POLICIES.write;
}

/** The caller's address, as the hosting proxy reports it. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** The per-account sign-in key: a hash, so the counts don't hold e-mail addresses. */
export function accountKey(email: string): string {
  return `account:${createHash("sha256").update(email.toLowerCase().trim()).digest("hex")}`;
}
