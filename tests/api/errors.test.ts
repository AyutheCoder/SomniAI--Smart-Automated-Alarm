// Error tracking in SomniAI's own database (prompt 7.3): the page's reports,
// the server's own unhandled errors, grouped and counted, with nothing in them
// that names a person.
import { describe, expect, it, vi } from "vitest";
import { POST as report } from "@/app/api/errors/route";
import { routeError } from "@/lib/http";
import { ErrorEvent } from "@/models/ErrorEvent";
import { makeUser, read, request, signInAs } from "./helpers";

const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 50 && !(await check()); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("POST /api/errors", () => {
  it("records the page's error, scrubbed, and counts it again instead of storing it twice", async () => {
    signInAs(await makeUser());
    const body = {
      kind: "TypeError",
      message: "Cannot read properties of undefined (reading 'granted') for night.owl@example.org",
      stack: "TypeError: ...\n    at TelemetryPanel (app/_components/TelemetryPanel.tsx:70:30)\n    at renderWithHooks (react-dom.js:1:1)",
      where: "/?alarm=64f0a1b2c3d4e5f601234567",
    };
    const first = await report(request("POST", "/api/errors", body));
    expect(first.status).toBe(202);
    await report(request("POST", "/api/errors", { ...body, stack: body.stack.replace(":70:30", ":71:2") }));
    const stored = await ErrorEvent.find({}).lean<{ source: string; kind: string; message: string; where: string; count: number; stack: string }[]>();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ source: "browser", kind: "TypeError", where: "/", count: 2 });
    expect(stored[0].message).toBe("Cannot read properties of undefined (reading 'granted') for <email>");
    expect(stored[0].stack.split("\n")[0]).toBe("at TelemetryPanel (app/_components/TelemetryPanel.tsx:71:2)");
  });

  it("takes reports only from a signed-in page, and only well-formed ones", async () => {
    signInAs(null);
    expect((await report(request("POST", "/api/errors", { kind: "Error", message: "x" }))).status).toBe(401);
    signInAs(await makeUser());
    for (const bad of [{ message: "no kind" }, { kind: "Error" }, { kind: "Error", message: 1 }, { kind: "Error", message: "x", stack: {} }, { kind: "x".repeat(201), message: "x" }]) {
      expect((await read(await report(request("POST", "/api/errors", bad)))).status).toBe(422);
    }
    expect(await ErrorEvent.countDocuments()).toBe(0);
  });
});

describe("the server's own errors", () => {
  it("an error a route doesn't handle is still a plain 500 for the caller, and is recorded", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = routeError(new TypeError("plan is undefined for 64f0a1b2c3d4e5f601234567"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Something went wrong on our end" });
    await until(async () => (await ErrorEvent.countDocuments()) > 0);
    const stored = await ErrorEvent.findOne({}).lean<{ source: string; kind: string; message: string }>();
    expect(stored).toMatchObject({ source: "server", kind: "TypeError", message: "plan is undefined for <id>" });
    log.mockRestore();
  });

  it("a database outage is a 503 the caller can act on, not an error to track", async () => {
    const res = routeError(Object.assign(new Error("connect ECONNREFUSED"), { name: "MongoServerSelectionError" }));
    expect(res.status).toBe(503);
    await new Promise((r) => setTimeout(r, 50));
    expect(await ErrorEvent.countDocuments()).toBe(0);
  });
});
