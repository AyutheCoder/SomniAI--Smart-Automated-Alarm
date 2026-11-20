// Everything stored about an account, in one place (prompt 7.2): the in-app
// export reads it, and account deletion deletes it. Every model in models/ is
// listed here, either as holding a person's data (and how to find theirs) or
// as holding none (and why); tests/api/account.test.ts fails on a model that
// is in neither list, and checks after a deletion that no collection still
// has the person's id, email address or the hash of it anywhere in it.
//
// legal/PRIVACY.md describes each of these; `policy` names the section, and a
// test checks that the policy has it.

import type { Model } from "mongoose";
import { connectToDatabase } from "@/lib/mongoose";
import { accountKey } from "@/lib/rateLimit";
import { disconnectCalendar, type CalendarDeps } from "@/lib/calendarServer";
import { withdraw } from "@/lib/studyServer";
import { Alarm } from "@/models/Alarm";
import { BehaviorEvent } from "@/models/BehaviorEvent";
import { BuddyAlert, BuddyInvite, BuddyPair, PushToken } from "@/models/Buddy";
import { CalendarConnection } from "@/models/CalendarConnection";
import { ContextSnapshot } from "@/models/ContextSnapshot";
import { ModelFeedback } from "@/models/ModelFeedback";
import { Assignment, Randomisation } from "@/models/Randomisation";
import { RateLimit } from "@/models/RateLimit";
import { RequestKey } from "@/models/RequestKey";
import { RlPolicy } from "@/models/RlPolicy";
import { ScreenNight } from "@/models/ScreenNight";
import { SleepLog } from "@/models/SleepLog";
import { Enrollment, Study, StudyCode } from "@/models/Study";
import { ErrorEvent } from "@/models/ErrorEvent";
import { Outage, ServiceStatus } from "@/models/ServiceStatus";
import { Task } from "@/models/Task";
import { TelemetryConsent } from "@/models/TelemetryConsent";
import { User } from "@/models/User";
import { NightPlan, WakeReport } from "@/models/WakeReport";
import { WakeTelemetry } from "@/models/WakeTelemetry";

/** Who an account is, as the stored records refer to it. */
export interface Who {
  id: string;
  email: string;
}

type Doc = Record<string, unknown>;

