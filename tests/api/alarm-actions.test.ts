import { beforeEach, describe, expect, it } from "vitest";
import { POST as fire } from "@/app/api/alarms/[id]/fire/route";
import { POST as snooze } from "@/app/api/alarms/[id]/snooze/route";
import { POST as escalate } from "@/app/api/alarms/[id]/escalate/route";
import { POST as verify } from "@/app/api/alarms/[id]/verify/route";
import { POST as dismiss } from "@/app/api/alarms/[id]/dismiss/route";
import { POST as lifecycle } from "@/app/api/alarms/lifecycle/route";
import { PATCH as patch } from "@/app/api/alarms/[id]/route";
import { Alarm } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { idParams, read, request, signInAs, twoUsers } from "./helpers";

type Handler = (req: ReturnType<typeof request>, ctx: ReturnType<typeof idParams>) => Promise<Response>;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

async function alarmFor(userId: string, fields: Record<string, unknown> = {}) {
  const doc = await Alarm.create({
    userId,
    label: "Wake",
    scheduledTime: new Date(Date.now() + HOUR),
    ...fields,
  });
  return String(doc._id);
}

const statusOf = async (id: string) => (await Alarm.findById(id).lean<{ status: string }>())?.status;

let alice: string;
let bob: string;
beforeEach(async () => {
  ({ alice, bob } = await twoUsers());
});

/** The checks every alarm action shares: auth, id format, and ownership. */
describe.each<[string, Handler, Record<string, unknown>]>([
  ["fire", fire, {}],
  ["snooze", snooze, { snoozeMinutes: 5 }],
  ["escalate", escalate, { level: 3 }],
  ["verify", verify, { solved: true, responseMs: 8000 }],
  ["dismiss", dismiss, {}],
])("POST /api/alarms/[id]/%s", (action, handler, body) => {
  it("rejects an unauthenticated request without side effects", async () => {
    const id = await alarmFor(alice);
    const res = await handler(request("POST", `/api/alarms/${id}/${action}`, body), idParams(id));
    expect(res.status).toBe(401);
    expect(await statusOf(id)).toBe("scheduled");
    expect(await BehaviorEvent.countDocuments()).toBe(0);
  });

  it("rejects a malformed id", async () => {
    signInAs(alice);
    const res = await read(await handler(request("POST", "/api/alarms/1/x", body), idParams("1")));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid id");
  });

  it("cannot act on another user's alarm, and records nothing", async () => {
    const id = await alarmFor(bob);
    signInAs(alice);
    const res = await handler(request("POST", `/api/alarms/${id}/${action}`, body), idParams(id));
    expect(res.status).toBe(404);
    expect(await Alarm.findById(id).lean()).toMatchObject({ status: "scheduled", lastSnoozeCount: 0, enabled: true });
    expect(await BehaviorEvent.countDocuments()).toBe(0);
  });
});

describe("POST /api/alarms/[id]/fire", () => {
  it("marks the alarm ringing and records the fire", async () => {
    const id = await alarmFor(alice);
    signInAs(alice);
    const res = await read(await fire(request("POST", `/api/alarms/${id}/fire`), idParams(id)));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ringing");
    expect(await BehaviorEvent.findOne({ userId: alice, type: "alarm_fire" }).lean()).toMatchObject({ meta: { alarmId: id } });
  });
});

