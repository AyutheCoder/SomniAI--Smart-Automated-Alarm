import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createAlarm } from "@/app/api/alarms/route";
import { DELETE as leave, GET as state } from "@/app/api/study/route";
import { POST as enrolRoute } from "@/app/api/study/enrol/route";
import { GET as exportRoute } from "@/app/api/study/export/route";
import { createCodes, ensureStudy, hashCode } from "@/lib/studyServer";
import { STUDY_CONSENT } from "@/lib/studyConsent";
import { Alarm } from "@/models/Alarm";
import { Assignment, Randomisation } from "@/models/Randomisation";
import { SleepLog } from "@/models/SleepLog";
import { Enrollment, Study, StudyCode } from "@/models/Study";
import { TelemetryConsent } from "@/models/TelemetryConsent";
import { User } from "@/models/User";
import { WakeTelemetry } from "@/models/WakeTelemetry";
import { makeUser, read, request, signInAs } from "./helpers";
import { NextRequest } from "next/server";

const TOKEN = "export-token-for-tests-0123456789";
const join = async (code: string, extra: Record<string, unknown> = {}) =>
  read(await enrolRoute(request("POST", "/api/study/enrol", { code, agree: true, consentVersion: STUDY_CONSENT.version, tz: "Asia/Kolkata", ...extra })));
const exported = async (auth: string | null = `Bearer ${TOKEN}`) =>
  exportRoute(new NextRequest("http://localhost/api/study/export", { headers: auth ? { authorization: auth } : {} }));
let n = 0;
async function alarm(label = "Morning shift at the hospital") {
  n++;
  const res = await read(await createAlarm(request("POST", "/api/alarms", {
    label, scheduledTime: new Date(Date.UTC(2026, 11, 1 + (n % 28), 1, 0)).toISOString(),
  })));
  return res.body.data as { _id: string; ringPlan: { study?: { arm: string | null } } };
}
async function wake(userId: string, alarmId: string, at: Date) {
  await WakeTelemetry.create({
    userId, alarmId, scheduledFor: at, consentVersion: "telemetry-v1", firstRingAt: at, endedAt: new Date(at.getTime() + 300_000),
    outcome: "dismissed", snoozes: 1, firstInteractionMs: 9_000, stageReached: { level: 2, stage: "ramp" },
    verification: { required: true, result: "passed", attempts: 3, steps: 3, timeOnTaskMs: 20_000 }, rings: [], receivedAt: at,
  });
}

beforeEach(() => {
  process.env.STUDY_EXPORT_TOKEN = TOKEN;
});
afterEach(() => {
  delete process.env.STUDY_EXPORT_TOKEN;
});

