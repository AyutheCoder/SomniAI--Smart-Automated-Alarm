import { describe, expect, it } from "vitest";
import { POST as verify } from "@/app/api/alarms/[id]/verify/route";
import { POST as escalate } from "@/app/api/alarms/[id]/escalate/route";
import { POST as dismiss } from "@/app/api/alarms/[id]/dismiss/route";
import { POST as missed } from "@/app/api/alarms/[id]/missed/route";
import { GET as reports } from "@/app/api/wake-reports/route";
import { DELETE as cancelPlans, POST as planNight } from "@/app/api/night-plans/route";
import { GET as metrics } from "@/app/api/metrics/route";
import { POST as createAlarm } from "@/app/api/alarms/route";
import { Alarm, type AlarmDocument } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { SleepLog } from "@/models/SleepLog";
import { NightPlan, WakeReport } from "@/models/WakeReport";
import { MISSING_ID, idParams, makeUser, read, request, signInAs } from "./helpers";

const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);

async function alarmFor(userId: string, fields: Record<string, unknown> = {}) {
  const doc = await Alarm.create({
    userId, label: "Work", scheduledTime: ago(3), status: "ringing",
    verificationRequired: true, verificationMethod: "math", minConfidence: 70, ...fields,
  });
  return String(doc._id);
}

/** A ring answered at `level`, as both clients report it: verify, escalate, dismiss. */
async function answer(id: string, level: number, check: { solved: boolean; responseMs: number } | null = { solved: true, responseMs: 33_400 }) {
  if (check) {
    const v = await read(await verify(request("POST", "/x", { methods: ["math"], steps: 3, attempts: 1, correctness: check.solved ? 1 : 0.3, ...check }), idParams(id)));
    expect(v.status).toBe(200);
  }
  expect((await read(await escalate(request("POST", "/x", { level, backups: [] }), idParams(id)))).status).toBe(200);
  const d = await read(await dismiss(request("POST", "/x", { responseMs: 60_000 }), idParams(id)));
  expect(d.status).toBe(200);
  return d;
}

async function latest(query = "tz=Asia/Kolkata") {
  const r = await read(await reports(request("GET", `/api/wake-reports?${query}`)));
  expect(r.status).toBe(200);
  return r.body.data.reports;
}

describe("the morning report after an answered alarm", () => {
  it("a gentle wake: level 1, the check's time from the server's record, a streak of one", async () => {
    const me = await makeUser();
    signInAs(me);
    const id = await alarmFor(me);
    await answer(id, 1);
    const [r] = await latest();
    expect(r).toMatchObject({
      alarmId: id, outcome: "woke", kind: "gentle", level: 1, levelLabel: "Normal alarm", stage: "ramp", rang: true,
      verification: { required: true, passed: true, seconds: 33.4, steps: 3, threshold: 70 },
      plan: { status: "no_plan" },
      streak: { count: 1, best: 1 },
      profile: { samples: 1 },
    });
    expect(r.lines.stage).toBe("Gentle wake: you were up at level 1 of 5, Normal alarm.");
    expect(r.lines.verification).toBe("Wake check passed in 33 s (3 answers).");
    expect(r.lines.streak).toBe("Streak: 1 alarm answered in a row.");
  });

  it("a fully escalated wake: level 5 and its name in the alarm's own ladder", async () => {
    const me = await makeUser();
    signInAs(me);
    await answer(await alarmFor(me), 5);
    const [r] = await latest();
    expect(r).toMatchObject({ kind: "full", level: 5, levelLabel: "Trying backups", stage: "challenge" });
    expect(r.lines.stage).toBe("Fully escalated: it took level 5 of 5, Trying backups.");
  });

  it("a failed check is reported as failed, never as passed", async () => {
    const me = await makeUser();
    signInAs(me);
    await answer(await alarmFor(me), 4, { solved: false, responseMs: 50_000 });
    const [r] = await latest();
    expect(r.verification).toMatchObject({ passed: false, threshold: 70 });
    expect(r.lines.verification).toMatch(/^Wake check not passed \(score \d+, needed 70\) after 50 s\.$/);
  });

  it("an alarm without a check says so", async () => {
    const me = await makeUser();
    signInAs(me);
    await answer(await alarmFor(me, { verificationRequired: false, verificationMethod: "none" }), 2, null);
    const [r] = await latest();
    expect(r).toMatchObject({ kind: "gentle", level: 2, verification: { required: false, passed: null } });
    expect(r.lines.verification).toBe("No wake check on this alarm.");
  });
});