describe("POST /api/alarms/[id]/snooze", () => {
  it.each([
    ["a non-number", "ten"],
    ["zero", 0],
    ["over an hour", 61],
    ["a fraction", 2.5],
  ])("rejects snoozeMinutes as %s", async (_what, snoozeMinutes) => {
    const id = await alarmFor(alice);
    signInAs(alice);
    const res = await read(await snooze(request("POST", `/api/alarms/${id}/snooze`, { snoozeMinutes }), idParams(id)));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/snoozeMinutes must be a whole number from 1 to 60/);
    expect(await Alarm.findById(id).lean()).toMatchObject({ lastSnoozeCount: 0 });
  });

  it("pushes the alarm out by the requested minutes and counts the snooze", async () => {
    const id = await alarmFor(alice, { status: "ringing" });
    signInAs(alice);
    const before = Date.now();
    const res = await read(await snooze(request("POST", `/api/alarms/${id}/snooze`, { snoozeMinutes: 9, responseMs: 4000 }), idParams(id)));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "scheduled", lastSnoozeCount: 1 });
    const next = new Date(res.body.data.scheduledTime).getTime();
    expect(next - before).toBeGreaterThanOrEqual(9 * 60_000 - 1000);
    expect(next - before).toBeLessThanOrEqual(9 * 60_000 + 60_000);
    expect(await BehaviorEvent.findOne({ type: "snooze" }).lean()).toMatchObject({
      userId: alice, value: 1, meta: { alarmId: id, snoozeMinutes: 9, responseMs: 4000 },
    });
  });

  it("defaults to five minutes", async () => {
    const id = await alarmFor(alice);
    signInAs(alice);
    const res = await read(await snooze(request("POST", `/api/alarms/${id}/snooze`), idParams(id)));
    expect(res.status).toBe(200);
    expect(await BehaviorEvent.findOne({ type: "snooze" }).lean()).toMatchObject({ meta: { snoozeMinutes: 5 } });
  });
});

describe("POST /api/alarms/[id]/escalate", () => {
  it.each([["a string", "max"], ["zero", 0], ["six", 6], ["a fraction", 2.5]])("rejects level as %s", async (_w, level) => {
    const id = await alarmFor(alice);
    signInAs(alice);
    const res = await read(await escalate(request("POST", `/api/alarms/${id}/escalate`, { level }), idParams(id)));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/level must be a whole number from 1 to 5/);
    expect(await BehaviorEvent.countDocuments()).toBe(0);
  });

  it.each([
    ["not a list", "all"],
    ["bare channel names, the old format", ["emergencyContact"]],
    ["a removed channel", [{ kind: "smartLight", status: "not_configured" }]],
    ["a made-up status", [{ kind: "smartwatch", status: "triggered" }]],
  ])("rejects backups that are %s", async (_what, backups) => {
    const id = await alarmFor(alice);
    signInAs(alice);
    const res = await read(await escalate(request("POST", `/api/alarms/${id}/escalate`, { level: 5, backups }), idParams(id)));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/backups must be a list of \{ kind, status \}/);
    expect(await BehaviorEvent.countDocuments()).toBe(0);
  });

  it("records what each backup channel reported, and claims nothing itself", async () => {
    const id = await alarmFor(alice);
    signInAs(alice);
    const backups = [
      { kind: "secondaryAlarm", status: "not_configured" },
      { kind: "smartwatch", status: "not_configured" },
      { kind: "emergencyContact", status: "failed" },
    ];
    const res = await read(await escalate(request("POST", `/api/alarms/${id}/escalate`, {
      level: 5, backups: backups.map((b) => ({ ...b, extra: "dropped" })),
    }), idParams(id)));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ level: 5, backups });
    expect(await BehaviorEvent.findOne({ type: "escalation" }).lean()).toMatchObject({
      userId: alice, value: 5, meta: { alarmId: id, backups },
    });
  });
});

