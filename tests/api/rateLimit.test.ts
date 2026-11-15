import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { middleware } from "@/middleware";
import { authOptions } from "@/lib/auth";
import { hit, limitingOff, policyFor, POLICIES, clientIp } from "@/lib/rateLimit";
import { RateLimit } from "@/models/RateLimit";
import { makeUser } from "./helpers";

const SECRET = "rate-limit-test-secret";
let ipSeq = 0;
const freshIp = () => `203.0.113.${(ipSeq++ % 250) + 1}`;

async function call(method: string, path: string, opts: { ip?: string; userId?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? "198.51.100.7" };
  if (opts.userId) {
    headers.cookie = `next-auth.session-token=${await encode({ token: { sub: opts.userId }, secret: SECRET })}`;
  }
  return middleware(new NextRequest(`http://localhost${path}`, { method, headers }));
}
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", SECRET);
  vi.stubEnv("RATE_LIMIT_DISABLED", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("which requests are limited", () => {
  it("sign-up, sign-in, and every write under /api; reads, cron and NextAuth's own pages are not", () => {
    expect(policyFor("POST", "/api/auth/register")).toBe(POLICIES.signUp);
    expect(policyFor("POST", "/api/auth/callback/credentials")).toBe(POLICIES.signInIp);
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(policyFor(m, "/api/alarms/abc")).toBe(POLICIES.write);
    }
    expect(policyFor("POST", "/api/ai/wake-plan")).toBe(POLICIES.ai);
    expect(policyFor("GET", "/api/alarms")).toBeNull();
    expect(policyFor("GET", "/api/auth/session")).toBeNull();
    expect(policyFor("POST", "/api/cron/buddy-alerts")).toBeNull();
    expect(policyFor("POST", "/sign-in")).toBeNull();
  });

  it("takes the caller's address from the proxy's header", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("the counter", () => {
  it("allows up to the limit in a window, refuses after, and starts again in the next", async () => {
    await makeUser();
    const policy = { name: "t", limit: 3, windowMs: 60_000 };
    const t0 = 1_800_000_000_000;
    const verdicts = [];
    for (let i = 0; i < 4; i++) {
      verdicts.push(await hit(policy, "k", t0 + i));
    }
    expect(verdicts.map((v) => v.ok)).toEqual([true, true, true, false]);
    expect(verdicts.map((v) => v.remaining)).toEqual([2, 1, 0, 0]);
    expect(verdicts[3].retryAfter).toBeGreaterThan(0);
    expect((await hit(policy, "other", t0)).ok).toBe(true);
    expect((await hit(policy, "k", t0 + 60_000)).ok).toBe(true);
    // The window's count expires on its own (TTL index).
    const doc = await RateLimit.findOne({}).lean<{ expiresAt: Date }>();
    expect(doc!.expiresAt).toBeInstanceOf(Date);
  });

  it("lets a request through if the count can't be read, rather than block it", async () => {
    const broken = { increment: vi.fn(async () => { throw new Error("database down"); }) };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await hit(POLICIES.write, "k", Date.now(), broken)).ok).toBe(true);
    err.mockRestore();
  });

  it("can be switched off only outside production", () => {
    expect(limitingOff({ NODE_ENV: "development", RATE_LIMIT_DISABLED: "1" })).toBe(true);
    expect(limitingOff({ NODE_ENV: "production", RATE_LIMIT_DISABLED: "1" })).toBe(false);
    expect(limitingOff({ NODE_ENV: "development" })).toBe(false);
  });
});

describe("the middleware", () => {
  // Fixed windows start afresh on the clock's minute, quarter-hour and hour: a test
  // running across one (CI did, at 15:30:00) sees its count reset. Only Date is
  // faked, at the middle of every window; timers stay real for the database.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-01T12:07:30Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sign-up: 10 an hour from one address, then 429 with Retry-After; another address is unaffected", async () => {
    await makeUser();
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      expect(passedThrough(await call("POST", "/api/auth/register", { ip }))).toBe(true);
    }
    const refused = await call("POST", "/api/auth/register", { ip });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await refused.json()).toEqual({ ok: false, error: "Too many requests. Try again shortly." });
    expect(passedThrough(await call("POST", "/api/auth/register", { ip: freshIp() }))).toBe(true);
  });

  it("sign-in: 30 attempts in 15 minutes from one address", async () => {
    await makeUser();
    const ip = freshIp();
    for (let i = 0; i < 30; i++) {
      await call("POST", "/api/auth/callback/credentials", { ip });
    }
    expect((await call("POST", "/api/auth/callback/credentials", { ip })).status).toBe(429);
  });

  it("sign-in: 10 attempts per account from anywhere, then refused even with the right password", async () => {
    await makeUser();
    const authorize = (authOptions.providers[0] as unknown as { options: { authorize: (c: unknown) => Promise<unknown> } }).options.authorize;
    for (let i = 0; i < 10; i++) {
      expect(await authorize({ email: "target@example.org", password: "wrong-password" })).toBeNull();
    }
    await expect(authorize({ email: "Target@example.org", password: "anything" })).rejects.toThrow(/Too many sign-in attempts/);
  });

  it("writes: 120 a minute per account, reads unlimited, other accounts unaffected", async () => {
    const me = await makeUser();
    const other = await makeUser();
    for (let i = 0; i < 120; i++) {
      expect(passedThrough(await call(i % 2 ? "POST" : "PATCH", "/api/alarms/x", { userId: me }))).toBe(true);
    }
    expect((await call("DELETE", "/api/alarms/x", { userId: me })).status).toBe(429);
    expect(passedThrough(await call("GET", "/api/alarms", { userId: me }))).toBe(true);
    expect(passedThrough(await call("POST", "/api/alarms", { userId: other }))).toBe(true);
  });

  it("signed out: an /api call gets a JSON 401, a page goes to sign-in", async () => {
    await makeUser();
    const api = await call("GET", "/api/alarms");
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ ok: false, error: "Unauthorized" });
    const page = await call("GET", "/analytics");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost/sign-in?callbackUrl=http%3A%2F%2Flocalhost%2Fanalytics");
    expect(passedThrough(await call("GET", "/sign-in"))).toBe(true);
  });

  it("the privacy policy, the terms and the deletion page are public, as Google Play requires (7.2)", async () => {
    await makeUser();
    for (const page of ["/privacy", "/terms", "/delete-account"]) {
      expect(passedThrough(await call("GET", page)), page).toBe(true);
    }
    expect((await call("GET", "/privacy-settings")).status).toBe(307);
  });

  it("routes with their own secret are reached without a session, to check it: cron and the researchers' export", async () => {
    await makeUser();
    expect(passedThrough(await call("POST", "/api/cron/buddy-alerts"))).toBe(true);
    expect(passedThrough(await call("GET", "/api/study/export"))).toBe(true);
    expect(passedThrough(await call("GET", "/api/auth/session"))).toBe(true);
  });

  it("a request body over 1 MB is refused before any route reads it", async () => {
    await makeUser();
    const big = await middleware(new NextRequest("http://localhost/api/events", { method: "POST", headers: { "content-length": "1000001" } }));
    expect(big.status).toBe(413);
    const fine = await middleware(new NextRequest("http://localhost/api/auth/register", { method: "POST", headers: { "content-length": "200", "x-forwarded-for": freshIp() } }));
    expect(passedThrough(fine)).toBe(true);
  });

  it("a forged session token is no session", async () => {
    await makeUser();
    const forged = await encode({ token: { sub: "64b000000000000000000000" }, secret: "someone-elses-secret" });
    const res = await middleware(new NextRequest("http://localhost/api/alarms", { headers: { cookie: `next-auth.session-token=${forged}` } }));
    expect(res.status).toBe(401);
  });
});