describe("the morning report after a missed alarm", () => {
  it("rang unanswered: missed at the level it reached, the streak resets, the alarm is left for the buddy check", async () => {
    const me = await makeUser();
    signInAs(me);
    await answer(await alarmFor(me, { scheduledTime: ago(60 * 24) }), 2);
    await answer(await alarmFor(me, { scheduledTime: ago(60 * 23) }), 1);
    const id = await alarmFor(me, { scheduledTime: ago(25) });
    const res = await read(await missed(request("POST", "/x", { at: ago(5).toISOString(), level: 5, rang: true }), idParams(id)));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ _id: id, status: "ringing", enabled: true });
    const [r] = await latest();
    expect(r).toMatchObject({
      alarmId: id, outcome: "missed", kind: "missed", level: 5, levelLabel: "Trying backups", rang: true,
      verification: { passed: null }, streak: { count: 0, best: 2 },
    });
    expect(r.lines.stage).toMatch(/^Missed: nothing stopped it\. It rang until \d\d:\d\d and reached level 5 of 5, Trying backups\.$/);
    expect(r.lines.verification).toBe("No wake check: the alarm wasn't answered.");
    expect(r.lines.streak).toBe("Streak reset: this alarm wasn't answered. Your best is 2 alarms in a row.");
  });

  it("never rang (the page was closed): missed with no level, and not counted by the profile", async () => {
    const me = await makeUser();
    signInAs(me);
    const id = await alarmFor(me, { status: "missed", enabled: false });
    expect((await read(await missed(request("POST", "/x", { rang: false, level: 3 }), idParams(id)))).status).toBe(200);
    const [r] = await latest();
    expect(r).toMatchObject({ kind: "missed", rang: false, level: null, profile: { samples: 0 } });
    expect(r.lines.stage).toBe("Missed: it didn't ring on any device that reported back.");
  });

  it("a resent call records the ring once, and the first record stands", async () => {
    const me = await makeUser();
    signInAs(me);
    const id = await alarmFor(me);
    await missed(request("POST", "/x", { level: 4 }), idParams(id));
    await missed(request("POST", "/x", { level: 2 }), idParams(id));
    expect(await WakeReport.countDocuments({ userId: me })).toBe(1);
    expect((await latest())[0].level).toBe(4);
  });

  it("checks who, which alarm and what it was sent", async () => {
    const [me, other] = [await makeUser(), await makeUser()];
    const id = await alarmFor(me);
    signInAs(null);
    expect((await read(await missed(request("POST", "/x", {}), idParams(id)))).status).toBe(401);
    expect((await read(await reports(request("GET", "/api/wake-reports")))).status).toBe(401);
    signInAs(other);
    expect((await read(await missed(request("POST", "/x", {}), idParams(id)))).status).toBe(404);
    signInAs(me);
    expect((await read(await missed(request("POST", "/x", {}), idParams("nope")))).status).toBe(400);
    expect((await read(await missed(request("POST", "/x", {}), idParams(MISSING_ID)))).status).toBe(404);
    for (const body of [{ level: 6 }, { level: 2.5 }, { rang: "yes" }, { at: "yesterday" }]) {
      expect((await read(await missed(request("POST", "/x", body), idParams(id)))).status).toBe(422);
    }
    for (const q of ["limit=0", "limit=31", "tz=Mars/Base", "alarmId=nope"]) {
      expect((await read(await reports(request("GET", `/api/wake-reports?${q}`)))).status).toBe(q.startsWith("alarmId") ? 400 : 422);
    }
    expect(await WakeReport.countDocuments({})).toBe(0);
  });

  it("each user sees their own reports, newest first, or one alarm's", async () => {
    const [me, other] = [await makeUser(), await makeUser()];
    signInAs(other);
    await answer(await alarmFor(other), 1);
    signInAs(me);
    const older = await alarmFor(me, { scheduledTime: ago(120) });
    await answer(older, 1);
    const newer = await alarmFor(me, { scheduledTime: ago(30) });
    await answer(newer, 3);
    expect((await latest("limit=5")).map((r: { alarmId: string }) => r.alarmId)).toEqual([newer, older]);
    expect((await latest(`alarmId=${older}`)).map((r: { alarmId: string }) => r.alarmId)).toEqual([older]);
  });
});