describe("POST /api/alarms/[id]/verify", () => {
  it.each([
    ["no challenge outcome at all", {}],
    ["only a self-reported score", { confidence: 100 }],
    ["solved as a string", { solved: "yes" }],
    ["a negative response time", { solved: true, responseMs: -1 }],
    ["correctness above 1", { solved: true, correctness: 1.5 }],
    ["motion above 1", { solved: true, motion: 3 }],
    ["negative attempts", { solved: true, attempts: -2 }],
    ["zero steps", { solved: true, steps: 0 }],
    ["fractional steps", { solved: true, steps: 1.5 }],
  ])("rejects %s", async (_what, body) => {
    const id = await alarmFor(alice);
    signInAs(alice);
    const res = await read(await verify(request("POST", `/api/alarms/${id}/verify`, body), idParams(id)));
    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(await BehaviorEvent.countDocuments()).toBe(0);
  });

  it("passes a quick, solved challenge and scores it on the server", async () => {
    const id = await alarmFor(alice);
    signInAs(alice);
    const res = await read(await verify(request("POST", `/api/alarms/${id}/verify`, {
      solved: true, correctness: 1, responseMs: 6000, attempts: 1, methods: ["math"],
    }), idParams(id)));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ passed: true, threshold: 70 });
    expect(await BehaviorEvent.findOne({ type: "verify_pass" }).lean()).toMatchObject({ meta: { scoredServerSide: true } });
  });

  it("judges speed per sum: three sums in 90 s pass an 85 alarm that one sum in 90 s would not", async () => {
    const id = await alarmFor(alice, { minConfidence: 85 });
    signInAs(alice);
    const threeSums = await read(await verify(request("POST", `/api/alarms/${id}/verify`, {
      solved: true, correctness: 1, responseMs: 90_000, steps: 3, attempts: 0, methods: ["math"],
    }), idParams(id)));
    expect(threeSums.body.data).toMatchObject({ passed: true, threshold: 85 });
    expect(await BehaviorEvent.findOne({ type: "verify_pass" }).lean()).toMatchObject({ meta: { steps: 3 } });

    const oneSlowSum = await read(await verify(request("POST", `/api/alarms/${id}/verify`, {
      solved: true, correctness: 1, responseMs: 90_000, attempts: 0, methods: ["math"],
    }), idParams(id)));
    expect(oneSlowSum.body.data.passed).toBe(false);
  });

  it("never passes an unsolved challenge, whatever score and motion are claimed", async () => {
    const id = await alarmFor(alice);
    signInAs(alice);
    const res = await read(await verify(request("POST", `/api/alarms/${id}/verify`, {
      solved: false, correctness: 0, confidence: 100, motion: 1, responseMs: 3000,
    }), idParams(id)));
    expect(res.body.data.passed).toBe(false);
    expect(await BehaviorEvent.countDocuments({ type: "verify_pass" })).toBe(0);
  });
});

