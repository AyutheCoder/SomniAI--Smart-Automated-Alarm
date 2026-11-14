import { describe, expect, it, vi } from "vitest";
import { allow, deleteEverything, hasTelemetry, interactionText, phoneNeeds, syncPhone, TELEMETRY_API, withdraw } from "./telemetryClient";
import { TELEMETRY_CONSENT } from "./telemetryConsent";

const ON = { granted: true, version: "telemetry-v1", grantedAt: "2026-11-13T20:00:00.000Z", withdrawnAt: null };
const OFF = { granted: false, version: null, grantedAt: null, withdrawnAt: "2026-11-14T08:00:00.000Z" };

function phone(state: { granted: boolean; version: string | null }, dropped = 0) {
  const order: string[] = [];
  return {
    order,
    telemetryStatus: vi.fn(async () => ({ ...state, openWakes: 0, queued: 0 })),
    setTelemetryConsent: vi.fn(async (o: { granted: boolean; version?: string }) => {
      order.push(`phone ${o.granted ? "on" : "off"}`);
      return { granted: o.granted, version: o.version ?? null, openWakes: 0, queued: 0, dropped };
    }),
    clearTelemetry: vi.fn(async () => {
      order.push("phone clear");
      return { ...state, openWakes: 0, queued: 0, dropped };
    }),
  };
}
const server = (order: string[], data: unknown, ok = true) => vi.fn(async (method: string) => {
  order.push(`server ${method}`);
  return ok ? { ok: true, data } : { ok: false, error: "The server said 503." };
});

describe("telemetry from the app's page", () => {
  it("is on the phone only with plugin API 7", () => {
    expect(TELEMETRY_API).toBe(7);
    expect(hasTelemetry({ reason: "browser" })).toBe(false);
    expect(hasTelemetry({ api: 6 } as never)).toBe(false);
    expect(hasTelemetry({ api: 7 } as never)).toBe(true);
  });

  it("the phone follows the account: on with its version, off, or left alone when in step", () => {
    expect(phoneNeeds(ON, { granted: false, version: null })).toEqual({ granted: true, version: "telemetry-v1" });
    expect(phoneNeeds(ON, { granted: true, version: "telemetry-v0" })).toEqual({ granted: true, version: "telemetry-v1" });
    expect(phoneNeeds(ON, { granted: true, version: "telemetry-v1" })).toBeNull();
    // Withdrawn in a browser: the phone stops too.
    expect(phoneNeeds(OFF, { granted: true, version: "telemetry-v1" })).toEqual({ granted: false });
    expect(phoneNeeds(OFF, { granted: false, version: null })).toBeNull();
  });

  it("on opening the app, the phone is told only when it differs", async () => {
    const p = phone({ granted: true, version: "telemetry-v1" });
    expect(await syncPhone(p, OFF)).toBe("withdrawn");
    expect(p.setTelemetryConsent).toHaveBeenCalledWith({ granted: false });
    const q = phone({ granted: true, version: "telemetry-v1" });
    expect(await syncPhone(q, ON)).toBeNull();
    expect(q.setTelemetryConsent).not.toHaveBeenCalled();
  });

  it("allowing records the version shown, then turns the phone on", async () => {
    const p = phone({ granted: false, version: null });
    const put = server(p.order, ON);
    const r = await allow(p, put);
    expect(put).toHaveBeenCalledWith("PUT", "/api/telemetry/consent", { granted: true, version: TELEMETRY_CONSENT.version });
    expect(p.order).toEqual(["server PUT", "phone on"]);
    expect(r).toMatchObject({ ok: true, text: "Telemetry is on. It starts with the next alarm that rings on this phone." });
  });

  it("if the account refuses, the phone is not turned on", async () => {
    const p = phone({ granted: false, version: null });
    const r = await allow(p, server(p.order, null, false));
    expect(r).toEqual({ ok: false, text: "Couldn't turn telemetry on: The server said 503." });
    expect(p.setTelemetryConsent).not.toHaveBeenCalled();
  });

  it("withdrawing stops the phone first, whatever the network does", async () => {
    const p = phone({ granted: true, version: "telemetry-v1" }, 2);
    const r = await withdraw(p, server(p.order, OFF));
    expect(p.order).toEqual(["phone off", "server PUT"]);
    expect(r).toMatchObject({ ok: true, text: "Telemetry is off. Nothing more is recorded. 2 wakes not yet sent from this phone were dropped. What was already recorded stays until you delete it." });
    const q = phone({ granted: true, version: "telemetry-v1" });
    const offline = await withdraw(q, server(q.order, null, false));
    expect(q.order).toEqual(["phone off", "server PUT"]);
    expect(offline.ok).toBe(false);
    expect(offline.text).toMatch(/^This phone stopped recording, but the account couldn't be updated/);
  });

  it("deleting clears the phone's unsent wakes before the server's", async () => {
    const p = phone({ granted: true, version: "telemetry-v1" }, 1);
    const r = await deleteEverything(p, server(p.order, { deleted: 12 }));
    expect(p.order).toEqual(["phone clear", "server DELETE"]);
    expect(r).toEqual({ ok: true, text: "Deleted 12 recorded wakes, and 1 not yet sent from this phone." });
    const failed = await deleteEverything(null, server([], null, false));
    expect(failed).toEqual({ ok: false, text: "Couldn't delete: The server said 503. Nothing on the server was deleted; try again." });
  });

  it("in a browser there is no phone to tell", async () => {
    const put = server([], ON);
    expect((await allow(null, put)).ok).toBe(true);
    expect((await allow(null, put)) as { text: string }).toMatchObject({ text: "Telemetry is on. It starts with the next alarm that rings in the SomniAI Android app." });
  });

  it("says a time to first interaction plainly", () => {
    expect(interactionText(null)).toBe("untouched");
    expect(interactionText(4_250)).toBe("4.3 s");
    expect(interactionText(62_000)).toBe("1 min 2 s");
  });

  it("the consent text says what is recorded, what isn't, and how to stop", () => {
    const text = TELEMETRY_CONSENT.points.join(" ");
    for (const must of [/first touched the screen or pressed a key/, /how many times you snoozed/, /how far the alarm escalated/,
      /how the wake check went/, /nothing about where you are/, /Nothing is recorded until you allow it/,
      /stop at any time, download everything recorded, or delete all of it/]) {
      expect(text).toMatch(must);
    }
    expect(TELEMETRY_CONSENT.version).toBe("telemetry-v1");
  });
});
