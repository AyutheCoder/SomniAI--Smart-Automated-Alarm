// Export and account deletion (prompt 7.2). The deletion test fills every kind
// of record the app keeps, for the account being deleted and for another
// account that shares a buddy pairing with it, deletes the first, and then
// reads every collection in the database: none may still hold the deleted
// account's id, email address, or the hash of it, anywhere in any document.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as createAlarm } from "@/app/api/alarms/route";
import { DELETE as deleteRoute, GET as summaryRoute } from "@/app/api/account/route";
import { GET as exportRoute } from "@/app/api/account/export/route";
import { connectToDatabase } from "@/lib/mongoose";
import { HOLDINGS, NOT_PERSONAL, identifiers, type Who } from "@/lib/accountData";
import { calendarDeps, connectCalendar } from "@/lib/calendarServer";
import { hit, POLICIES, accountKey } from "@/lib/rateLimit";
import { createCodes, enrol, ensureStudy, exportStudy } from "@/lib/studyServer";
import { STUDY_CONSENT } from "@/lib/studyConsent";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { BuddyAlert, BuddyInvite, BuddyPair, PushToken } from "@/models/Buddy";
import { ContextSnapshot } from "@/models/ContextSnapshot";
import { ModelFeedback } from "@/models/ModelFeedback";
import { RlPolicy } from "@/models/RlPolicy";
import { RequestKey } from "@/models/RequestKey";
import { ScreenNight } from "@/models/ScreenNight";
import { SleepLog } from "@/models/SleepLog";
import { Study } from "@/models/Study";
import { Task } from "@/models/Task";
import { User } from "@/models/User";
import { NightPlan, WakeReport } from "@/models/WakeReport";
import { WakeTelemetry } from "@/models/WakeTelemetry";
import { fakeGoogle, type FakeGoogle } from "@/tests/fixtures/google-calendar/fakeGoogle";
import { read, request, signInAs } from "./helpers";

const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: "fixture-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "fixture-secret",
  NEXTAUTH_URL: "http://localhost:3000",
  NEXTAUTH_SECRET: "test-server-secret",
};
beforeEach(async () => {
  for (const [k, v] of Object.entries(GOOGLE_ENV)) {
    vi.stubEnv(k, v);
  }
  await connectToDatabase();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubGoogle(): FakeGoogle {
  const g = fakeGoogle({
    token: [{ status: 200, fixture: "token-exchange" }],
    events: [{ status: 200, fixture: "events-page1" }, { status: 200, fixture: "events-page2" }],
  });
  vi.stubGlobal("fetch", g.fetch);
  return g;
}

async function signUp(email: string, password = "a long password"): Promise<Who> {
  const res = await read(await register(request("POST", "/api/auth/register", { email, password, name: `Name of ${email}` })));
  expect(res.status).toBe(201);
  return { id: String(res.body.data._id ?? res.body.data.id), email };
}

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.UTC(2026, 11, 1) + days * DAY);

/** Every kind of record, for `me`, through the routes and server code where the app makes them that way. */
async function fillEverything(me: Who, tag: string) {
  signInAs(me.id);
  const alarm = await read(await createAlarm(request("POST", "/api/alarms", { label: `Alarm of ${tag}`, scheduledTime: at(3).toISOString() })));
  expect(alarm.status).toBe(201);
  const alarmId = String(alarm.body.data._id);

  await Task.create({ userId: me.id, title: `Task of ${tag}` });
  await SleepLog.create({ userId: me.id, date: "2026-11-30", durationHours: 7.5, source: "health_connect" });
  await ScreenNight.create({ userId: me.id, date: "2026-11-30", bedtime: at(-1), minutes: 42, windowMinutes: 180, bedtimeFrom: "phone" });
  await WakeReport.create({ userId: me.id, alarmId, label: `Alarm of ${tag}`, ringAt: at(0), outcome: "woke", rang: true, verification: { required: false } });
  await NightPlan.create({ userId: me.id, bedtime: at(-1), wakeAt: at(0) });
  await BehaviorEvent.create({ userId: me.id, type: "dismiss", alarmId, meta: { note: tag } });
  await ContextSnapshot.create({ userId: me.id, weather: { tempC: 4, condition: "rain" } });
  await ModelFeedback.create({ userId: me.id, alarmId, outcome: "success", reward: 1 });
  await RlPolicy.create({ userId: me.id, policy: { tag } });
  await PushToken.create({ userId: me.id, token: `push-token-${tag}`, updatedAt: at(0) });
  await BuddyInvite.create({ userId: me.id, code: `CODE${tag.toUpperCase()}`.slice(0, 8), expiresAt: at(1) });
  await RequestKey.create({ userId: me.id, key: `key-of-${tag}`, path: `/api/alarms/${alarmId}/fire`, state: "done", status: 200, body: "{}", createdAt: new Date() });
  await hit(POLICIES.write, `user:${me.id}`);
  await hit(POLICIES.signInAccount, accountKey(me.email));

  // The study: joining turns telemetry on and randomises alarms (6.2).
  const [code] = await createCodes(1);
  await enrol(me.id, code, STUDY_CONSENT.version, "Europe/London");
  await WakeTelemetry.create({
    userId: me.id, alarmId, scheduledFor: at(0), consentVersion: "telemetry-v1", firstRingAt: new Date(), endedAt: new Date(),
    outcome: "dismissed", snoozes: 0, rings: [], verification: { required: false, result: "not_required" }, receivedAt: new Date(),
  });
  await read(await createAlarm(request("POST", "/api/alarms", { label: `Second alarm of ${tag}`, scheduledTime: at(4).toISOString() })));

  // Google Calendar, through the real connect and sync against the fake Google.
  stubGoogle();
  const connected = await connectCalendar(me.id, "fixture-code", calendarDeps());
  expect(connected.ok).toBe(true);
  return alarmId;
}

/** Every document in every collection that mentions any of `needles`. */
async function mentions(needles: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const c of await mongoose.connection.db!.collections()) {
    for (const doc of await c.find({}).toArray()) {
      const text = JSON.stringify(doc);
      for (const n of needles) {
        if (text.includes(n)) {
          found.push(`${c.collectionName}: ${text.slice(0, 160)}`);
        }
      }
    }
  }
  return found;
}