describe("last night's plan", () => {
  it("kept, late, or can't tell without a recorded bedtime; a simulated one doesn't count", async () => {
    const me = await makeUser();
    signInAs(me);
    const wakeAt = ago(3);
    const bedtime = new Date(wakeAt.getTime() - 8 * 60 * MIN);
    // Set the evening before, so the wake was still to come.
    const saved = await read(await planNight(request("POST", "/x", { bedtime: bedtime.toISOString(), wakeAt: wakeAt.toISOString() })));
    expect(saved.status).toBe(201);
    const id = await alarmFor(me, { scheduledTime: wakeAt });
    await answer(id, 1);
    expect((await latest())[0].plan).toEqual({ status: "unknown", plannedBedtime: bedtime.toISOString(), bedtime: null, lateMinutes: null });

    await SleepLog.create({ userId: me, date: "2026-11-01", sleepTime: new Date(bedtime.getTime() - 5 * MIN), source: "simulated" });
    expect((await latest())[0].plan.status).toBe("unknown");

    await SleepLog.create({ userId: me, date: "2026-11-02", sleepTime: new Date(bedtime.getTime() + 40 * MIN), source: "manual" });
    expect((await latest())[0].plan).toMatchObject({ status: "not_followed", lateMinutes: 40 });
    expect((await latest())[0].lines.plan).toMatch(/You were in bed at \d\d:\d\d, 40 minutes late\.$/);
  });

  it("a new plan for the same night replaces the old; cancelling the reminder cancels it", async () => {
    const me = await makeUser();
    signInAs(me);
    const wakeAt = new Date(Date.now() + 8 * 60 * MIN);
    const bed = (h: number) => new Date(wakeAt.getTime() - h * 60 * MIN).toISOString();
    await planNight(request("POST", "/x", { bedtime: bed(8), wakeAt: wakeAt.toISOString() }));
    await planNight(request("POST", "/x", { bedtime: bed(7), wakeAt: wakeAt.toISOString() }));
    expect(await NightPlan.countDocuments({ userId: me, cancelledAt: { $exists: false } })).toBe(1);
    expect((await read(await cancelPlans())).body.data).toEqual({ cancelled: 1 });
    expect(await NightPlan.countDocuments({ userId: me, cancelledAt: { $exists: false } })).toBe(0);
  });

  it("rejects what isn't a plan for a coming night", async () => {
    const me = await makeUser();
    signInAs(null);
    expect((await read(await planNight(request("POST", "/x", {})))).status).toBe(401);
    expect((await read(await cancelPlans())).status).toBe(401);
    signInAs(me);
    const soon = Date.now() + 8 * 60 * MIN;
    const iso = (ms: number) => new Date(ms).toISOString();
    for (const body of [
      {},
      { bedtime: "22:30", wakeAt: iso(soon) },
      { bedtime: iso(soon), wakeAt: iso(soon - 60 * MIN) },
      { bedtime: iso(soon - 30 * 60 * MIN), wakeAt: iso(soon) },
      { bedtime: iso(Date.now() + 9 * 24 * 60 * MIN), wakeAt: iso(Date.now() + 9 * 24 * 60 * MIN + 60 * MIN) },
    ]) {
      expect((await read(await planNight(request("POST", "/x", body)))).status).toBe(422);
    }
    expect(await NightPlan.countDocuments({})).toBe(0);
  });
});

describe("the reports update the escalation profile", () => {
  it("once enough rings are reported, alarms still to ring are replanned from it", async () => {
    const me = await makeUser();
    signInAs(me);
    const created = await read(await createAlarm(request("POST", "/api/alarms", {
      label: "Tomorrow", scheduledTime: new Date(Date.now() + 24 * 60 * MIN).toISOString(), verificationRequired: false, verificationMethod: "none",
    })));
    expect(created.status).toBe(201);
    const upcoming = created.body.data._id as string;
    const before = (await Alarm.findById(upcoming).lean<AlarmDocument>())!.ringPlan;
    // Three rings that each needed the challenge, and one missed outright.
    for (const minutesAgo of [300, 200, 100]) {
      await answer(await alarmFor(me, { scheduledTime: ago(minutesAgo) }), 4);
    }
    await missed(request("POST", "/x", { level: 5 }), idParams(await alarmFor(me, { scheduledTime: ago(10) })));

    const after = (await Alarm.findById(upcoming).lean<AlarmDocument>())!.ringPlan!;
    expect(before?.escalation.map((l) => l.afterSeconds)).toEqual([0, 10, 22, 35, 75]);
    // Typically level 4 or worse: the ladder climbs sooner (pace 0.6).
    expect(after.escalation.map((l) => l.afterSeconds)).toEqual([0, 6, 13, 21, 45]);
    expect(after.adjustments.join(" ")).toMatch(/Paced to how you have responded to 4 past alarms/);

    const m = await read(await metrics(request("GET", "/api/metrics")));
    expect(m.body.data.escalationProfile).toMatchObject({ samples: 4, typicalLevel: 4, reliableLevel: 5, paceFactor: 0.6 });
  });

  it("rings from before reports existed still count, once each", async () => {
    const me = await makeUser();
    signInAs(me);
    for (const level of [2, 2]) {
      await BehaviorEvent.create({ userId: me, type: "escalation", value: level, at: ago(60 * 48) });
    }
    await answer(await alarmFor(me), 2);
    const m = await read(await metrics(request("GET", "/api/metrics")));
    // Two older events, plus this ring's report; its own escalation event isn't counted again.
    expect(m.body.data.escalationProfile).toMatchObject({ samples: 3, typicalLevel: 2 });
  });
});
