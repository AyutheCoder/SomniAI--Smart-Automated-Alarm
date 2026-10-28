import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as status, DELETE as unpair } from "@/app/api/buddy/route";
import { POST as invite, DELETE as withdrawInvite } from "@/app/api/buddy/invite/route";
import { POST as ask } from "@/app/api/buddy/requests/route";
import { PATCH as respond, DELETE as cancelRequest } from "@/app/api/buddy/requests/[id]/route";
import { PUT as putSettings } from "@/app/api/buddy/settings/route";
import { POST as addToken, DELETE as removeToken } from "@/app/api/push/token/route";
import { GET as cronGet, POST as cronPost } from "@/app/api/cron/buddy-alerts/route";
import { runBuddyAlerts } from "@/lib/buddyAlerts";
import type { PushSender } from "@/lib/push";
import { Alarm } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { BuddyAlert, BuddyInvite, BuddyPair, PushToken } from "@/models/Buddy";
import { MISSING_ID, idParams, makeUser, read, request, signInAs } from "./helpers";

const TOKEN = "fcm-token-" + "x".repeat(40);

async function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  signInAs(userId);
  return fn();
}

/** The full consent flow: alice shares a code, bob asks, alice accepts. */
async function pair(alice: string, bob: string) {
  const code = (await read(await as(alice, () => invite()))).body.data.code;
  const asked = await read(await as(bob, () => ask(request("POST", "/api/buddy/requests", { code }))));
  const requestId = asked.body.data.requestId;
  const accepted = await read(await as(alice, () => respond(request("PATCH", "/x", { accept: true }), idParams(requestId))));
  expect(accepted.body.data.status).toBe("active");
  return requestId;
}

async function people() {
  return { alice: await makeUser({ name: "Alice" }), bob: await makeUser({ name: "Bob" }), carol: await makeUser({ name: "Carol" }) };
}

