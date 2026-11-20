import { describe, expect, it, vi } from "vitest";
import { POST as backups } from "@/app/api/alarms/[id]/backups/route";
import { POST as stop } from "@/app/api/alarms/[id]/backups/stop/route";
import { GET as status } from "@/app/api/buddy/route";
import { PUT as putSettings } from "@/app/api/buddy/settings/route";
import { POST as invite } from "@/app/api/buddy/invite/route";
import { POST as ask } from "@/app/api/buddy/requests/route";
import { PATCH as respond } from "@/app/api/buddy/requests/[id]/route";
import { requestBackups, stopBackups, WATCH_REASON } from "@/lib/backupServer";
import { runBuddyAlerts } from "@/lib/buddyAlerts";
import { contactText } from "@/lib/buddy";
import type { PushSender } from "@/lib/push";
import type { SmsSender } from "@/lib/sms";
import { Alarm, type AlarmDocument } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { BuddyAlert, PushToken } from "@/models/Buddy";
import { MISSING_ID, idParams, makeUser, read, request, signInAs } from "./helpers";

const T = new Date("2026-10-28T07:00:00.000Z");
const at = (minutes: number) => new Date(T.getTime() + minutes * 60_000);
const tok = (name: string) => `fcm-${name}-` + "x".repeat(40);

function push(result: { ok: boolean; messageId?: string; unregistered?: boolean; error?: string } = { ok: true, messageId: "projects/p/messages/1" }) {
  return { configured: true, send: vi.fn<PushSender["send"]>(async () => result) };
}
function sms(result: { ok: boolean; messageId?: string; error?: string } = { ok: true, messageId: "SM123" }) {
  return { configured: true, send: vi.fn<SmsSender["send"]>(async () => result) };
}
const off = { configured: false, send: vi.fn(async () => ({ ok: false })) };

async function alarm(userId: string, fields: Record<string, unknown> = {}) {
  const doc = await Alarm.create({ userId, label: "Flight", scheduledTime: T, verificationRequired: true, minConfidence: 85, ...fields });
  return Alarm.findById(doc._id).lean<AlarmDocument & { _id: unknown }>() as Promise<AlarmDocument & { _id: unknown }>;
}

async function withContact(userId: string) {
  signInAs(userId);
  const r = await read(await putSettings(request("PUT", "/x", { emergencyContact: { name: "Mum", phone: "+919876543210", consent: true } })));
  expect(r.status).toBe(200);
}

async function pairUp(a: string, b: string) {
  signInAs(a);
  const code = (await read(await invite())).body.data.code;
  signInAs(b);
  const id = (await read(await ask(request("POST", "/x", { code })))).body.data.requestId;
  signInAs(a);
  await respond(request("PATCH", "/x", { accept: true }), idParams(id));
}

