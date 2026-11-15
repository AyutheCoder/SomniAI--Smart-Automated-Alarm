import { describe, expect, it, vi } from "vitest";
import { DOWN_AFTER, downText, nextStatus, probeAiBrain, upText, type Status } from "./uptime";
import { sendOpsAlert } from "./opsAlert";
import { serviceText } from "@/app/_components/ServiceBanner";

const t = (min: number) => new Date(Date.UTC(2026, 10, 16, 7, min));
const ok = { ok: true } as const;
const fail = (reason = "couldn't connect (ECONNREFUSED)") => ({ ok: false, reason }) as const;

describe("when the AI Brain counts as down, and up again", () => {
  it("one failed check is not an outage; two in a row are, dated from the first", () => {
    expect(DOWN_AFTER).toBe(2);
    let s: Status | null = nextStatus(null, ok, t(0)).status;
    const once = nextStatus(s, fail(), t(1));
    expect(once).toMatchObject({ event: null, status: { state: "up", failures: 1, since: t(0) } });
    const twice = nextStatus(once.status, fail("no answer within 4 s"), t(2));
    expect(twice).toMatchObject({ event: "down", status: { state: "down", since: t(1), failures: 2, reason: "no answer within 4 s" } });
    s = twice.status;
    const still = nextStatus(s, fail(), t(3));
    expect(still.event).toBeNull();
    expect(still.status).toMatchObject({ state: "down", since: t(1), failures: 3 });
    const back = nextStatus(still.status, ok, t(10));
    expect(back).toMatchObject({ event: "up", status: { state: "up", since: t(10), failures: 0, reason: null } });
  });

  it("a single blip between good answers never raises an alert", () => {
    const up = nextStatus(null, ok, t(0)).status;
    const blip = nextStatus(up, fail(), t(1));
    const again = nextStatus(blip.status, ok, t(2));
    expect([blip.event, again.event]).toEqual([null, null]);
    expect(again.status).toMatchObject({ state: "up", since: t(0), failures: 0 });
  });
});

describe("asking the AI Brain", () => {
  const at = (res: unknown) => vi.fn(async () => res as never);

  it("is up only when it answers with its models loaded", async () => {
    expect(await probeAiBrain("http://brain", at({ ok: true, status: 200, json: async () => ({ status: "ok", modelsLoaded: true }) }), 1000)).toEqual({ ok: true });
    expect(await probeAiBrain("http://brain", at({ ok: true, status: 200, json: async () => ({ modelsLoaded: false }) }), 1000))
      .toEqual({ ok: false, reason: "it is running but its models aren't loaded" });
    expect(await probeAiBrain("http://brain", at({ ok: false, status: 502, json: async () => ({}) }), 1000)).toEqual({ ok: false, reason: "it answered 502" });
  });

  it("says why it couldn't be reached", async () => {
    const refused = vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); });
    expect(await probeAiBrain("http://brain", refused, 1000)).toEqual({ ok: false, reason: "couldn't connect (ECONNREFUSED)" });
    const slow = vi.fn(async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); });
    expect(await probeAiBrain("http://brain", slow, 1500)).toEqual({ ok: false, reason: "no answer within 1.5 s" });
  });
});

describe("the alerts", () => {
  it("say what is down, since when, why, and that alarms are fine; and how long it lasted", () => {
    expect(downText(t(1), "no answer within 4 s")).toBe(
      "SomniAI: the AI Brain is down since 2026-11-16 07:01 UTC (no answer within 4 s). Predictions and the wake planner use the app's own rules until it is back. Alarms are not affected.");
    expect(upText(t(1), t(10))).toBe("SomniAI: the AI Brain is back, after 9 min down (since 2026-11-16 07:01 UTC).");
  });

  it("go to the webhook in its format, and are 'delivered' only on a 2xx", async () => {
    const hook = vi.fn<(url: string, init: { headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>>(async () => ({ ok: true, status: 204 }));
    expect(await sendOpsAlert("down", { OPS_ALERT_WEBHOOK: "https://discord.example/api/webhooks/1" }, hook)).toEqual({ status: "delivered", detail: "HTTP 204" });
    expect(hook.mock.calls[0][1]).toMatchObject({ headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "down", content: "down" }) });
    await sendOpsAlert("down", { OPS_ALERT_WEBHOOK: "https://ntfy.sh/somni-ops" }, hook);
    expect(hook.mock.calls[1][1]).toMatchObject({ headers: { "content-type": "text/plain; charset=utf-8" }, body: "down" });
    expect(await sendOpsAlert("down", { OPS_ALERT_WEBHOOK: "https://x.example/h" }, vi.fn(async () => ({ ok: false, status: 404 }))))
      .toEqual({ status: "failed", detail: "the webhook answered 404" });
    expect(await sendOpsAlert("down", {}, hook)).toEqual({ status: "not_configured", detail: "OPS_ALERT_WEBHOOK is not set" });
    expect((await sendOpsAlert("down", { OPS_ALERT_WEBHOOK: "http://x.example/h" }, hook)).status).toBe("failed");
  });
});

describe("what the app shows", () => {
  it("a line while it's down, nothing otherwise", () => {
    const now = new Date();
    expect(serviceText({ state: "down", since: now.toISOString() }, now)).toMatch(/^Predictions and the wake planner are offline since .+\. Alarms ring as normal/);
    for (const s of [{ state: "up", since: now.toISOString() }, { state: "unknown", since: null }, { state: "not_configured", since: now.toISOString() }] as const) {
      expect(serviceText(s, now)).toBeNull();
    }
  });
});
