// Study mode (prompt 6.2): enrolment by code, the versioned consent,
// withdrawal with deletion, and the anonymised export. Server-only.
//
// Enrolling starts the study's randomisation (6.1) and alarm telemetry (5.1)
// under the study's consent, and randomises the alarms already set. Leaving
// stops both, deletes everything collected for the study (the assignments,
// the study arms in alarm plans, telemetry recorded since joining) and the
// enrolment itself, the only link between the account and the participant
// code. The export carries that code, study days and times of day, never a
// name, email, account id, alarm id or alarm label.

import { createHash, randomBytes, randomInt } from "node:crypto";
import { regularityLabels } from "@/lib/wakeProxy";
import { localHour } from "@/lib/personalServer";
import { refreshRingPlans } from "@/lib/ringPlanServer";
import { startRandomisation, stopRandomisation } from "@/lib/randomisationServer";
import { STUDY_CONSENT, STUDY_ID, type ConsentDocument } from "@/lib/studyConsent";
import { setConsent } from "@/lib/telemetry";
import { modelSleepLogFilter } from "@/lib/provenance";
import { Alarm } from "@/models/Alarm";
import { Assignment, Randomisation, type AssignmentDocument } from "@/models/Randomisation";
import { SleepLog } from "@/models/SleepLog";
import { Enrollment, Study, StudyCode, type EnrollmentDocument, type StudyDocument } from "@/models/Study";
import { WakeTelemetry, type WakeTelemetryDocument } from "@/models/WakeTelemetry";

const DAY = 86_400_000;
/** No 0/O, 1/I/L: a code read out or copied by hand stays right. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

export function hashCode(code: string): string {
  return createHash("sha256").update(`somni-study:${normaliseCode(code)}`).digest("hex");
}

export function newCode(): string {
  const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

/** The study, created with a random seed the first time. */
export async function ensureStudy(now = new Date()): Promise<StudyDocument> {
  const doc = await Study.findOneAndUpdate(
    { studyId: STUDY_ID },
    { $setOnInsert: { studyId: STUDY_ID, experiment: "wake_plan", seed: randomBytes(8).toString("hex"), withdrawn: 0, createdAt: now } },
    { upsert: true, new: true, lean: true },
  );
  return doc as unknown as StudyDocument;
}

/** Makes enrolment codes and stores only their hashes. The plain codes are returned once, to hand out. */
export async function createCodes(count: number, opts: { maxUses?: number; expiresAt?: Date | null } = {}, now = new Date()): Promise<string[]> {
  await ensureStudy(now);
  const codes = Array.from({ length: count }, newCode);
  await StudyCode.insertMany(codes.map((c) => ({
    studyId: STUDY_ID, codeHash: hashCode(c), uses: 0, maxUses: opts.maxUses ?? 1, expiresAt: opts.expiresAt ?? null, createdAt: now,
  })));
  return codes;
}

export interface StudyState {
  consent: ConsentDocument;
  enrolment: { participantId: string; consentVersion: string; consentedAt: string } | null;
}

export async function studyState(userId: string): Promise<StudyState> {
  const e = await Enrollment.findOne({ userId }).lean<EnrollmentDocument>();
  return {
    consent: STUDY_CONSENT,
    enrolment: e ? { participantId: e.participantId, consentVersion: e.consentVersion, consentedAt: e.consentedAt.toISOString() } : null,
  };
}

export class StudyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** One message for a code that doesn't exist, was used up or has expired: no telling which. */
const BAD_CODE = "That code isn't valid, or has already been used.";