describe("enrolment by code", () => {
  it("joins with a valid code and the current consent: a participant code, randomisation and telemetry on, alarms randomised", async () => {
    const me = await makeUser();
    signInAs(me);
    const before = await alarm();
    expect(before.ringPlan.study).toBeUndefined();
    const [code] = await createCodes(1);
    const res = await join(code);
    expect(res.status).toBe(201);
    expect(res.body.data.enrolment).toMatchObject({ participantId: expect.stringMatching(/^P-[0-9A-F]{8}$/), consentVersion: "study-v1" });
    expect((await Randomisation.findOne({ userId: me, active: true }).lean<{ experiment: string; seed: string }>())).toMatchObject({
      experiment: "wake_plan", seed: (await ensureStudy()).seed,
    });
    expect((await TelemetryConsent.findOne({ userId: me }).lean<{ granted: boolean }>())!.granted).toBe(true);
    // The alarm set before joining is randomised now; a new one too.
    expect((await Alarm.findById(before._id).lean<{ ringPlan: { study?: unknown } }>())!.ringPlan.study).toMatchObject({ experiment: "wake_plan", applied: true });
    expect((await alarm()).ringPlan.study).toMatchObject({ experiment: "wake_plan" });
    expect((await read(await state())).body.data.enrolment.participantId).toBe(res.body.data.enrolment.participantId);
  });

  it("codes are stored only as hashes, are single use by default, and are read leniently", async () => {
    const [code] = await createCodes(1);
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    const stored = await StudyCode.find({}).lean<Record<string, unknown>[]>();
    expect(JSON.stringify(stored)).not.toContain(code.replace(/-/g, ""));
    expect(stored[0].codeHash).toBe(hashCode(code));
    signInAs(await makeUser());
    expect((await join(` ${code.toLowerCase().replace(/-/g, " ")} `)).status).toBe(201);
    signInAs(await makeUser());
    expect((await join(code)).body.error).toBe("That code isn't valid, or has already been used.");
  });

  it("a wrong, used-up or expired code gets one message, and joins nothing", async () => {
    const [expired] = await createCodes(1, { expiresAt: new Date(Date.now() - 1000) });
    const [twice] = await createCodes(1, { maxUses: 2 });
    for (const bad of ["NOPE-NOPE-NOPE", expired]) {
      const me = await makeUser();
      signInAs(me);
      const r = await join(bad);
      expect(r.status).toBe(422);
      expect(r.body.error).toBe("That code isn't valid, or has already been used.");
      expect(await Enrollment.exists({ userId: me })).toBeNull();
    }
    for (const expected of [201, 201, 422]) {
      signInAs(await makeUser());
      expect((await join(twice)).status).toBe(expected);
    }
  });

  it("needs agreement to the current consent version; once only; signed in", async () => {
    const [code] = await createCodes(1);
    const me = await makeUser();
    signInAs(me);
    expect((await join(code, { consentVersion: "study-v0" })).body.error).toBe("consent must be to the current document, study-v1");
    expect((await join(code, { agree: false })).status).toBe(422);
    expect((await join(code, { tz: "Mars/Olympus" })).status).toBe(422);
    expect((await StudyCode.findOne({ codeHash: hashCode(code) }).lean<{ uses: number }>())!.uses).toBe(0);
    expect((await join(code)).status).toBe(201);
    const [another] = await createCodes(1);
    expect((await join(another)).status).toBe(409);
    expect((await StudyCode.findOne({ codeHash: hashCode(another) }).lean<{ uses: number }>())!.uses).toBe(0);
    signInAs(null);
    expect((await join(another)).status).toBe(401);
  });
});

describe("withdrawal, at any time, with deletion", () => {
  it("deletes everything the study collected, and leaves the person's own data", async () => {
    const me = await makeUser();
    signInAs(me);
    const own = await alarm("Gym");
    await wake(me, own._id, new Date(Date.now() - 10 * 86_400_000)); // recorded before the study: theirs, kept
    await SleepLog.create({ userId: me, date: "2026-11-10", durationHours: 7, source: "manual" });
    const [code] = await createCodes(1);
    await join(code);
    const during = await alarm();
    await wake(me, during._id, new Date(Date.now() + 60_000));
    expect(await Assignment.countDocuments({ userId: me })).toBe(2);

    const res = await read(await leave());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ enrolment: null, deleted: { deletedAssignments: 2, deletedWakes: 1 } });
    expect(await Assignment.countDocuments({ userId: me })).toBe(0);
    expect(await Randomisation.countDocuments({ userId: me })).toBe(0);
    expect(await Enrollment.exists({ userId: me })).toBeNull();
    expect((await TelemetryConsent.findOne({ userId: me }).lean<{ granted: boolean }>())!.granted).toBe(false);
    for (const a of await Alarm.find({ userId: me }).lean<{ ringPlan: { study?: unknown; adjustments: string[] } }[]>()) {
      expect(a.ringPlan.study).toBeUndefined();
      expect(a.ringPlan.adjustments.filter((x) => x.startsWith("Study:"))).toEqual([]);
    }
    // Their own: the wake from before, the sleep log, the alarms.
    expect(await WakeTelemetry.countDocuments({ userId: me })).toBe(1);
    expect(await SleepLog.countDocuments({ userId: me })).toBe(1);
    expect(await Alarm.countDocuments({ userId: me })).toBe(2);
    expect((await Study.findOne({}).lean<{ withdrawn: number }>())!.withdrawn).toBe(1);
    // A new alarm isn't randomised.
    expect((await alarm()).ringPlan.study).toBeUndefined();
  });

  it("is gone from the next export, and can't leave twice", async () => {
    const me = await makeUser();
    signInAs(me);
    const [code] = await createCodes(1);
    const p = (await join(code)).body.data.enrolment.participantId;
    expect(JSON.parse(await (await exported()).text()).data.map((d: { participant: string }) => d.participant)).toContain(p);
    await leave();
    const after = JSON.parse(await (await exported()).text());
    expect(after.data.map((d: { participant: string }) => d.participant)).not.toContain(p);
    expect(after.withdrawn).toBe(1);
    expect((await read(await leave())).status).toBe(404);
  });
});

