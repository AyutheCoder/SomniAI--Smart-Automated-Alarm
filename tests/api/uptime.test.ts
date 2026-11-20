// Uptime monitoring for the AI Brain (prompt 7.3), against the database: a
// whole outage from first failed check to recovery, with one alert at each
// end; the scheduler's key; and what the app tells users.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cronCheckGet, POST as cronCheck } from "@/app/api/cron/ai-brain-health/route";
import { GET as status } from "@/app/api/status/route";
import { checkAiBrain, type CheckDeps } from "@/lib/uptime";
import { Outage, ServiceStatus } from "@/models/ServiceStatus";
import { makeUser, read, signInAs } from "./helpers";

const minute = (m: number) => new Date(Date.UTC(2026, 10, 16, 7, m));
const healthy = async () => ({ ok: true, status: 200, json: async () => ({ status: "ok", modelsLoaded: true }) });
const refused = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); };

function deps(now: Date, fetch: CheckDeps["fetch"], alert: CheckDeps["alert"] = async () => ({ status: "delivered", detail: "HTTP 200" })): CheckDeps {
  return { url: "http://ai-brain.test", fetch, timeoutMs: 1000, now, alert };
}

describe("an outage, from start to end", () => {
  it("is recorded once, alerted once when it starts and once when it ends", async () => {
    const alert = vi.fn<CheckDeps["alert"]>(async () => ({ status: "delivered", detail: "HTTP 200" }));
    expect((await checkAiBrain(deps(minute(0), healthy, alert))).state).toBe("up");
    expect(await checkAiBrain(deps(minute(1), refused, alert))).toMatchObject({ state: "up", failures: 1, event: null });
    expect(await checkAiBrain(deps(minute(2), refused, alert))).toMatchObject({ state: "down", event: "down", alert: { status: "delivered" } });
    await checkAiBrain(deps(minute(3), refused, alert));
    await checkAiBrain(deps(minute(4), refused, alert));
    expect(await checkAiBrain(deps(minute(9), healthy, alert))).toMatchObject({ state: "up", event: "up" });

    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[0][0]).toContain("down since 2026-11-16 07:01 UTC (couldn't connect (ECONNREFUSED))");
    expect(alert.mock.calls[1][0]).toContain("back, after 8 min down");
    const outages = await Outage.find({}).lean<{ startedAt: Date; endedAt: Date; reason: string; alerts: { about: string; status: string }[] }[]>();
    expect(outages).toHaveLength(1);
    expect(outages[0]).toMatchObject({ startedAt: minute(1), endedAt: minute(9), reason: "couldn't connect (ECONNREFUSED)" });
    expect(outages[0].alerts.map((a) => `${a.about}:${a.status}`)).toEqual(["down:delivered", "up:delivered"]);
  });

  it("records an alert that couldn't be sent as such", async () => {
    const alert = vi.fn(async () => ({ status: "not_configured" as const, detail: "OPS_ALERT_WEBHOOK is not set" }));
    await checkAiBrain(deps(minute(0), refused, alert));
    await checkAiBrain(deps(minute(1), refused, alert));
    const outage = await Outage.findOne({}).lean<{ alerts: { status: string }[] }>();
    expect(outage!.alerts[0].status).toBe("not_configured");
  });

  it("without an AI Brain configured, there is nothing to be down", async () => {
    const r = await checkAiBrain({ ...deps(minute(0), refused), url: "" });
    expect(r).toMatchObject({ state: "not_configured", event: null, alert: null });
    expect(await Outage.countDocuments()).toBe(0);
  });
});

describe("the scheduler's route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "uptime-test-secret");
    vi.stubEnv("AI_BRAIN_URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const call = (auth?: string) => cronCheck(new NextRequest("http://localhost/api/cron/ai-brain-health", { method: "POST", headers: auth ? { authorization: auth } : {} }));

  it("runs a check only with the scheduler's key", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-secret-of-same-len")).status).toBe(401);
    const ok = await read(await call("Bearer uptime-test-secret"));
    expect(ok.status).toBe(200);
    expect(ok.body.data.state).toBe("not_configured");
    // Vercel Cron calls with GET.
    expect((await cronCheckGet(new NextRequest("http://localhost/api/cron/ai-brain-health", { headers: { authorization: "Bearer uptime-test-secret" } }))).status).toBe(200);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer uptime-test-secret")).status).toBe(503);
  });
});

describe("what users are told", () => {
  it("down since when, and 'unknown' when the checks have stopped running", async () => {
    signInAs(await makeUser());
    const now = new Date();
    await ServiceStatus.create({ service: "ai-brain", state: "down", since: new Date(now.getTime() - 600_000), checkedAt: now, failures: 3 });
    const res = await read(await status());
    expect(res.body.data.aiBrain).toEqual({ state: "down", since: new Date(now.getTime() - 600_000).toISOString() });
    await ServiceStatus.updateOne({ service: "ai-brain" }, { $set: { checkedAt: new Date(now.getTime() - 10 * 60_000) } });
    expect((await read(await status())).body.data.aiBrain).toEqual({ state: "unknown", since: null });
    signInAs(null);
    expect((await status()).status).toBe(401);
  });
});