describe("POST /api/alarms/[id]/dismiss", () => {
  const passVerification = (id: string) =>
    verify(request("POST", `/api/alarms/${id}/verify`, { solved: true, correctness: 1, responseMs: 6000 }), idParams(id));

  it("rejects a non-numeric response time", async () => {
    const id = await alarmFor(alice);
    signInAs(alice);
    const res = await read(await dismiss(request("POST", `/api/alarms/${id}/dismiss`, { responseMs: "slow" }), idParams(id)));
    expect(res.status).toBe(422);
    expect(await statusOf(id)).toBe("scheduled");
  });

  it("marks a one-off alarm verified when the server verified it", async () => {
    const id = await alarmFor(alice, { status: "ringing" });
    signInAs(alice);
    await passVerification(id);
    const res = await read(await dismiss(request("POST", `/api/alarms/${id}/dismiss`, { responseMs: 9000 }), idParams(id)));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "verified", enabled: false });
  });

  it("does not take the client's word that it verified", async () => {
    const id = await alarmFor(alice, { status: "ringing" });
    signInAs(alice);
    const res = await read(await dismiss(request("POST", `/api/alarms/${id}/dismiss`, { verified: true, confidence: 100 }), idParams(id)));
    expect(res.body.data.status).toBe("dismissed");
    const event = await BehaviorEvent.findOne({ type: "dismiss" }).lean<{ value?: number; meta: { verified: boolean } }>();
    expect(event?.meta.verified).toBe(false);
    expect(event?.value).toBeUndefined();
  });

  it("does not count a failed server verification as verified", async () => {
    const id = await alarmFor(alice, { status: "ringing" });
    signInAs(alice);
    await verify(request("POST", `/api/alarms/${id}/verify`, { solved: false, correctness: 0 }), idParams(id));
    const res = await read(await dismiss(request("POST", `/api/alarms/${id}/dismiss`, { verified: true }), idParams(id)));
    expect(res.body.data.status).toBe("dismissed");
  });

  it("ignores a verification from an earlier ring of the same alarm", async () => {
    const id = await alarmFor(alice, { status: "ringing", repeat: { type: "none" } });
    await BehaviorEvent.create({ userId: alice, type: "verify_pass", value: 95, meta: { alarmId: id }, at: new Date(Date.now() - DAY) });
    signInAs(alice);
    const res = await read(await dismiss(request("POST", `/api/alarms/${id}/dismiss`), idParams(id)));
    expect(res.body.data.status).toBe("dismissed");
  });

  it("records each verification once, not again on dismiss", async () => {
    const id = await alarmFor(alice, { status: "ringing" });
    signInAs(alice);
    await passVerification(id);
    await dismiss(request("POST", `/api/alarms/${id}/dismiss`), idParams(id));
    expect(await BehaviorEvent.countDocuments({ type: { $in: ["verify_pass", "verify_fail"] } })).toBe(1);
  });

  it("re-arms a daily alarm for its next occurrence in the future", async () => {
    const seven = new Date();
    seven.setHours(7, 0, 0, 0);
    const threeDaysAgo = new Date(seven.getTime() - 3 * DAY);
    const id = await alarmFor(alice, { scheduledTime: threeDaysAgo, repeat: { type: "daily" }, status: "ringing" });
    signInAs(alice);
    const res = await read(await dismiss(request("POST", `/api/alarms/${id}/dismiss`), idParams(id)));
    const next = new Date(res.body.data.scheduledTime);
    expect(res.body.data).toMatchObject({ status: "scheduled", enabled: true, lastSnoozeCount: 0 });
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(next.getTime() - Date.now()).toBeLessThanOrEqual(DAY);
    expect([next.getHours(), next.getMinutes()]).toEqual([7, 0]);
  });

  it("keeps a daily alarm's time after it was snoozed", async () => {
    const tomorrowSeven = new Date();
    tomorrowSeven.setDate(tomorrowSeven.getDate() + 1);
    tomorrowSeven.setHours(7, 0, 0, 0);
    const id = await alarmFor(alice, { scheduledTime: tomorrowSeven, repeat: { type: "daily" } });
    signInAs(alice);
    await snooze(request("POST", `/api/alarms/${id}/snooze`, { snoozeMinutes: 10 }), idParams(id));
    await snooze(request("POST", `/api/alarms/${id}/snooze`, { snoozeMinutes: 10 }), idParams(id));
    const res = await read(await dismiss(request("POST", `/api/alarms/${id}/dismiss`), idParams(id)));
    const next = new Date(res.body.data.scheduledTime);
    expect([next.getHours(), next.getMinutes()]).toEqual([7, 0]);
    expect(next.getTime()).toBeGreaterThan(tomorrowSeven.getTime());
    expect(res.body.data.snoozedFrom).toBeUndefined();
  });

  it("re-arms a weekday alarm on a weekday", async () => {
    const id = await alarmFor(alice, { repeat: { type: "weekdays" }, scheduledTime: new Date(Date.now() - HOUR) });
    signInAs(alice);
    const res = await read(await dismiss(request("POST", `/api/alarms/${id}/dismiss`), idParams(id)));
    expect([1, 2, 3, 4, 5]).toContain(new Date(res.body.data.scheduledTime).getDay());
  });
});