export interface Holding {
  /** The export's key, and the deletion summary's. */
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>;
  /** legal/PRIVACY.md's section that describes it. */
  policy: string;
  /** This account's documents. */
  mine: (who: Who) => Doc;
  /** Left out of the export (and why, in `notExported`). Never another person's identifiers. */
  exportAs?: (doc: Doc, who: Who) => Doc;
  /** Not in the export at all: holds nothing a person would recognise as theirs. */
  noExport?: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const without = (doc: Doc, ...fields: string[]) => {
  const out = { ...doc };
  for (const f of fields) {
    delete out[f];
  }
  return out;
};

export const HOLDINGS: Holding[] = [
  {
    name: "account", model: User, policy: "Your account",
    mine: (w) => ({ _id: w.id }),
    exportAs: (d) => without(d, "passwordHash"),
  },
  { name: "alarms", model: Alarm, policy: "Alarms and tasks", mine: (w) => ({ userId: w.id }) },
  { name: "tasks", model: Task, policy: "Alarms and tasks", mine: (w) => ({ userId: w.id }) },
  { name: "sleepLogs", model: SleepLog, policy: "Sleep", mine: (w) => ({ userId: w.id }) },
  { name: "nightPlans", model: NightPlan, policy: "Sleep", mine: (w) => ({ userId: w.id }) },
  { name: "wakeReports", model: WakeReport, policy: "Sleep", mine: (w) => ({ userId: w.id }) },
  { name: "screenNights", model: ScreenNight, policy: "Screen time before bed", mine: (w) => ({ userId: w.id }) },
  { name: "events", model: BehaviorEvent, policy: "How you use alarms", mine: (w) => ({ userId: w.id }) },
  { name: "contextSnapshots", model: ContextSnapshot, policy: "Weather and location", mine: (w) => ({ userId: w.id }) },
  { name: "predictionFeedback", model: ModelFeedback, policy: "How you use alarms", mine: (w) => ({ userId: w.id }) },
  { name: "learnedPreferences", model: RlPolicy, policy: "How you use alarms", mine: (w) => ({ userId: w.id }) },
  { name: "telemetryConsent", model: TelemetryConsent, policy: "Alarm telemetry", mine: (w) => ({ userId: w.id }) },
  { name: "telemetry", model: WakeTelemetry, policy: "Alarm telemetry", mine: (w) => ({ userId: w.id }) },
  { name: "randomisation", model: Randomisation, policy: "Research study", mine: (w) => ({ userId: w.id }) },
  { name: "randomisationAssignments", model: Assignment, policy: "Research study", mine: (w) => ({ userId: w.id }) },
  { name: "studyEnrolment", model: Enrollment, policy: "Research study", mine: (w) => ({ userId: w.id }) },
  {
    name: "calendarConnection", model: CalendarConnection, policy: "Google Calendar",
    mine: (w) => ({ userId: w.id }),
    exportAs: (d) => without(d, "refreshTokenSealed"),
  },
  {
    name: "pushTokens", model: PushToken, policy: "Wake buddy",
    mine: (w) => ({ userId: w.id }),
    exportAs: (d) => without(d, "token"),
  },
  { name: "buddyInvites", model: BuddyInvite, policy: "Wake buddy", mine: (w) => ({ userId: w.id }) },
  {
    // A pairing is between two people: deleting either account deletes it.
    name: "buddyPairings", model: BuddyPair, policy: "Wake buddy",
    mine: (w) => ({ $or: [{ ownerId: w.id }, { requesterId: w.id }] }),
    exportAs: (d, w) => ({
      ...without(d, "ownerId", "requesterId", "closedBy"),
      you: d.ownerId === w.id ? "shared the invite" : "asked to pair",
      closedBy: d.closedBy === undefined ? undefined : d.closedBy === w.id ? "you" : "the other person",
    }),
  },
  {
    // Alerts about you (you were asleep), and alerts to you (you were someone's buddy).
    name: "buddyAlerts", model: BuddyAlert, policy: "Wake buddy",
    mine: (w) => ({ $or: [{ sleeperId: w.id }, { buddyId: w.id }] }),
    exportAs: (d, w) => ({
      ...without(d, "sleeperId", "buddyId", "pairId", ...(d.sleeperId === w.id ? [] : ["alarmId", "occurrence"])),
      about: d.sleeperId === w.id ? "you" : "someone you were buddy for",
    }),
  },
  {
    name: "resendKeys", model: RequestKey, policy: "Alarms and tasks",
    mine: (w) => ({ userId: w.id }),
    noExport: "the ids of calls your phone sent, with the answers they got, kept 30 days so a call sent twice is recorded once",
  },
  {
    name: "rateLimitCounts", model: RateLimit, policy: "Security",
    // Keys: "<policy>|user:<id>|<window>" and "sign-in-account|account:<sha256 of email>|<window>".
    mine: (w) => ({ _id: { $regex: `\\|(user:${escape(w.id)}|${escape(accountKey(w.email))})\\|` } }),
    noExport: "counts of recent requests, kept for at most two of their windows (two hours at most), for rate limiting",
  },
];

/** Models that hold nothing about any one person. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const NOT_PERSONAL: { model: Model<any>; reason: string }[] = [
  { model: Study, reason: "the study's settings and how many people have left it, a number" },
  { model: StudyCode, reason: "enrolment codes as hashes, with how many times each was used, never by whom" },
  { model: ServiceStatus, reason: "whether the AI Brain is up, from the uptime check" },
  { model: Outage, reason: "when the AI Brain was down, and the alerts sent about it" },
  { model: ErrorEvent, reason: "error reports, with email addresses, ids, tokens and numbers removed and no account recorded (lib/errorTracking.ts)" },
];

const plain = (d: Doc): Doc => {
  const out = without(d, "__v");
  if (out._id !== undefined) {
    out._id = String(out._id);
  }
  return out;
};

export interface AccountExport {
  format: "somniai-export-1";
  exportedAt: string;
  data: Record<string, Doc[]>;
  notIncluded: string[];
}

/** Everything stored about this account, as the person would recognise it. */
export async function exportAccount(userId: string, now = new Date()): Promise<AccountExport | null> {
  await connectToDatabase();
  const user = await User.findById(userId).lean<{ email: string }>();
  if (!user) {
    return null;
  }
  const who: Who = { id: userId, email: user.email };
  const data: Record<string, Doc[]> = {};
  for (const h of HOLDINGS) {
    if (h.noExport) {
      continue;
    }
    const docs = await h.model.find(h.mine(who)).lean<Doc[]>();
    data[h.name] = docs.map((d) => plain(h.exportAs ? h.exportAs(d, who) : d));
  }
  return {
    format: "somniai-export-1",
    exportedAt: now.toISOString(),
    data,
    notIncluded: [
      "your password, which is stored only as a one-way hash",
      "the Google Calendar access grant, which is stored encrypted and works only for this app",
      "your phones' push addresses, which work only for this app",
      "the other person's identity in a buddy pairing or alert",
      ...HOLDINGS.filter((h) => h.noExport).map((h) => h.noExport!),
      "anything your phone hasn't sent yet: it is on the phone, and deleting the account clears it there",
    ],
  };
}

export interface AccountSummary {
  email: string;
  hasPassword: boolean;
  /** Records stored, by kind (the export's names), leaving out the rate-limit counts. */
  records: Record<string, number>;
}

/** What the account page shows: whose account, how it signs in, and how much is stored. */
export async function accountSummary(userId: string): Promise<AccountSummary | null> {
  await connectToDatabase();
  const user = await User.findById(userId).select("+passwordHash").lean<{ email: string; passwordHash?: string }>();
  if (!user) {
    return null;
  }
  const who: Who = { id: userId, email: user.email };
  const records: Record<string, number> = {};
  for (const h of HOLDINGS) {
    if (!h.noExport && h.model !== User) {
      records[h.name] = await h.model.countDocuments(h.mine(who));
    }
  }
  return { email: user.email, hasPassword: Boolean(user.passwordHash), records };
}

export interface Deletion {
  /** Whether Google confirmed it dropped the calendar grant; null with no calendar connected. */
  calendarRevokedAtGoogle: boolean | null;
  /** Whether the account was taking part in the study and has now left it. */
  leftStudy: boolean;
  /** Documents deleted, by kind. */
  deleted: Record<string, number>;
}

/**
 * Deletes the account and everything stored about it. Safe to run again if it
 * stops part way: the account itself goes last, so it can be signed into and
 * deleted again until everything is gone.
 */
export async function deleteAccount(userId: string, calendar: CalendarDeps): Promise<Deletion | null> {
  await connectToDatabase();
  const user = await User.findById(userId).lean<{ email: string }>();
  if (!user) {
    return null;
  }
  const who: Who = { id: userId, email: user.email };

  // Leaving the study first counts the departure (the study's one aggregate
  // number) and removes the study arms from alarm plans, as leaving always does.
  let leftStudy = false;
  if (await Enrollment.exists({ userId })) {
    await withdraw(userId);
    leftStudy = true;
  }
  // Asking Google to drop the grant: best effort, the connection goes either way.
  const cal = await disconnectCalendar(userId, calendar);

  const deleted: Record<string, number> = {};
  for (const h of [...HOLDINGS.filter((x) => x.model !== User), HOLDINGS.find((x) => x.model === User)!]) {
    const res = await h.model.deleteMany(h.mine(who));
    deleted[h.name] = (deleted[h.name] ?? 0) + (res.deletedCount ?? 0);
  }
  return { calendarRevokedAtGoogle: cal ? cal.revokedAtGoogle : null, leftStudy, deleted };
}

/** For tests: the strings that identify an account in stored records. */
export function identifiers(who: Who): string[] {
  return [who.id, who.email, accountKey(who.email).slice("account:".length)];
}