describe("the anonymised export", () => {
  it("only with the researchers' token, and off without one", async () => {
    expect((await exported(null)).status).toBe(401);
    expect((await exported("Bearer wrong")).status).toBe(401);
    delete process.env.STUDY_EXPORT_TOKEN;
    expect((await exported()).status).toBe(503);
  });

  it("contains no names, emails, account or alarm ids, alarm labels or dates; days and times instead", async () => {
    const people = [
      { name: "Ayesha Kapoor", email: "ayesha.kapoor@example.org" },
      { name: "Rohan Mehta", email: "rohan.m@example.net" },
    ];
    const ids: string[] = [];
    const alarmIds: string[] = [];
    for (const person of people) {
      const me = await makeUser(person);
      ids.push(me);
      signInAs(me);
      const [code] = await createCodes(1);
      await join(code);
      const a = await alarm(`${person.name.split(" ")[0]}'s dialysis appointment`);
      alarmIds.push(a._id);
      const today = new Date();
      for (let d = -5; d <= 3; d++) {
        const wakeAt = new Date(today.getTime() + d * 86_400_000);
        await SleepLog.create({
          // The date in the participant's own time zone, as the app files a night; a UTC date
          // here made the test fail every evening between 18:30 and midnight UTC.
          userId: me, date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(wakeAt), source: "manual", durationHours: 7.5,
          sleepTime: new Date(wakeAt.getTime() - 7.5 * 3_600_000), wakeTime: wakeAt,
        });
      }
      await wake(me, a._id, new Date(today.getTime() + 60_000));
    }
    const res = await exported();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="somni-wake-plan-1-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await res.text();
    const body = JSON.parse(text);

    for (const person of people) {
      expect(text).not.toContain(person.name);
      expect(text).not.toContain(person.name.split(" ")[0]);
      expect(text).not.toContain(person.email);
    }
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/dialysis|appointment/i);
    for (const id of [...ids, ...alarmIds]) {
      expect(text).not.toContain(id);
    }
    expect(text).not.toMatch(/\b[0-9a-f]{24}\b/);
    // The only date is the export's own.
    expect(text.match(/\d{4}-\d{2}-\d{2}/g)).toEqual([body.exportedOn]);
    const users = await User.find({ _id: { $in: ids } }).lean<{ name: string; email: string }[]>();
    expect(users.map((u) => u.email).sort()).toEqual(people.map((p) => p.email).sort());

    expect(body).toMatchObject({ study: "somni-wake-plan-1", experiment: "wake_plan", consentVersion: "study-v1", participants: 2 });
    const one = body.data[0];
    expect(one.participant).toMatch(/^P-[0-9A-F]{8}$/);
    expect(Object.keys(one).sort()).toEqual(["assignments", "consentVersion", "nights", "participant", "wakes"]);
    expect(one.assignments[0]).toEqual({ alarm: 1, day: 0, sequence: 0, block: 0, arm: expect.stringMatching(/^(shown|not_shown)$/), excluded: null, overridden: false });
    // Nights from the enrolment day on: study days, local times, and the paper's label.
    expect(one.nights.map((x: { day: number }) => x.day)).toEqual([0, 1, 2, 3]);
    expect(one.nights[0]).toMatchObject({ sleepHours: 7.5, bedtime: expect.stringMatching(/^\d{2}:\d{2}$/), wake: expect.stringMatching(/^\d{2}:\d{2}$/) });
    expect(one.wakes).toEqual([expect.objectContaining({ alarm: 1, arm: one.assignments[0].arm, snoozes: 1, firstInteractionMs: 9000, outcome: "dismissed" })]);
  });
});