describe("the second device: rings now", () => {
  it("every other device of the user gets a ring; the asking one doesn't; delivered with Firebase's id", async () => {
    const me = await makeUser();
    await PushToken.create({ userId: me, token: tok("phone"), updatedAt: new Date() });
    await PushToken.create({ userId: me, token: tok("tablet"), updatedAt: new Date() });
    const a = await alarm(me);
    const p = push();
    const r = await requestBackups(me, a, ["secondaryAlarm"], tok("phone"), p, off, at(1));
    expect(p.send).toHaveBeenCalledTimes(1);
    expect(p.send.mock.calls[0][0]).toBe(tok("tablet"));
    expect(p.send.mock.calls[0][1]).toEqual({ type: "backup_ring", alarmId: String(a._id), label: "Flight" });
    expect(r.outcomes).toEqual([expect.objectContaining({
      kind: "secondaryAlarm", status: "delivered", receipt: expect.objectContaining({ transport: "fcm", messageId: "projects/p/messages/1" }),
    })]);
  });

  it("not configured with no other device, or no push on the server", async () => {
    const me = await makeUser();
    await PushToken.create({ userId: me, token: tok("phone"), updatedAt: new Date() });
    const a = await alarm(me);
    const r = await requestBackups(me, a, ["secondaryAlarm"], tok("phone"), push(), off, at(1));
    expect(r.outcomes[0]).toMatchObject({ status: "not_configured", reason: "No other device of yours has SomniAI open and signed in" });
    await PushToken.create({ userId: me, token: tok("tablet"), updatedAt: new Date() });
    const r2 = await requestBackups(me, a, ["secondaryAlarm"], tok("phone"), { configured: false, send: vi.fn() }, off, at(1));
    expect(r2.outcomes[0]).toMatchObject({ status: "not_configured", reason: "Push isn't set up on this server" });
  });

  it("failed when Firebase refuses, or accepts without an id; a gone token is forgotten", async () => {
    const me = await makeUser();
    await PushToken.create({ userId: me, token: tok("tablet"), updatedAt: new Date() });
    const a = await alarm(me);
    let r = await requestBackups(me, a, ["secondaryAlarm"], undefined, push({ ok: false, error: "503 UNAVAILABLE" }), off, at(1));
    expect(r.outcomes[0]).toMatchObject({ status: "failed", reason: "503 UNAVAILABLE" });
    r = await requestBackups(me, a, ["secondaryAlarm"], undefined, push({ ok: true }), off, at(1));
    expect(r.outcomes[0].status).toBe("failed");
    r = await requestBackups(me, a, ["secondaryAlarm"], undefined, push({ ok: false, unregistered: true, error: "404 UNREGISTERED" }), off, at(1));
    expect(r.outcomes[0].status).toBe("failed");
    expect(await PushToken.countDocuments({ userId: me })).toBe(0);
  });

  it("is stopped on the other devices once the alarm is stopped", async () => {
    const me = await makeUser();
    await PushToken.create({ userId: me, token: tok("phone"), updatedAt: new Date() });
    await PushToken.create({ userId: me, token: tok("tablet"), updatedAt: new Date() });
    const p = push();
    expect(await stopBackups(me, "a1", tok("phone"), p)).toEqual({ sent: 1, failed: 0 });
    expect(p.send.mock.calls[0]).toEqual([tok("tablet"), { type: "backup_stop", alarmId: "a1" }]);
    expect(await stopBackups(me, "a1", tok("phone"), { configured: false, send: vi.fn() })).toEqual({ sent: 0, failed: 0 });
  });
});

describe("the smartwatch", () => {
  it("is never configured: there is no watch app", async () => {
    const me = await makeUser();
    const r = await requestBackups(me, await alarm(me), ["smartwatch"], undefined, push(), sms(), at(1));
    expect(r.outcomes).toEqual([expect.objectContaining({ kind: "smartwatch", status: "not_configured", reason: WATCH_REASON })]);
  });
});

