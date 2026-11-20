// Alarm telemetry on the server (prompt 5.1). The phone records a wake only
// with consent (WakeTelemetry.java); this checks again, so nothing is stored
// that wasn't consented to: a wake is kept only if consent is on now, under
// the version the wake was recorded with, was given before the wake began, and
// the wake began after the user last deleted their telemetry. Export and
// delete cover everything. Server-only.

import { TELEMETRY_CONSENT, type TelemetryConsentState } from "@/lib/telemetryConsent";
import { TelemetryConsent, type TelemetryConsentDocument } from "@/models/TelemetryConsent";
import { WakeTelemetry, type WakeTelemetryDocument } from "@/models/WakeTelemetry";

export interface WakeInput {
  alarmId: string;
  scheduledFor: string;
  consentVersion: string;
  firstRingAt: string;
  endedAt: string;
  outcome: "dismissed" | "unanswered";
  snoozes: number;
  firstInteractionMs: number | null;
  stageReached: { level: number; stage: string | null };
  verification: WakeTelemetryDocument["verification"];
  rings: {
    at: string;
    firstInteractionMs: number | null;
    via: "screen" | "key" | "notification" | null;
    durationMs: number;
    level: number;
    stage: string | null;
    outcome: "dismissed" | "snoozed" | "unanswered" | "interrupted";
  }[];
}

const DAY = 86_400_000;
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isTime = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
const isStage = (v: unknown) => v === null || (typeof v === "string" && v.length <= 40);
const RING_OUTCOMES = ["dismissed", "snoozed", "unanswered", "interrupted"];
const VIAS = ["screen", "key", "notification", null];

/** Why this isn't a wake as the phone sends it, or null. */
export function invalidWake(body: unknown, now = new Date()): string | null {
  if (!body || typeof body !== "object") {
    return "a wake is required";
  }
  const w = body as Record<string, unknown>;
  if (typeof w.alarmId !== "string" || w.alarmId.length === 0 || w.alarmId.length > 100) {
    return "alarmId is required";
  }
  for (const k of ["scheduledFor", "firstRingAt", "endedAt"]) {
    if (!isTime(w[k])) {
      return `${k} must be an ISO time`;
    }
  }
  const first = Date.parse(w.firstRingAt as string);
  const ended = Date.parse(w.endedAt as string);
  if (ended < first || ended - first > DAY || first > now.getTime() + 5 * 60_000) {
    return "firstRingAt and endedAt must be a wake within a day, not in the future";
  }
  if (typeof w.consentVersion !== "string" || w.consentVersion.length === 0) {
    return "consentVersion is required";
  }
  if (w.outcome !== "dismissed" && w.outcome !== "unanswered") {
    return "outcome must be dismissed or unanswered";
  }
  if (!isInt(w.snoozes, 0, 100)) {
    return "snoozes must be a count";
  }
  if (w.firstInteractionMs !== null && !isInt(w.firstInteractionMs, 0, DAY)) {
    return "firstInteractionMs must be whole milliseconds, or null";
  }
  const stage = w.stageReached as Record<string, unknown> | undefined;
  if (!stage || !isInt(stage.level, 0, 10) || !isStage(stage.stage)) {
    return "stageReached must be a level and its stage";
  }
  const v = w.verification as Record<string, unknown> | undefined;
  if (!v || typeof v.required !== "boolean" || !["passed", "not_required", "not_passed"].includes(v.result as string)) {
    return "verification must say whether a check was required and how it went";
  }
  if (v.result === "passed" && (!isInt(v.attempts, 0, 1000) || !isInt(v.steps, 1, 100) || !isInt(v.timeOnTaskMs, 0, DAY))) {
    return "a passed check needs attempts, steps and timeOnTaskMs";
  }
  if (!Array.isArray(w.rings) || w.rings.length === 0 || w.rings.length > 100) {
    return "rings must list the wake's rings";
  }
  if (w.rings.length !== (w.snoozes as number) + 1 + w.rings.filter((r) => (r as { outcome?: string })?.outcome === "interrupted").length) {
    return "rings must be one per snooze, plus the last, plus any interrupted";
  }
  for (const [i, r] of (w.rings as Record<string, unknown>[]).entries()) {
    if (!r || !isTime(r.at) || !isInt(r.durationMs, 0, DAY) || !isInt(r.level, 0, 10) || !isStage(r.stage)
      || !RING_OUTCOMES.includes(r.outcome as string) || !VIAS.includes(r.via as string | null)
      || (r.firstInteractionMs !== null && !isInt(r.firstInteractionMs, 0, DAY))) {
      return `rings[${i}] is not a ring`;
    }
  }
  return null;
}

/** Whether this consent covers a wake that began at `firstRingAt`, recorded under `version`. */
export function consentCovers(
  consent: Pick<TelemetryConsentDocument, "granted" | "version" | "grantedAt" | "deletedAt"> | null,
  version: string,
  firstRingAt: Date,
): boolean {
  return !!consent
    && consent.granted
    && consent.version === version
    && consent.grantedAt !== null && consent.grantedAt.getTime() <= firstRingAt.getTime()
    && (consent.deletedAt === null || firstRingAt.getTime() > consent.deletedAt.getTime());
}

