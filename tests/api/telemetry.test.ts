import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteAll, GET as summary, POST as postWake } from "@/app/api/telemetry/route";
import { PUT as putConsent } from "@/app/api/telemetry/consent/route";
import { GET as exportAll } from "@/app/api/telemetry/export/route";
import type { WakeInput } from "@/lib/telemetry";
import { TELEMETRY_CONSENT } from "@/lib/telemetryConsent";
import { WakeTelemetry } from "@/models/WakeTelemetry";
import { makeUser, read, request, signInAs } from "./helpers";

// The phone's own output for a morning (WakeTelemetryTest checks it is exactly this).
const fixture = JSON.parse(readFileSync(join(__dirname, "../fixtures/telemetry/snoozed-wake.json"), "utf8")) as WakeInput;
const wake = (over: Partial<WakeInput> = {}): WakeInput => ({ ...structuredClone(fixture), ...over });

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const send = async (body: unknown) => read(await postWake(request("POST", "/api/telemetry", body)));
const consent = async (body: unknown) => read(await putConsent(request("PUT", "/api/telemetry/consent", body)));
const allow = () => consent({ granted: true, version: TELEMETRY_CONSENT.version });
const status = async () => (await read(await summary())).body.data;

describe("alarm telemetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("the consent gate: nothing is stored without consent that covers the wake", () => {
    it("no consent ever given: refused, nothing stored", async () => {
      signInAs(await makeUser());
      const r = await send(wake());
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("No consent covers this wake, so it isn't stored");
      expect(await WakeTelemetry.countDocuments()).toBe(0);
    });

    it("consent given after the wake began doesn't cover it", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      signInAs(await makeUser());
      // The wake began at 01:30; consent at 01:35, between its rings.
      at("2026-11-14T01:35:00Z");
      await allow();
      at("2026-11-14T02:00:00Z");
      expect((await send(wake())).status).toBe(403);
      expect(await WakeTelemetry.countDocuments()).toBe(0);
    });

    it("with consent from before the wake: stored once, however often it is sent", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const me = await makeUser();
      signInAs(me);
      at("2026-11-13T20:00:00Z");
      await allow();
      at("2026-11-14T02:00:00Z");
      const first = await send(wake());
      expect(first.status).toBe(201);
      expect(first.body.data).toEqual({ result: "stored" });
      // The outbox resends after a lost reply: nothing doubles.
      expect((await send(wake())).body.data).toEqual({ result: "already_stored" });
      const stored = await WakeTelemetry.find({ userId: me }).lean<Record<string, unknown>[]>();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        alarmId: "64f0a1b2c3d4e5f601234567",
        outcome: "dismissed",
        snoozes: 2,
        firstInteractionMs: 12_000,
        stageReached: { level: 3, stage: "challenge" },
        verification: { required: true, result: "passed", attempts: 4, steps: 3, timeOnTaskMs: 21_000 },
        consentVersion: "telemetry-v1",
      });
      expect((stored[0].rings as { firstInteractionMs: number; outcome: string }[]).map((r) => [r.firstInteractionMs, r.outcome]))
        .toEqual([[12_000, "snoozed"], [3_000, "snoozed"], [61_000, "dismissed"]]);
    });

    it("recorded under another version of the text: refused", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      signInAs(await makeUser());
      at("2026-11-13T20:00:00Z");
      await allow();
      at("2026-11-14T02:00:00Z");
      expect((await send(wake({ consentVersion: "telemetry-v0" }))).status).toBe(403);
    });

    it("after withdrawing, even a wake from while it was given is refused", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      signInAs(await makeUser());
      at("2026-11-13T20:00:00Z");
      await allow();
      at("2026-11-14T03:00:00Z");
      const withdrawn = await consent({ granted: false });
      expect(withdrawn.body.data).toMatchObject({ granted: false, version: null, withdrawnAt: "2026-11-14T03:00:00.000Z" });
      expect((await send(wake())).status).toBe(403);
      expect(await WakeTelemetry.countDocuments()).toBe(0);
    });

    it("after deleting, a wake from before the deletion that the phone still had is refused; a later one is stored", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      signInAs(await makeUser());
      at("2026-11-13T20:00:00Z");
      await allow();
      at("2026-11-14T05:00:00Z");
      await read(await deleteAll());
      expect((await send(wake())).status).toBe(403);
      // The next morning's wake, still with consent: stored.
      at("2026-11-15T02:00:00Z");
      expect((await send(wake({ scheduledFor: "2026-11-15T01:30:00Z", firstRingAt: "2026-11-15T01:30:00Z", endedAt: "2026-11-15T01:41:50Z" }))).status).toBe(201);
    });
  });

  describe("consent", () => {
    it("is given to the text shown, and every change is kept", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      signInAs(await makeUser());
      expect((await status()).consent).toEqual({ granted: false, version: null, grantedAt: null, withdrawnAt: null });
      expect((await consent({ granted: true })).status).toBe(422);
      expect((await consent({ granted: true, version: "telemetry-v0" })).body.error).toBe("version must be the text shown, telemetry-v1");
      expect((await consent({ granted: "yes" })).status).toBe(422);
      at("2026-11-13T20:00:00Z");
      expect((await allow()).body.data).toEqual({ granted: true, version: "telemetry-v1", grantedAt: "2026-11-13T20:00:00.000Z", withdrawnAt: null });
      at("2026-11-14T08:00:00Z");
      await consent({ granted: false });
      const exported = JSON.parse(await (await exportAll()).text());
      expect(exported.consent.history).toEqual([
        { granted: true, version: "telemetry-v1", at: "2026-11-13T20:00:00.000Z" },
        { granted: false, version: null, at: "2026-11-14T08:00:00.000Z" },
      ]);
    });
  });

  describe("export and delete", () => {
    it("exports everything held, as a file, without the account id", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      signInAs(await makeUser());
      at("2026-11-13T20:00:00Z");
      await allow();
      at("2026-11-14T02:00:00Z");
      await send(wake());
      const res = await exportAll();
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="somniai-telemetry-2026-11-14.json"');
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      const data = JSON.parse(await res.text());
      expect(data.consent).toMatchObject({ granted: true, version: "telemetry-v1" });
      expect(data.wakes).toHaveLength(1);
      expect(data.wakes[0]).toMatchObject({ snoozes: 2, firstInteractionMs: 12_000, outcome: "dismissed" });
      expect(data.wakes[0]).not.toHaveProperty("userId");
      expect(data.wakes[0]).not.toHaveProperty("_id");
      expect(data.wakes[0].rings).toHaveLength(3);
    });

    it("deletes every wake, and says how many; consent stays as it was", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const me = await makeUser();
      signInAs(me);
      at("2026-11-13T20:00:00Z");
      await allow();
      at("2026-11-14T02:00:00Z");
      await send(wake());
      await send(wake({ alarmId: "64f0a1b2c3d4e5f601234568" }));
      at("2026-11-14T09:00:00Z");
      expect((await read(await deleteAll())).body.data).toEqual({ deleted: 2 });
      expect(await WakeTelemetry.countDocuments({ userId: me })).toBe(0);
      const s = await status();
      expect(s).toMatchObject({ wakes: 0, latest: [], consent: { granted: true } });
      expect(JSON.parse(await (await exportAll()).text()).wakes).toEqual([]);
    });

    it("the summary shows how many wakes are held and the latest", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      signInAs(await makeUser());
      at("2026-11-13T20:00:00Z");
      await allow();
      at("2026-11-14T02:00:00Z");
      await send(wake());
      expect(await status()).toEqual({
        consent: { granted: true, version: "telemetry-v1", grantedAt: "2026-11-13T20:00:00.000Z", withdrawnAt: null },
        current: { version: "telemetry-v1" },
        wakes: 1,
        latest: [{ scheduledFor: "2026-11-14T01:30:00.000Z", outcome: "dismissed", snoozes: 2, firstInteractionMs: 12_000, stage: "challenge" }],
      });
    });
  });

  describe("only the user's own, and only well-formed wakes", () => {
    it("needs a signed-in user for everything", async () => {
      await makeUser();
      signInAs(null);
      expect((await send(wake())).status).toBe(401);
      expect((await allow()).status).toBe(401);
      expect((await exportAll()).status).toBe(401);
      expect((await deleteAll()).status).toBe(401);
      expect((await summary()).status).toBe(401);
    });

    it("one user's consent doesn't cover another's wakes, and delete touches only one's own", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const alice = await makeUser();
      const bob = await makeUser();
      at("2026-11-13T20:00:00Z");
      signInAs(alice);
      await allow();
      at("2026-11-14T02:00:00Z");
      await send(wake());
      signInAs(bob);
      expect((await send(wake())).status).toBe(403);
      await read(await deleteAll());
      expect(await WakeTelemetry.countDocuments({ userId: alice })).toBe(1);
      expect(JSON.parse(await (await exportAll()).text()).wakes).toEqual([]);
    });

    it("refuses anything that isn't a wake as the phone sends it", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      signInAs(await makeUser());
      at("2026-11-13T20:00:00Z");
      await allow();
      at("2026-11-14T02:00:00Z");
      const ring = fixture.rings[0];
      for (const bad of [
        null,
        wake({ alarmId: "" }),
        wake({ firstRingAt: "07:00" }),
        wake({ endedAt: "2026-11-14T01:00:00Z" }),
        wake({ endedAt: "2026-11-16T01:00:00Z" }),
        wake({ firstRingAt: "2026-11-14T09:00:00Z", endedAt: "2026-11-14T09:10:00Z" }),
        wake({ outcome: "snoozed" as never }),
        wake({ snoozes: 1 }),
        wake({ snoozes: -1 }),
        wake({ firstInteractionMs: 1.5 }),
        wake({ stageReached: { level: 11, stage: "x" } }),
        wake({ verification: { required: true, result: "passed" } }),
        wake({ verification: { required: true, result: "maybe" as never } }),
        wake({ rings: [] }),
        wake({ rings: [{ ...ring, via: "voice" as never }, fixture.rings[1], fixture.rings[2]] }),
        wake({ rings: [{ ...ring, durationMs: -1 }, fixture.rings[1], fixture.rings[2]] }),
      ]) {
        expect((await send(bad)).status, JSON.stringify(bad)?.slice(0, 80)).toBe(422);
      }
      expect(await WakeTelemetry.countDocuments()).toBe(0);
    });
  });
});