describe("people at the backup level: told only after the delay", () => {
  it("a critical alarm: buddy and contact are 'later', at the alarm time plus the delay", async () => {
    const me = await makeUser({ name: "Sam" });
    const buddy = await makeUser({ name: "Bo" });
    await pairUp(me, buddy);
    await withContact(me);
    const r = await requestBackups(me, await alarm(me), ["secondaryAlarm", "emergencyContact"], undefined, push(), sms(), at(1));
    expect(r.later).toEqual([
      { who: "buddy", name: "Bo", at: at(15).toISOString() },
      { who: "emergencyContact", name: "Mum", at: at(15).toISOString() },
    ]);
    // Not yet sent, so not reported as an outcome either way.
    expect(r.outcomes.map((o) => o.kind)).toEqual(["secondaryAlarm"]);
  });

  it("delivered, with Twilio's id, once the server's check has texted them", async () => {
    const me = await makeUser({ name: "Sam" });
    await withContact(me);
    const a = await alarm(me);
    const s = sms();
    await runBuddyAlerts(off as unknown as PushSender, at(15), s);
    const r = await requestBackups(me, a, ["emergencyContact"], undefined, push(), s, at(16));
    expect(r.outcomes[0]).toMatchObject({ status: "delivered", receipt: { transport: "twilio", messageId: "SM123" } });
    expect(r.later).toEqual([]);
  });

  it("not configured: no contact, an ordinary alarm, or no SMS on the server", async () => {
    const me = await makeUser();
    let r = await requestBackups(me, await alarm(me), ["emergencyContact"], undefined, push(), sms(), at(1));
    expect(r.outcomes[0]).toMatchObject({ status: "not_configured", reason: "No emergency contact is set" });
    await withContact(me);
    r = await requestBackups(me, await alarm(me, { minConfidence: 70 }), ["emergencyContact"], undefined, push(), sms(), at(1));
    expect(r.outcomes[0]).toMatchObject({ status: "not_configured" });
    expect(r.outcomes[0].status === "not_configured" && r.outcomes[0].reason).toContain("only about critical alarms");
    r = await requestBackups(me, await alarm(me), ["emergencyContact"], undefined, push(), { configured: false, send: vi.fn() }, at(1));
    expect(r.outcomes[0]).toMatchObject({ status: "not_configured", reason: "SMS isn't set up on this server" });
  });
});

