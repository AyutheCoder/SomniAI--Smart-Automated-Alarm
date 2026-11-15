// Failure mode 2 of 3 (prompt 7.3): the database is down.
//
// Every handler of every API route, called with the database gone, must
// answer quickly and clearly: a 503 saying the database is unavailable (or a
// 4xx about the request itself), never a 500 and never a hang. That an alarm
// still rings with the database down is ring-db-down.test.ts (the page) and
// the phone's own tests (it never asks the server at ring time).
import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorEvent } from "@/models/ErrorEvent";
import { makeUser, signInAs } from "./helpers";
import { answeredClearly, everyRoute } from "./sweep";

async function databaseDown() {
  // Queries wait for a connection that isn't coming, then fail fast.
  mongoose.set("bufferTimeoutMS", 300);
  await mongoose.connection.close();
}

afterEach(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_DB_URI!);
  }
});

describe("with the database down", () => {
  it("every API route answers clearly and in time, and the error trackers don't make it worse", async () => {
    signInAs(await makeUser());
    // NextAuth's own handler needs Next's request scope to read cookies, which a direct call
    // doesn't have; the part of it this project wrote, the password check, is tested below.
    const routes = (await everyRoute()).filter((r) => r.key !== "auth/[...nextauth]");
    expect(routes.length).toBeGreaterThan(60);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await databaseDown();

    const failures: string[] = [];
    const unavailable: string[] = [];
    for (const r of routes) {
      const t0 = Date.now();
      let res: Response;
      try {
        res = await r.call();
      }
      catch (e) {
        failures.push(`${r.method} /api/${r.key}: threw ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const ms = Date.now() - t0;
      if (res.status === 503) {
        const body = await res.clone().json().catch(() => null) as { error?: string } | null;
        if (body?.error === "The database is unavailable. Please try again shortly.") {
          unavailable.push(`${r.method} ${r.key}`);
        }
      }
      const problem = await answeredClearly(res);
      if (problem || ms > 5_000) {
        failures.push(`${r.method} /api/${r.key}: ${problem ?? `took ${ms} ms`}`);
      }
    }
    log.mockRestore();
    expect(failures).toEqual([]);
    // Most routes need the database for anything, and say so in those words.
    expect(unavailable.length).toBeGreaterThan(routes.length / 2);
  }, 120_000);

  it("signing in says the database is down, not that the password is wrong", async () => {
    const { authOptions } = await import("@/lib/auth");
    const { SIGN_IN_TROUBLE, signInErrorText } = await import("@/lib/signInErrors");
    const authorize = (authOptions.providers.find((p) => p.id === "credentials") as unknown as {
      options: { authorize: (c: Record<string, string>) => Promise<unknown> };
    }).options.authorize;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await databaseDown();
    await expect(authorize({ email: "someone@example.org", password: "right password" })).rejects.toThrow(SIGN_IN_TROUBLE.unavailable);
    log.mockRestore();
    // What the page shows for each answer NextAuth gives it.
    expect(signInErrorText(SIGN_IN_TROUBLE.unavailable)).toMatch(/database isn't answering/);
    expect(signInErrorText(SIGN_IN_TROUBLE.rateLimited)).toMatch(/Too many sign-in attempts/);
    expect(signInErrorText("CredentialsSignin")).toBe("Invalid email or password.");
    expect(signInErrorText("some internal detail")).toBe("Invalid email or password.");
  });

  it("an error that can't be recorded is logged instead, without a trace of who hit it", async () => {
    const { recordError } = await import("@/lib/errorTracking");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await databaseDown();
    expect(await recordError({ source: "server", kind: "TypeError", message: "broke for someone@example.org" })).toBe("logged");
    const line = JSON.parse(log.mock.calls.at(-1)![0] as string);
    expect(line).toMatchObject({ event: "error-not-recorded", message: "broke for <email>" });
    log.mockRestore();
    await mongoose.connect(process.env.MONGO_DB_URI!);
    expect(await ErrorEvent.countDocuments()).toBe(0);
  });
});