describe("pairing needs both people's consent", () => {
  it("a code, a request, an acceptance: only then are they buddies", async () => {
    const { alice, bob } = await people();
    const code = (await read(await as(alice, () => invite()))).body.data.code;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const asked = await read(await as(bob, () => ask(request("POST", "/api/buddy/requests", { code: code.toLowerCase() }))));
    expect(asked.status).toBe(201);
    expect(asked.body.data).toMatchObject({ name: "Alice", status: "requested" });

    // Asked, not paired: neither has a buddy yet, and alice sees the request.
    expect((await read(await as(bob, () => status()))).body.data.buddy).toBeNull();
    const aliceView = (await read(await as(alice, () => status()))).body.data;
    expect(aliceView.buddy).toBeNull();
    expect(aliceView.incoming).toEqual([expect.objectContaining({ name: "Bob" })]);
    expect((await read(await as(bob, () => status()))).body.data.outgoing).toEqual([expect.objectContaining({ name: "Alice" })]);

    await as(alice, () => respond(request("PATCH", "/x", { accept: true }), idParams(asked.body.data.requestId)));
    expect((await read(await as(alice, () => status()))).body.data.buddy).toMatchObject({ name: "Bob" });
    expect((await read(await as(bob, () => status()))).body.data.buddy).toMatchObject({ name: "Alice" });
    // The code is used up.
    expect(await BuddyInvite.countDocuments({ userId: alice })).toBe(0);
  });

  it("only the person who shared the code can accept", async () => {
    const { alice, bob, carol } = await people();
    const code = (await read(await as(alice, () => invite()))).body.data.code;
    const id = (await read(await as(bob, () => ask(request("POST", "/x", { code }))))).body.data.requestId;
    for (const who of [bob, carol]) {
      const r = await read(await as(who, () => respond(request("PATCH", "/x", { accept: true }), idParams(id))));
      expect(r.status).toBe(404);
    }
    expect(await BuddyPair.countDocuments({ status: "active" })).toBe(0);
  });

  it("declining, or the asker withdrawing, leaves nobody paired", async () => {
    const { alice, bob } = await people();
    const code = (await read(await as(alice, () => invite()))).body.data.code;
    const first = (await read(await as(bob, () => ask(request("POST", "/x", { code }))))).body.data.requestId;
    expect((await read(await as(alice, () => respond(request("PATCH", "/x", { accept: false }), idParams(first))))).body.data.status).toBe("declined");
    const second = (await read(await as(bob, () => ask(request("POST", "/x", { code }))))).body.data.requestId;
    expect((await read(await as(bob, () => cancelRequest(request("DELETE", "/x"), idParams(second))))).body.data.status).toBe("declined");
    // A withdrawn request can't then be accepted.
    expect((await as(alice, () => respond(request("PATCH", "/x", { accept: true }), idParams(second)))).status).toBe(404);
    expect(await BuddyPair.countDocuments({ status: "active" })).toBe(0);
  });

  it("refuses your own code, a wrong or expired code, and asking twice", async () => {
    const { alice, bob } = await people();
    const code = (await read(await as(alice, () => invite()))).body.data.code;
    expect((await as(alice, () => ask(request("POST", "/x", { code })))).status).toBe(422);
    expect((await as(bob, () => ask(request("POST", "/x", { code: "not a code" })))).status).toBe(422);
    expect((await as(bob, () => ask(request("POST", "/x", { code: "ABCD-EFGH" })))).status).toBe(404);
    expect((await as(bob, () => ask(request("POST", "/x", { code })))).status).toBe(201);
    expect((await as(bob, () => ask(request("POST", "/x", { code })))).status).toBe(409);

    await BuddyInvite.updateOne({ userId: alice }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const carol = await makeUser();
    expect((await as(carol, () => ask(request("POST", "/x", { code })))).status).toBe(404);
  });

  it("a new code replaces the old, and a withdrawn one stops working", async () => {
    const { alice, bob } = await people();
    const old = (await read(await as(alice, () => invite()))).body.data.code;
    const fresh = (await read(await as(alice, () => invite()))).body.data.code;
    expect(fresh).not.toBe(old);
    expect((await as(bob, () => ask(request("POST", "/x", { code: old })))).status).toBe(404);
    expect((await read(await as(alice, () => withdrawInvite()))).body.data.withdrawn).toBe(true);
    expect((await as(bob, () => ask(request("POST", "/x", { code: fresh })))).status).toBe(404);
  });

  it("one buddy at a time, on both sides", async () => {
    const { alice, bob, carol } = await people();
    await pair(alice, bob);
    expect((await as(alice, () => invite())).status).toBe(409);
    const carolCode = (await read(await as(carol, () => invite()))).body.data.code;
    expect((await as(bob, () => ask(request("POST", "/x", { code: carolCode })))).status).toBe(409);
  });

  it("accepting one request declines the others involving either of them", async () => {
    const { alice, bob, carol } = await people();
    const code = (await read(await as(alice, () => invite()))).body.data.code;
    const fromBob = (await read(await as(bob, () => ask(request("POST", "/x", { code }))))).body.data.requestId;
    const fromCarol = (await read(await as(carol, () => ask(request("POST", "/x", { code }))))).body.data.requestId;
    await as(alice, () => respond(request("PATCH", "/x", { accept: true }), idParams(fromBob)));
    expect((await BuddyPair.findById(fromCarol).lean<{ status: string }>())?.status).toBe("declined");
    expect((await as(alice, () => respond(request("PATCH", "/x", { accept: true }), idParams(fromCarol)))).status).toBe(404);
  });

  it("checks its input and who is asking", async () => {
    const { alice } = await people();
    signInAs(null);
    for (const res of [await status(), await invite(), await ask(request("POST", "/x", { code: "ABCD-EFGH" })), await unpair(),
      await respond(request("PATCH", "/x", { accept: true }), idParams(MISSING_ID)), await withdrawInvite(),
      await cancelRequest(request("DELETE", "/x"), idParams(MISSING_ID)), await putSettings(request("PUT", "/x", {})),
      await addToken(request("POST", "/x", { token: TOKEN })), await removeToken(request("DELETE", "/x", { token: TOKEN }))]) {
      expect(res.status).toBe(401);
    }
    signInAs(alice);
    expect((await respond(request("PATCH", "/x", { accept: "yes" }), idParams(MISSING_ID))).status).toBe(422);
    expect((await respond(request("PATCH", "/x", { accept: true }), idParams("nope"))).status).toBe(400);
    expect((await cancelRequest(request("DELETE", "/x"), idParams("nope"))).status).toBe(400);
    expect((await cancelRequest(request("DELETE", "/x"), idParams(MISSING_ID))).status).toBe(404);
  });
});

describe("unpairing", () => {
  it("either side can, at any time, and the other sees it at once", async () => {
    for (const leaver of ["alice", "bob"] as const) {
      const p = await people();
      await pair(p.alice, p.bob);
      const res = await read(await as(p[leaver], () => unpair()));
      expect(res.body.data).toEqual({ unpaired: true });
      expect((await read(await as(p.alice, () => status()))).body.data.buddy).toBeNull();
      expect((await read(await as(p.bob, () => status()))).body.data.buddy).toBeNull();
      expect(await BuddyPair.findOne({ status: "ended" }).lean()).toMatchObject({ closedBy: p[leaver] });
      await BuddyPair.deleteMany({});
    }
  });

  it("with no buddy there is nothing to unpair", async () => {
    const { alice } = await people();
    expect((await as(alice, () => unpair())).status).toBe(404);
  });

  it("after unpairing they can pair again only with both consenting again", async () => {
    const { alice, bob } = await people();
    await pair(alice, bob);
    await as(bob, () => unpair());
    await pair(alice, bob);
    expect(await BuddyPair.countDocuments({ status: "active" })).toBe(1);
  });
});

describe("settings", () => {
  it("default: 15 minutes, critical alarms only, no number shared", async () => {
    const { alice } = await people();
    expect((await read(await as(alice, () => status()))).body.data.settings).toEqual({
      alertAfterMinutes: 15, ordinaryAlarms: false, phone: null, sharePhone: false,
    });
  });

  it("change only what is given, and validate it", async () => {
    const { alice } = await people();
    signInAs(alice);
    let r = await read(await putSettings(request("PUT", "/x", { alertAfterMinutes: 30 })));
    expect(r.body.data.alertAfterMinutes).toBe(30);
    r = await read(await putSettings(request("PUT", "/x", { phone: "+44 7700 900-123", sharePhone: true })));
    expect(r.body.data).toEqual({ alertAfterMinutes: 30, ordinaryAlarms: false, phone: "+447700900123", sharePhone: true });
    r = await read(await putSettings(request("PUT", "/x", { phone: null })));
    expect(r.body.data).toMatchObject({ phone: null, sharePhone: false });
    for (const bad of [{ alertAfterMinutes: 4 }, { alertAfterMinutes: 61 }, { alertAfterMinutes: 10.5 }, { ordinaryAlarms: "yes" },
      { phone: "call me" }, { sharePhone: true }, "not json"]) {
      expect((await putSettings(request("PUT", "/x", bad))).status).toBe(422);
    }
  });
});

describe("push tokens", () => {
  it("register, move to whoever signs in on that phone, and remove", async () => {
    const { alice, bob } = await people();
    expect((await read(await as(alice, () => addToken(request("POST", "/x", { token: TOKEN }))))).body.data.registered).toBe(true);
    expect((await read(await as(alice, () => status()))).body.data.hasDevice).toBe(true);
    await as(bob, () => addToken(request("POST", "/x", { token: TOKEN })));
    expect(await PushToken.countDocuments({ token: TOKEN, userId: bob })).toBe(1);
    expect((await read(await as(alice, () => removeToken(request("DELETE", "/x", { token: TOKEN }))))).body.data.removed).toBe(false);
    expect((await read(await as(bob, () => removeToken(request("DELETE", "/x", { token: TOKEN }))))).body.data.removed).toBe(true);
    for (const bad of [{}, { token: "short" }, { token: "has spaces in it, which tokens don't have" }]) {
      expect((await as(bob, () => addToken(request("POST", "/x", bad)))).status).toBe(422);
      expect((await as(bob, () => removeToken(request("DELETE", "/x", bad)))).status).toBe(422);
    }
  });
});

// --- the alert itself ---

const T = new Date("2026-10-28T07:00:00.000Z");
const at = (minutes: number) => new Date(T.getTime() + minutes * 60_000);

function sender(result: { ok: boolean; unregistered?: boolean; error?: string } = { ok: true }) {
  const send = vi.fn<PushSender["send"]>(async () => result);
  return { configured: true, send } satisfies PushSender;
}

/** Critical by its own settings: a check required at confidence 80 or more (lib/ringPlan.ts). */
async function alarm(userId: string, fields: Record<string, unknown> = {}) {
  const doc = await Alarm.create({ userId, label: "Flight", scheduledTime: T, verificationRequired: true, minConfidence: 85, ...fields });
  return String(doc._id);
}

async function paired() {
  const p = await people();
  await pair(p.alice, p.bob);
  await PushToken.create({ userId: p.bob, token: TOKEN, updatedAt: new Date() });
  return p;
}

describe("the alert: trigger timing", () => {
  it("nothing before the set minutes, then one push to the buddy, then no more for that ring", async () => {
    const { alice } = await paired();
    await alarm(alice);
    const s = sender();
    expect((await runBuddyAlerts(s, at(14))).sent).toBe(0);
    expect(s.send).not.toHaveBeenCalled();

    const run = await runBuddyAlerts(s, at(15));
    expect(run.sent).toBe(1);
    expect(s.send).toHaveBeenCalledTimes(1);
    const [token, data] = s.send.mock.calls[0];
    expect(token).toBe(TOKEN);
    expect(data).toMatchObject({
      type: "buddy_alert", name: "Alice", label: "Flight", minutes: "15", alarmAt: T.toISOString(),
      title: "Alice hasn't confirmed they're awake",
    });
    expect(data.phone).toBeUndefined();

    await runBuddyAlerts(s, at(16));
    await runBuddyAlerts(s, at(60));
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(await BuddyAlert.countDocuments({ status: "sent" })).toBe(1);
  });

  it("follows the sleeper's own delay", async () => {
    const { alice } = await paired();
    signInAs(alice);
    await putSettings(request("PUT", "/x", { alertAfterMinutes: 30 }));
    await alarm(alice);
    const s = sender();
    await runBuddyAlerts(s, at(29));
    expect(s.send).not.toHaveBeenCalled();
    await runBuddyAlerts(s, at(30));
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("never if they verified, or stopped the alarm, since it rang", async () => {
    for (const type of ["verify_pass", "dismiss"]) {
      const { alice } = await paired();
      const id = await alarm(alice);
      await BehaviorEvent.create({ userId: alice, type, meta: { alarmId: id }, at: at(3) });
      const s = sender();
      const run = await runBuddyAlerts(s, at(20));
      expect(s.send).not.toHaveBeenCalled();
      expect(run.skipped.awake).toBe(1);
      await Promise.all([BuddyPair.deleteMany({}), Alarm.deleteMany({}), BehaviorEvent.deleteMany({}), PushToken.deleteMany({})]);
    }
  });

  it("a failed verification doesn't count as awake", async () => {
    const { alice } = await paired();
    const id = await alarm(alice);
    await BehaviorEvent.create({ userId: alice, type: "verify_fail", meta: { alarmId: id }, at: at(3) });
    const s = sender();
    await runBuddyAlerts(s, at(20));
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("never for an ordinary alarm, unless the sleeper opted in", async () => {
    const { alice } = await paired();
    await alarm(alice, { verificationRequired: true, minConfidence: 70 });
    const s = sender();
    expect((await runBuddyAlerts(s, at(20))).skipped.ordinary).toBe(1);
    expect(s.send).not.toHaveBeenCalled();
    signInAs(alice);
    await putSettings(request("PUT", "/x", { ordinaryAlarms: true }));
    await runBuddyAlerts(s, at(21));
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("a ring plan marked critical counts, whatever the alarm's other settings", async () => {
    const { alice } = await paired();
    const plan = (await import("@/lib/ringPlan")).resolveRingPlan({
      verificationRequired: true, minConfidence: 60, intensity: 60, wakeStrategy: "adaptive", verificationMethod: "math",
    } as Parameters<typeof import("@/lib/ringPlan").resolveRingPlan>[0]);
    await alarm(alice, { minConfidence: 60, ringPlan: { ...plan, critical: true } });
    const s = sender();
    await runBuddyAlerts(s, at(16));
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("a snoozed ring is timed from when it was first due", async () => {
    const { alice } = await paired();
    await alarm(alice, { scheduledTime: at(10), snoozedFrom: T, status: "snoozed" });
    const s = sender();
    await runBuddyAlerts(s, at(15));
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("works both ways, and stops when they unpair", async () => {
    const { alice, bob } = await paired();
    await PushToken.create({ userId: alice, token: TOKEN + "-alice", updatedAt: new Date() });
    await alarm(bob);
    const s = sender();
    await runBuddyAlerts(s, at(15));
    expect(s.send.mock.calls[0][0]).toBe(TOKEN + "-alice");
    expect(s.send.mock.calls[0][1].name).toBe("Bob");

    await alarm(alice, { scheduledTime: at(60) });
    await as(alice, () => unpair());
    await runBuddyAlerts(s, at(80));
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("no alert without a buddy, or for an alarm turned off or already answered", async () => {
    const { alice } = await people();
    await alarm(alice);
    const s = sender();
    expect((await runBuddyAlerts(s, at(20))).pairs).toBe(0);
    const p = await paired();
    await alarm(p.alice, { enabled: false });
    await alarm(p.alice, { status: "verified" });
    await runBuddyAlerts(s, at(20));
    expect(s.send).not.toHaveBeenCalled();
  });

  it("includes the number only if the sleeper chose to share it", async () => {
    const { alice } = await paired();
    signInAs(alice);
    await putSettings(request("PUT", "/x", { phone: "+447700900123" }));
    await alarm(alice);
    const s = sender();
    await runBuddyAlerts(s, at(15));
    expect(s.send.mock.calls[0][1].phone).toBeUndefined();

    await putSettings(request("PUT", "/x", { sharePhone: true }));
    await alarm(alice, { scheduledTime: at(60) });
    await runBuddyAlerts(s, at(75));
    expect(s.send.mock.calls[1][1].phone).toBe("+447700900123");
  });
});

describe("the alert: rate limit and delivery", () => {
  it("no second alert within 30 minutes, even for another alarm", async () => {
    const { alice } = await paired();
    await alarm(alice);
    await alarm(alice, { label: "Exam", scheduledTime: at(10) });
    const s = sender();
    await runBuddyAlerts(s, at(15));
    const run = await runBuddyAlerts(s, at(25));
    expect(run.skipped.too_soon).toBe(1);
    expect(s.send).toHaveBeenCalledTimes(1);
    await runBuddyAlerts(s, at(45));
    expect(s.send).toHaveBeenCalledTimes(2);
  });

  it("at most three a day", async () => {
    const { alice } = await paired();
    for (let i = 0; i < 4; i++) {
      await alarm(alice, { label: `A${i}`, scheduledTime: at(i * 40) });
    }
    const s = sender();
    for (let i = 0; i < 4; i++) {
      await runBuddyAlerts(s, at(i * 40 + 15));
    }
    expect(s.send).toHaveBeenCalledTimes(3);
    expect(await BuddyAlert.countDocuments({ status: "sent" })).toBe(3);
  });

  it("a push-service failure is retried on the next runs, three tries in all", async () => {
    const { alice } = await paired();
    await alarm(alice);
    const failing = sender({ ok: false, error: "503 UNAVAILABLE" });
    for (const m of [15, 16, 17, 18, 19]) {
      await runBuddyAlerts(failing, at(m));
    }
    expect(failing.send).toHaveBeenCalledTimes(3);
    expect(await BuddyAlert.countDocuments({ status: "failed" })).toBe(3);
  });

  it("a token the push service says is gone is forgotten", async () => {
    const { bob, alice } = await paired();
    await alarm(alice);
    await runBuddyAlerts(sender({ ok: false, unregistered: true, error: "404 UNREGISTERED" }), at(15));
    expect(await PushToken.countDocuments({ userId: bob })).toBe(0);
  });

  it("says so, once, when the buddy has no phone set up or push isn't configured", async () => {
    const { alice, bob } = await paired();
    await PushToken.deleteMany({ userId: bob });
    await alarm(alice);
    const s = sender();
    await runBuddyAlerts(s, at(15));
    await runBuddyAlerts(s, at(16));
    expect(s.send).not.toHaveBeenCalled();
    expect(await BuddyAlert.find().lean()).toEqual([expect.objectContaining({ status: "no_device" })]);

    await PushToken.create({ userId: bob, token: TOKEN, updatedAt: new Date() });
    await alarm(alice, { scheduledTime: at(120) });
    const off: PushSender = { configured: false, send: vi.fn() };
    await runBuddyAlerts(off, at(135));
    expect(off.send).not.toHaveBeenCalled();
    expect(await BuddyAlert.countDocuments({ status: "not_configured" })).toBe(1);
    // The sleeper can see what happened.
    const mine = (await read(await as(alice, () => status()))).body.data.alerts;
    expect(mine.map((a: { status: string }) => a.status)).toEqual(["not_configured", "no_device"]);
  });
});

describe("the scheduler's route", () => {
  const SECRET = "test-cron-secret-0123456789";
  const call = (handler: typeof cronGet, auth?: string) =>
    handler(new NextRequest("http://localhost/api/cron/buddy-alerts", { headers: auth ? { authorization: auth } : {} }));

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses everything when no secret is set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call(cronGet, `Bearer ${SECRET}`)).status).toBe(503);
  });

  it("refuses a missing or wrong secret", async () => {
    for (const auth of [undefined, "Bearer wrong", `Bearer ${SECRET}x`, SECRET]) {
      expect((await call(cronGet, auth)).status).toBe(401);
      expect((await call(cronPost, auth)).status).toBe(401);
    }
  });

  it("runs the check with the right one, by GET or POST", async () => {
    const { alice } = await paired();
    await alarm(alice, { scheduledTime: new Date(Date.now() - 20 * 60_000) });
    const r = await read(await call(cronGet, `Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    // No Firebase credentials in tests: recorded honestly as not configured.
    expect(r.body.data).toMatchObject({ pairs: 1, sent: 0, attempts: [expect.objectContaining({ status: "not_configured" })] });
    expect((await call(cronPost, `Bearer ${SECRET}`)).status).toBe(200);
  });
});