const stateOf = (c: TelemetryConsentDocument | null): TelemetryConsentState => ({
  granted: !!c?.granted,
  version: c?.version ?? null,
  grantedAt: c?.grantedAt?.toISOString() ?? null,
  withdrawnAt: c?.withdrawnAt?.toISOString() ?? null,
});

export async function consentState(userId: string): Promise<TelemetryConsentState> {
  return stateOf(await TelemetryConsent.findOne({ userId }).lean<TelemetryConsentDocument>());
}

/** Gives (under the current text's version) or withdraws consent. */
export async function setConsent(userId: string, granted: boolean, now = new Date()): Promise<TelemetryConsentState> {
  const version = granted ? TELEMETRY_CONSENT.version : null;
  const update = granted
    ? { $set: { granted: true, version, grantedAt: now, withdrawnAt: null } }
    : { $set: { granted: false, version: null, withdrawnAt: now } };
  const doc = await TelemetryConsent.findOneAndUpdate(
    { userId },
    { ...update, $push: { history: { granted, version, at: now } } },
    { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
  );
  return stateOf(doc as unknown as TelemetryConsentDocument);
}

export type RecordResult = "stored" | "already_stored" | "no_consent";

export async function recordWake(userId: string, w: WakeInput, now = new Date()): Promise<RecordResult> {
  const consent = await TelemetryConsent.findOne({ userId }).lean<TelemetryConsentDocument>();
  if (!consentCovers(consent, w.consentVersion, new Date(w.firstRingAt))) {
    return "no_consent";
  }
  const doc = {
    userId,
    alarmId: w.alarmId,
    scheduledFor: new Date(w.scheduledFor),
    consentVersion: w.consentVersion,
    firstRingAt: new Date(w.firstRingAt),
    endedAt: new Date(w.endedAt),
    outcome: w.outcome,
    snoozes: w.snoozes,
    firstInteractionMs: w.firstInteractionMs,
    stageReached: w.stageReached,
    verification: w.verification,
    rings: w.rings.map((r) => ({ ...r, at: new Date(r.at) })),
    receivedAt: now,
  };
  const res = await WakeTelemetry.updateOne(
    { userId, alarmId: w.alarmId, scheduledFor: doc.scheduledFor },
    { $setOnInsert: doc },
    { upsert: true, runValidators: true },
  );
  return res.upsertedCount > 0 ? "stored" : "already_stored";
}

export interface TelemetrySummary {
  consent: TelemetryConsentState;
  current: { version: string };
  wakes: number;
  latest: { scheduledFor: string; outcome: string; snoozes: number; firstInteractionMs: number | null; stage: string | null }[];
}

export async function telemetrySummary(userId: string): Promise<TelemetrySummary> {
  const [consent, wakes, latest] = await Promise.all([
    consentState(userId),
    WakeTelemetry.countDocuments({ userId }),
    WakeTelemetry.find({ userId }).sort({ firstRingAt: -1 }).limit(5).lean<WakeTelemetryDocument[]>(),
  ]);
  return {
    consent,
    current: { version: TELEMETRY_CONSENT.version },
    wakes,
    latest: latest.map((w) => ({
      scheduledFor: w.scheduledFor.toISOString(),
      outcome: w.outcome,
      snoozes: w.snoozes,
      firstInteractionMs: w.firstInteractionMs,
      stage: w.stageReached?.stage ?? null,
    })),
  };
}

/** Everything held: the consent and its history, and every wake. */
export async function exportTelemetry(userId: string, now = new Date()) {
  const [consent, wakes] = await Promise.all([
    TelemetryConsent.findOne({ userId }).lean<TelemetryConsentDocument>(),
    WakeTelemetry.find({ userId }).sort({ firstRingAt: 1 }).lean<(WakeTelemetryDocument & { _id: unknown; __v?: number })[]>(),
  ]);
  return {
    exportedAt: now.toISOString(),
    consent: {
      ...stateOf(consent),
      deletedAt: consent?.deletedAt?.toISOString() ?? null,
      history: (consent?.history ?? []).map((h) => ({ granted: h.granted, version: h.version, at: new Date(h.at).toISOString() })),
    },
    wakes: wakes.map(({ _id, __v, userId: _u, ...w }) => {
      void _id; void __v; void _u;
      return w;
    }),
  };
}

/**
 * Deletes every wake. Consent stays as it is (withdrawing is its own choice),
 * and a wake from before now that the phone still had queued is refused later.
 */
export async function deleteTelemetry(userId: string, now = new Date()): Promise<{ deleted: number }> {
  const res = await WakeTelemetry.deleteMany({ userId });
  await TelemetryConsent.updateOne(
    { userId },
    { $set: { deletedAt: now }, $setOnInsert: { granted: false, version: null, grantedAt: null, withdrawnAt: null, history: [] } },
    { upsert: true },
  );
  return { deleted: res.deletedCount ?? 0 };
}