describe("the emergency contact in the server's check", () => {
  it("texted once, after the delay, for a critical alarm not answered", async () => {
    const me = await makeUser({ name: "Sam" });
    await withContact(me);
    const a = await alarm(me);
    const s = sms();
    await runBuddyAlerts(off as unknown as PushSender, at(14), s);
    expect(s.send).not.toHaveBeenCalled();
    const run = await runBuddyAlerts(off as unknown as PushSender, at(15), s);
    expect(run.contacts).toBe(1);
    expect(s.send).toHaveBeenCalledWith("+919876543210", contactText("Sam", "Flight", 15));
    await runBuddyAlerts(off as unknown as PushSender, at(20), s);
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(await BuddyAlert.findOne({ channel: "emergencyContact" }).lean()).toMatchObject({ status: "sent", messageId: "SM123", alarmId: String(a._id) });
  });

  it("never once answered, never for an ordinary alarm unless opted in", async () => {
    const me = await makeUser();
    await withContact(me);
    const answered = await alarm(me);
    await BehaviorEvent.create({ userId: me, type: "verify_pass", meta: { alarmId: String(answered._id) }, at: at(2) });
    await alarm(me, { label: "Gym", minConfidence: 70 });
    const s = sms();
    await runBuddyAlerts(off as unknown as PushSender, at(20), s);
    expect(s.send).not.toHaveBeenCalled();
  });

  it("buddy and contact each get theirs: one doesn't use up the other's limit", async () => {
    const me = await makeUser({ name: "Sam" });
    const buddy = await makeUser();
    await pairUp(me, buddy);
    await PushToken.create({ userId: buddy, token: tok("buddy"), updatedAt: new Date() });
    await withContact(me);
    await alarm(me);
    const p = push();
    const s = sms();
    const run = await runBuddyAlerts(p, at(15), s);
    expect(run.sent).toBe(2);
    expect(p.send).toHaveBeenCalledTimes(1);
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("a contact without the user's confirmation that they agreed is never texted", async () => {
    const me = await makeUser({ preferences: { emergencyContact: { name: "Mum", channel: "sms", value: "+919876543210" } } });
    await alarm(me);
    const s = sms();
    expect((await runBuddyAlerts(off as unknown as PushSender, at(20), s)).contacts).toBe(0);
    expect(s.send).not.toHaveBeenCalled();
  });

  it("an SMS failure is retried, three tries; no SMS on the server is recorded once", async () => {
    const me = await makeUser();
    await withContact(me);
    await alarm(me);
    const failing = sms({ ok: false, error: "Twilio 400 21608: unverified" });
    for (const m of [15, 16, 17, 18]) {
      await runBuddyAlerts(off as unknown as PushSender, at(m), failing);
    }
    expect(failing.send).toHaveBeenCalledTimes(3);
    await alarm(me, { label: "Exam", scheduledTime: at(120) });
    await runBuddyAlerts(off as unknown as PushSender, at(135), { configured: false, send: vi.fn() });
    await runBuddyAlerts(off as unknown as PushSender, at(136), { configured: false, send: vi.fn() });
    expect(await BuddyAlert.countDocuments({ channel: "emergencyContact", status: "not_configured" })).toBe(1);
  });
});

describe("the routes", () => {
  it("backups: checks who and what, and answers for each kind asked", async () => {
    const me = await makeUser();
    const other = await makeUser();
    const a = await alarm(me);
    const id = String(a._id);
    signInAs(null);
    expect((await backups(request("POST", "/x", { kinds: ["smartwatch"] }), idParams(id))).status).toBe(401);
    expect((await stop(request("POST", "/x", {}), idParams(id))).status).toBe(401);
    signInAs(me);
    expect((await backups(request("POST", "/x", { kinds: ["smartwatch"] }), idParams("nope"))).status).toBe(400);
    expect((await stop(request("POST", "/x", {}), idParams("nope"))).status).toBe(400);
    for (const bad of [{}, { kinds: [] }, { kinds: ["pager"] }, { kinds: ["smartwatch", "smartwatch"] }, { kinds: "smartwatch" },
      { kinds: ["smartwatch"], fromToken: 42 }]) {
      expect((await backups(request("POST", "/x", bad), idParams(id))).status).toBe(422);
    }
    expect((await stop(request("POST", "/x", { fromToken: 42 }), idParams(id))).status).toBe(422);
    expect((await backups(request("POST", "/x", { kinds: ["smartwatch"] }), idParams(MISSING_ID))).status).toBe(404);
    signInAs(other);
    expect((await backups(request("POST", "/x", { kinds: ["smartwatch"] }), idParams(id))).status).toBe(404);
    expect((await stop(request("POST", "/x", {}), idParams(id))).status).toBe(404);

    signInAs(me);
    const r = await read(await backups(request("POST", "/x", { kinds: ["secondaryAlarm", "smartwatch", "emergencyContact"] }), idParams(id)));
    expect(r.status).toBe(200);
    expect(r.body.data.outcomes.map((o: { kind: string; status: string }) => `${o.kind}:${o.status}`))
      .toEqual(["secondaryAlarm:not_configured", "smartwatch:not_configured", "emergencyContact:not_configured"]);
    // No Firebase in tests: the stop sends nothing, and says so.
    expect((await read(await stop(request("POST", "/x", {}), idParams(id)))).body.data).toEqual({ sent: 0, failed: 0 });
  });

  it("settings: the emergency contact needs a name, an international number and their agreement", async () => {
    const me = await makeUser();
    signInAs(me);
    for (const bad of [
      { name: "", phone: "+919876543210", consent: true },
      { name: "Mum", phone: "09876543210", consent: true },
      { name: "Mum", phone: "+919876543210" },
      { name: "Mum", phone: "+919876543210", consent: "yes" },
    ]) {
      expect((await putSettings(request("PUT", "/x", { emergencyContact: bad }))).status).toBe(422);
    }
    const r = await read(await putSettings(request("PUT", "/x", { emergencyContact: { name: " Mum ", phone: "+91 98765-43210", consent: true } })));
    expect(r.body.data.emergencyContact).toEqual({ name: "Mum", phone: "+919876543210" });
    const s = (await read(await status())).body.data;
    expect(s.emergencyContact).toEqual({ name: "Mum", phone: "+919876543210" });
    expect(s.channels).toEqual({ push: false, sms: false });
    await putSettings(request("PUT", "/x", { emergencyContact: null }));
    expect((await read(await status())).body.data.emergencyContact).toBeNull();
  });
});
