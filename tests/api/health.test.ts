// The deployment's health check (prompt 7.4): public, honest, and about nothing personal.
import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { makeUser } from "./helpers";

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_DB_URI!);
  }
});

describe("GET /api/health", () => {
  it("says the database answers, which environment and commit this is, and that no AI Brain is set", async () => {
    await makeUser();
    vi.stubEnv("SOMNIAI_ENV", "staging");
    vi.stubEnv("SOMNIAI_COMMIT", "abc1234");
    vi.stubEnv("AI_BRAIN_URL", "");
    const res = await health();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, database: "up", aiBrain: "not_configured", environment: "staging", commit: "abc1234" });
  });

  it("counts the AI Brain up only with its models loaded", async () => {
    await makeUser();
    vi.stubEnv("AI_BRAIN_URL", "http://ai-brain.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok", modelsLoaded: false }), { status: 200 })));
    expect((await (await health()).json()).aiBrain).toBe("down");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok", modelsLoaded: true }), { status: 200 })));
    expect((await (await health()).json()).aiBrain).toBe("up");
  });

  it("is a 503 when the database doesn't answer", async () => {
    await makeUser();
    mongoose.set("bufferTimeoutMS", 300);
    await mongoose.connection.close();
    const res = await health();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, database: "down", error: "The database isn't answering." });
  });
});