export async function enrol(userId: string, code: string, consentVersion: string, tz: string, now = new Date()): Promise<StudyState> {
  if (consentVersion !== STUDY_CONSENT.version) {
    throw new StudyError(422, `consent must be to the current document, ${STUDY_CONSENT.version}`);
  }
  if (await Enrollment.exists({ userId })) {
    throw new StudyError(409, "You're already taking part.");
  }
  // Take one use of the code, atomically, only if it has uses left and hasn't expired.
  const taken = await StudyCode.findOneAndUpdate(
    { codeHash: hashCode(code), $expr: { $lt: ["$uses", "$maxUses"] }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
    { $inc: { uses: 1 } },
    { new: true },
  );
  if (!taken) {
    throw new StudyError(422, BAD_CODE);
  }
  const study = await ensureStudy(now);
  let participantId = "";
  for (let i = 0; i < 5 && !participantId; i++) {
    const candidate = `P-${randomBytes(4).toString("hex").toUpperCase()}`;
    if (!(await Enrollment.exists({ participantId: candidate }))) {
      participantId = candidate;
    }
  }
  try {
    await Enrollment.create({ userId, studyId: study.studyId, participantId, consentVersion, consentedAt: now, tz });
  }
  catch (e) {
    // Lost a race with another enrolment of the same account: give the code's use back.
    await StudyCode.updateOne({ _id: taken._id }, { $inc: { uses: -1 } });
    throw (e as { code?: number }).code === 11000 ? new StudyError(409, "You're already taking part.") : e;
  }
  await startRandomisation(userId, study.experiment, study.seed, now);
  await setConsent(userId, true, now);
  await refreshRingPlans(userId);
  return studyState(userId);
}

export interface Withdrawal {
  deletedAssignments: number;
  deletedWakes: number;
}

/** Leaves the study and deletes what it collected. Idempotent: leaving twice deletes nothing more. */
export async function withdraw(userId: string, now = new Date()): Promise<Withdrawal> {
  const e = await Enrollment.findOne({ userId }).lean<EnrollmentDocument>();
  if (!e) {
    throw new StudyError(404, "You're not taking part in a study.");
  }
  const study = await ensureStudy(now);
  await stopRandomisation(userId, now);
  const assignments = await Assignment.deleteMany({ userId, seed: study.seed });
  await Randomisation.deleteMany({ userId, seed: study.seed });
  const wakes = await WakeTelemetry.deleteMany({ userId, firstRingAt: { $gte: e.consentedAt } });
  await setConsent(userId, false, now);
  // The arms written into alarm plans are study data too.
  await Alarm.updateMany({ userId }, { $unset: { "ringPlan.study": 1 }, $pull: { "ringPlan.adjustments": { $regex: "^Study:" } } });
  await refreshRingPlans(userId);
  await Enrollment.deleteOne({ userId });
  await Study.updateOne({ studyId: study.studyId }, { $inc: { withdrawn: 1 } });
  return { deletedAssignments: assignments.deletedCount ?? 0, deletedWakes: wakes.deletedCount ?? 0 };
}

// --- the anonymised export -------------------------------------------------

const clock = (hours: number) => {
  const m = Math.round(hours * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Days from the participant's enrolment date to `date` (YYYY-MM-DD), in their own timezone. */
function studyDay(enrolledLocalDate: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${enrolledLocalDate}T00:00:00Z`)) / DAY);
}

function localDate(t: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  }
  catch {
    return t.toISOString().slice(0, 10);
  }
}

interface Log { date: string; sleepTime?: Date | null; wakeTime?: Date | null; durationHours?: number }

export async function exportStudy(now = new Date()) {
  const study = await ensureStudy(now);
  const enrolments = await Enrollment.find({ studyId: study.studyId }).sort({ participantId: 1 }).lean<EnrollmentDocument[]>();
  const participants = [];
  for (const e of enrolments) {
    const start = localDate(e.consentedAt, e.tz);
    const [assignments, logs, wakes] = await Promise.all([
      Assignment.find({ userId: e.userId, seed: study.seed }).sort({ assignedAt: 1 }).lean<AssignmentDocument[]>(),
      SleepLog.find({ userId: e.userId, ...modelSleepLogFilter(false) }).sort({ date: 1 }).lean<Log[]>(),
      WakeTelemetry.find({ userId: e.userId, firstRingAt: { $gte: e.consentedAt } }).sort({ firstRingAt: 1 }).lean<WakeTelemetryDocument[]>(),
    ]);
    // Alarms by number within the participant, in the order they were assigned: never their ids or names.
    const alarmNumber = new Map(assignments.map((a, i) => [a.alarmId, i + 1]));
    const armOf = new Map(assignments.map((a) => [a.alarmId, a.excluded ? "excluded_unmissable" : a.arm]));
    // The label needs each night's history, so it is worked out over every night, then only the study's are kept.
    const labels = regularityLabels(logs.map((l) => ({ date: l.date, wakeHour: l.wakeTime ? localHour(new Date(l.wakeTime), e.tz) : null })));
    participants.push({
      participant: e.participantId,
      consentVersion: e.consentVersion,
      assignments: assignments.map((a) => ({
        alarm: alarmNumber.get(a.alarmId),
        day: studyDay(start, localDate(a.assignedAt, e.tz)),
        sequence: a.sequence,
        block: a.block,
        arm: a.arm,
        excluded: a.excluded,
        overridden: a.overriddenAt !== null,
      })),
      nights: logs.flatMap((l, i) => (l.date < start ? [] : [{
        day: studyDay(start, l.date),
        weekend: [0, 6].includes(new Date(`${l.date}T00:00:00Z`).getUTCDay()),
        sleepHours: typeof l.durationHours === "number" ? l.durationHours : null,
        bedtime: l.sleepTime ? clock(localHour(new Date(l.sleepTime), e.tz)) : null,
        wake: l.wakeTime ? clock(localHour(new Date(l.wakeTime), e.tz)) : null,
        regular: labels[i],
      }])),
      wakes: wakes.map((w) => ({
        alarm: alarmNumber.get(w.alarmId) ?? null,
        arm: armOf.get(w.alarmId) ?? "not_assigned",
        day: studyDay(start, localDate(w.firstRingAt, e.tz)),
        firstRing: clock(localHour(w.firstRingAt, e.tz)),
        outcome: w.outcome,
        snoozes: w.snoozes,
        firstInteractionMs: w.firstInteractionMs,
        stageReached: w.stageReached,
        verification: { required: w.verification.required, result: w.verification.result, attempts: w.verification.attempts ?? null,
          timeOnTaskMs: w.verification.timeOnTaskMs ?? null },
        rings: w.rings.length,
      })),
    });
  }
  return {
    study: study.studyId,
    experiment: study.experiment,
    exportedOn: now.toISOString().slice(0, 10),
    consentVersion: STUDY_CONSENT.version,
    participants: participants.length,
    withdrawn: study.withdrawn,
    fields: "Days count from each participant's enrolment day (0); times are the participant's local times of day. "
      + "regular is the method paper's wake-time regularity label (null: no usual wake time yet).",
    data: participants,
  };
}