/** A phone rang and dismissed an alarm offline, and sends the result hours later (prompt 2.4). */
describe("a ring reported late", () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("records fire, verify and dismiss at the times they happened, and still counts as verified", async () => {
    const id = await alarmFor(alice, { scheduledTime: new Date(Date.now() - 3 * HOUR) });
    signInAs(alice);
    const rang = ago(3 * HOUR);
    const answered = ago(3 * HOUR - 50_000);
    const stopped = ago(3 * HOUR - 52_000);
    expect((await fire(request("POST", `/api/alarms/${id}/fire`, { at: rang }), idParams(id))).status).toBe(200);
    const v = await read(await verify(request("POST", `/api/alarms/${id}/verify`, {
      solved: true, correctness: 1, responseMs: 20000, attempts: 1, methods: ["math"], at: answered,
    }), idParams(id)));
    expect(v.body.data.passed).toBe(true);
    const climbed = ago(3 * HOUR - 51_000);
    expect((await escalate(request("POST", `/api/alarms/${id}/escalate`, { level: 3, backups: [], at: climbed }), idParams(id))).status).toBe(200);
    const d = await read(await dismiss(request("POST", `/api/alarms/${id}/dismiss`, { responseMs: 52000, at: stopped }), idParams(id)));
    expect(d.body.data.status).toBe("verified");

    const events = await BehaviorEvent.find({ "meta.alarmId": id }).sort({ at: 1 }).lean<{ type: string; at: Date; meta: { reportedLate?: boolean } }[]>();
    expect(events.map((e) => [e.type, e.at.toISOString(), e.meta.reportedLate])).toEqual([
      ["alarm_fire", rang, true],
      ["verify_pass", answered, true],
      ["escalation", climbed, true],
      ["dismiss", stopped, true],
    ]);
  });

  it("does not borrow a verification from a different ring", async () => {
    const id = await alarmFor(alice, { status: "ringing" });
    signInAs(alice);
    await verify(request("POST", `/api/alarms/${id}/verify`, { solved: true, correctness: 1, responseMs: 6000, at: ago(5 * HOUR) }), idParams(id));
    const d = await read(await dismiss(request("POST", `/api/alarms/${id}/dismiss`, { at: ago(2 * HOUR) }), idParams(id)));
    expect(d.body.data.status).toBe("dismissed");
  });

  it.each([
    ["in the future", new Date(Date.now() + HOUR).toISOString()],
    ["over a week old", new Date(Date.now() - 8 * DAY).toISOString()],
    ["not a time", "yesterday morning"],
    ["a number", 1792796760000],
  ])("rejects a time %s, recording nothing", async (_what, at) => {
    const id = await alarmFor(alice);
    signInAs(alice);
    for (const [handler, path, body] of [
      [fire, "fire", { at }],
      [verify, "verify", { solved: true, at }],
      [escalate, "escalate", { level: 2, at }],
      [dismiss, "dismiss", { at }],
    ] as const) {
      const res = await (handler as Handler)(request("POST", `/api/alarms/${id}/${path}`, body), idParams(id));
      expect(res.status).toBe(422);
    }
    expect(await BehaviorEvent.countDocuments()).toBe(0);
    expect(await statusOf(id)).toBe("scheduled");
  });
});

describe("PATCH after snooze", () => {
  it("forgets the pre-snooze time when the user sets a new one", async () => {
    const id = await alarmFor(alice, { repeat: { type: "daily" } });
    signInAs(alice);
    await snooze(request("POST", `/api/alarms/${id}/snooze`), idParams(id));
    const newTime = new Date(Date.now() + 2 * DAY);
    newTime.setHours(6, 15, 0, 0);
    await patch(request("PATCH", `/api/alarms/${id}`, { scheduledTime: newTime.toISOString() }), idParams(id));
    const res = await read(await dismiss(request("POST", `/api/alarms/${id}/dismiss`), idParams(id)));
    const next = new Date(res.body.data.scheduledTime);
    expect([next.getHours(), next.getMinutes()]).toEqual([6, 15]);
  });
});

describe("POST /api/alarms/lifecycle", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await lifecycle(request("POST", "/api/alarms/lifecycle", {}))).status).toBe(401);
  });

  it("rejects a dryRun that is not a boolean", async () => {
    signInAs(alice);
    const res = await read(await lifecycle(request("POST", "/api/alarms/lifecycle", { dryRun: "false" })));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/dryRun must be true or false/);
  });

  it("prunes the caller's finished one-off alarms and leaves other users' alone", async () => {
    const past = new Date(Date.now() - 2 * DAY);
    const mine = await alarmFor(alice, { scheduledTime: past, status: "verified" });
    const bobs = await alarmFor(bob, { scheduledTime: past, status: "verified" });
    signInAs(alice);

    const dry = await read(await lifecycle(request("POST", "/api/alarms/lifecycle", { dryRun: true })));
    expect(dry.body.data.pruned).toBe(1);
    expect(await Alarm.exists({ _id: mine })).not.toBeNull();

    const real = await read(await lifecycle(request("POST", "/api/alarms/lifecycle", {})));
    expect(real.status).toBe(200);
    expect(real.body.data.actions.map((a: { alarmId: string }) => a.alarmId)).toEqual([mine]);
    expect(await Alarm.exists({ _id: mine })).toBeNull();
    expect(await Alarm.exists({ _id: bobs })).not.toBeNull();
  });
});