async function counts(who: Who): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const h of HOLDINGS) {
    out[h.name] = await h.model.countDocuments(h.mine(who));
  }
  return out;
}

describe("account deletion really deletes", () => {
  it("removes every record of the account, everywhere, and nothing of anyone else's", async () => {
    const study = await ensureStudy();
    const victim = await signUp("deleted.person@example.org");
    const other = await signUp("stays@example.org");
    const victimAlarm = await fillEverything(victim, "victim");
    await fillEverything(other, "other");

    // A buddy pairing between them, and an alert each way.
    await BuddyPair.create({ ownerId: victim.id, requesterId: other.id, status: "active", requestedAt: at(0), acceptedAt: at(0) });
    await BuddyAlert.create({ channel: "buddy", sleeperId: victim.id, buddyId: other.id, alarmId: victimAlarm, occurrence: "o1", status: "sent", at: at(0) });
    await BuddyAlert.create({ channel: "buddy", sleeperId: other.id, buddyId: victim.id, alarmId: "a2", occurrence: "o2", status: "sent", at: at(0) });
    await BuddyAlert.create({ channel: "emergencyContact", sleeperId: victim.id, alarmId: victimAlarm, occurrence: "o3", status: "sent", at: at(0) });

    // The test is only as good as what it filled: every kind of record exists for the account first.
    const before = await counts(victim);
    for (const h of HOLDINGS) {
      expect(before[h.name], `${h.name} has records of the account before deletion`).toBeGreaterThan(0);
    }
    expect(await mentions(identifiers(victim))).not.toEqual([]);
    const otherBefore = await counts(other);

    const google = stubGoogle();
    signInAs(victim.id);
    const res = await read(await deleteRoute(request("DELETE", "/api/account", { confirm: "Deleted.Person@example.org ", password: "a long password" })));
    expect(res.status).toBe(200);
    expect(res.body.data.calendarRevokedAtGoogle).toBe(true);
    expect(res.body.data.leftStudy).toBe(true);
    expect(google.calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);

    // Nothing, in any collection, still names the account.
    expect(await mentions(identifiers(victim))).toEqual([]);
    expect(Object.values(await counts(victim)).every((n) => n === 0)).toBe(true);

    // The other account keeps everything except what it shared with the deleted one.
    const otherAfter = await counts(other);
    expect(otherAfter).toEqual({ ...otherBefore, buddyPairings: otherBefore.buddyPairings - 1, buddyAlerts: otherBefore.buddyAlerts - 2 });
    expect(await User.exists({ _id: other.id })).not.toBeNull();

    // Leaving the study is counted, as any withdrawal is, and the export no longer has them.
    expect((await Study.findOne({ studyId: study.studyId }).lean<{ withdrawn: number }>())!.withdrawn).toBe(1);
    const studyExport = await exportStudy();
    expect(studyExport.participants).toBe(1);
    expect(studyExport.data).toHaveLength(1);
  }, 60_000);

  it("is refused without the account's email typed and, for a password account, its password", async () => {
    const me = await signUp("careful@example.org");
    signInAs(me.id);
    const del = async (body: unknown) => read(await deleteRoute(request("DELETE", "/api/account", body)));
    expect((await del({ password: "a long password" })).status).toBe(422);
    expect((await del({ confirm: "someone.else@example.org", password: "a long password" })).status).toBe(422);
    expect((await del({ confirm: me.email })).status).toBe(422);
    const wrong = await del({ confirm: me.email, password: "not it at all" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toBe("That password isn't right.");
    expect(await User.exists({ _id: me.id })).not.toBeNull();
  });

  it("asks an account made with Google only for its address, which is all it has", async () => {
    const user = await User.create({ email: "google.person@example.org", provider: "google" });
    signInAs(String(user._id));
    const res = await read(await deleteRoute(request("DELETE", "/api/account", { confirm: "google.person@example.org" })));
    expect(res.status).toBe(200);
    expect(res.body.data.calendarRevokedAtGoogle).toBeNull();
    expect(await mentions(identifiers({ id: String(user._id), email: "google.person@example.org" }))).toEqual([]);
  });

  it("signed out, neither deletes nor exports anything", async () => {
    signInAs(null);
    expect((await deleteRoute(request("DELETE", "/api/account", { confirm: "x@example.org" }))).status).toBe(401);
    expect((await exportRoute()).status).toBe(401);
  });
});

describe("the export", () => {
  it("has every kind of record the account has, and no secret and no one else's identity", async () => {
    await ensureStudy();
    const me = await signUp("exporter@example.org");
    const other = await signUp("buddy@example.org");
    await fillEverything(me, "me");
    await BuddyPair.create({ ownerId: other.id, requesterId: me.id, status: "active", requestedAt: at(0) });
    await BuddyAlert.create({ channel: "buddy", sleeperId: other.id, buddyId: me.id, alarmId: "theirs", occurrence: "o", status: "sent", at: at(0) });

    signInAs(me.id);
    const res = await exportRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="somniai-data-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await res.text();
    const body = JSON.parse(text);
    for (const h of HOLDINGS.filter((x) => !x.noExport)) {
      expect(body.data[h.name]?.length, h.name).toBeGreaterThan(0);
    }
    expect(body.data.account[0].email).toBe("exporter@example.org");
    expect(body.data.alarms.map((a: { label: string }) => a.label)).toContain("Alarm of me");
    expect(body.data.buddyPairings[0].you).toBe("asked to pair");
    expect(body.data.buddyAlerts[0].about).toBe("someone you were buddy for");
    // Secrets and the other person.
    for (const absent of ["passwordHash", "refreshTokenSealed", "push-token-me", other.id, other.email, "theirs"]) {
      expect(text, absent).not.toContain(absent);
    }
    expect(body.notIncluded.length).toBeGreaterThan(3);
  });

  it("is summed up for the account page: the address, whether there is a password, and how much of each kind", async () => {
    await ensureStudy();
    const me = await signUp("counted@example.org");
    await fillEverything(me, "counted");
    signInAs(me.id);
    const res = await read(await summaryRoute());
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("counted@example.org");
    expect(res.body.data.hasPassword).toBe(true);
    expect(res.body.data.records.alarms).toBe(2);
    expect(res.body.data.records.sleepLogs).toBe(1);
    expect(res.body.data.records).not.toHaveProperty("rateLimitCounts");
    expect(JSON.stringify(res.body.data)).not.toContain("passwordHash");
    signInAs(null);
    expect((await summaryRoute()).status).toBe(401);
  });
});

describe("the list of what is stored", () => {
  it("names every model in models/, as someone's data or as no one's", async () => {
    const listed = new Set([...HOLDINGS.map((h) => h.model.modelName), ...NOT_PERSONAL.map((n) => n.model.modelName)]);
    const files = readdirSync(join(process.cwd(), "models")).filter((f) => f.endsWith(".ts"));
    const models: string[] = [];
    for (const f of files) {
      const mod = await import(`@/models/${f.replace(/\.ts$/, "")}`);
      for (const v of Object.values(mod)) {
        if (typeof v === "function" && typeof (v as { modelName?: unknown }).modelName === "string") {
          models.push((v as unknown as { modelName: string }).modelName);
        }
      }
    }
    expect(models.length).toBeGreaterThanOrEqual(listed.size);
    expect(models.filter((m) => !listed.has(m))).toEqual([]);
    expect(mongoose.modelNames().filter((m) => !listed.has(m))).toEqual([]);
  });
});
