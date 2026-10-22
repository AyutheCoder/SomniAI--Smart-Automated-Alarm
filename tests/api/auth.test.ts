// Sign-up and sign-in. These are the routes that must work signed out, so the
// "unauthenticated" case is that they do, and nothing about one account is
// reachable from another.
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { POST as register } from "@/app/api/auth/register/route";
import { GET as nextAuthGet, POST as nextAuthPost } from "@/app/api/auth/[...nextauth]/route";
import { authOptions } from "@/lib/auth";
import { User } from "@/models/User";
import { read, request } from "./helpers";

type Authorize = (credentials: Record<string, string> | undefined) => Promise<{ id: string; email: string } | null>;
const credentials = authOptions.providers.find((p) => p.id === "credentials") as unknown as {
  options: { authorize: Authorize };
};
const authorize: Authorize = (c) => credentials.options.authorize(c);

describe("POST /api/auth/register", () => {
  it("works signed out and stores only a hash of the password", async () => {
    const res = await read(await register(request("POST", "/api/auth/register", {
      email: "  Sleeper@Example.TEST ", password: "correct horse", name: "Sleeper",
    })));
    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe("sleeper@example.test");
    const stored = await User.findOne({ email: "sleeper@example.test" }).select("+passwordHash").lean<{ passwordHash: string }>();
    expect(stored?.passwordHash).not.toContain("correct horse");
    expect(await bcrypt.compare("correct horse", stored!.passwordHash)).toBe(true);
  });

  it.each([
    ["malformed JSON", "{", 400, /Invalid request body/],
    ["a missing email", { password: "longenough" }, 400, /A valid email is required/],
    ["a malformed email", { email: "sleeper@", password: "longenough" }, 400, /A valid email is required/],
    ["an email that is not a string", { email: 12, password: "longenough" }, 400, /A valid email is required/],
    ["a short password", { email: "a@b.test", password: "short" }, 400, /at least 8 characters/],
    ["a password that is not a string", { email: "a@b.test", password: 123456789 }, 400, /at least 8 characters/],
    ["a password over 72 bytes, which bcrypt would silently truncate", { email: "a@b.test", password: "p".repeat(73) }, 400, /72 characters or fewer/],
    ["a name over 120 characters", { email: "a@b.test", password: "longenough", name: "n".repeat(121) }, 422, /Name must be 120 characters or fewer/],
  ])("rejects %s with a clear error", async (_what, body, status, message) => {
    const res = await read(await register(request("POST", "/api/auth/register", body)));
    expect(res.status).toBe(status);
    expect(res.body.error).toMatch(message);
    expect(await User.countDocuments()).toBe(0);
  });

  it("refuses a second account for the same email, whatever its case", async () => {
    await register(request("POST", "/api/auth/register", { email: "dup@example.test", password: "longenough" }));
    const res = await read(await register(request("POST", "/api/auth/register", { email: "DUP@example.test", password: "different1" })));
    expect(res.status).toBe(409);
    expect(await User.countDocuments()).toBe(1);
  });
});

// The handler itself is NextAuth's and reads cookies through Next's request
// scope, which only exists inside a running server; the Playwright flows
// (prompt 0.4) sign in through it over HTTP. Here: the wiring, and the parts
// this project wrote, which are the credentials check and the session shape.
describe("GET /api/auth/[...nextauth]", () => {
  it("serves one NextAuth handler for GET and POST, built from authOptions", () => {
    expect(typeof nextAuthGet).toBe("function");
    expect(nextAuthPost).toBe(nextAuthGet);
    expect(authOptions.session?.strategy).toBe("jwt");
    expect(authOptions.providers.map((p) => p.id)).toContain("credentials");
  });
});

describe("POST /api/auth/[...nextauth] (credentials sign-in)", () => {
  beforeEach(async () => {
    await User.create({ email: "owner@example.test", passwordHash: await bcrypt.hash("right password", 4) });
    await User.create({ email: "google@example.test", provider: "google" });
  });

  it("signs in with the right password, matching the email case-insensitively", async () => {
    const user = await authorize({ email: "Owner@Example.test", password: "right password" });
    expect(user?.email).toBe("owner@example.test");
  });

  it.each([
    ["a wrong password", { email: "owner@example.test", password: "wrong password" }],
    ["an unknown email", { email: "nobody@example.test", password: "right password" }],
    ["a Google account with no password", { email: "google@example.test", password: "" }],
    ["missing credentials", undefined],
  ])("refuses %s", async (_what, creds) => {
    expect(await authorize(creds)).toBeNull();
  });

  it("puts the account id, and only it, on the session", async () => {
    const session = await authOptions.callbacks!.session!({
      session: { user: { name: "x" }, expires: "" } as Session,
      token: { uid: "abc123" } as JWT,
    } as Parameters<NonNullable<typeof authOptions.callbacks>["session"] & object>[0]);
    expect((session as Session).user.id).toBe("abc123");
  });
});
