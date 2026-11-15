// Uptime monitoring for the AI Brain (prompt 7.3). The scheduler that runs
// the buddy alerts calls /api/cron/ai-brain-health every minute; each call
// asks the AI Brain's /health, keeps the result in ServiceStatus, opens or
// closes an Outage, and sends one alert when an outage starts and one when it
// ends (lib/opsAlert.ts).
//
// "Down" needs DOWN_AFTER failed checks in a row, so one slow answer doesn't
// page anyone; the outage is dated from the first of them. "Up" again needs one
// good answer. Running but without its models counts as down: every prediction
// would fail. While it's down the app's own rules answer, and alarms never
// depended on it (lib/ringPlan.ts).

import type { AlertResult } from "@/lib/opsAlert";
import type { ServiceState } from "@/models/ServiceStatus";

export const AI_BRAIN = "ai-brain";
export const DOWN_AFTER = 2;
/** A status older than this means the checks aren't running: shown as "unknown", not as up or down. */
export const STALE_AFTER_MS = 5 * 60_000;

export type Probe = { ok: true } | { ok: false; reason: string };

export interface Status {
  state: ServiceState;
  since: Date;
  checkedAt: Date;
  failures: number;
  /** When the current run of failed checks began. */
  failingSince?: Date | null;
  reason?: string | null;
}

type Fetch = (url: string, init: { signal?: AbortSignal; cache?: RequestCache }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function probeAiBrain(base: string, fetchFn: Fetch, timeoutMs: number): Promise<Probe> {
  try {
    const res = await fetchFn(`${base.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) {
      return { ok: false, reason: `it answered ${res.status}` };
    }
    const body = (await res.json()) as { modelsLoaded?: unknown };
    return body?.modelsLoaded === true ? { ok: true } : { ok: false, reason: "it is running but its models aren't loaded" };
  }
  catch (e) {
    const err = e as { name?: string; message?: string; cause?: { code?: string } };
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { ok: false, reason: `no answer within ${Math.round(timeoutMs / 100) / 10} s` };
    }
    return { ok: false, reason: `couldn't connect (${err.cause?.code ?? err.message ?? "unknown error"})` };
  }
}

/** The next status after a check, and whether an outage starts ("down") or ends ("up"). */
export function nextStatus(prev: Status | null, probe: Probe, now: Date): { status: Status; event: "down" | "up" | null } {
  if (probe.ok) {
    const wasDown = prev?.state === "down";
    const since = prev && prev.state === "up" ? prev.since : now;
    return { status: { state: "up", since, checkedAt: now, failures: 0, failingSince: null, reason: null }, event: wasDown ? "up" : null };
  }
  const failures = (prev?.state === "not_configured" ? 0 : prev?.failures ?? 0) + 1;
  const failingSince = failures === 1 ? now : prev?.failingSince ?? now;
  if (prev?.state === "down") {
    return { status: { ...prev, checkedAt: now, failures, reason: probe.reason }, event: null };
  }
  if (failures >= DOWN_AFTER) {
    return { status: { state: "down", since: failingSince, checkedAt: now, failures, failingSince, reason: probe.reason }, event: "down" };
  }
  // One failure isn't an outage yet: still up (or, for a first check, up until shown otherwise).
  const since = prev && prev.state === "up" ? prev.since : now;
  return { status: { state: "up", since, checkedAt: now, failures, failingSince, reason: probe.reason }, event: null };
}

const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function downText(since: Date, reason: string): string {
  return `SomniAI: the AI Brain is down since ${utc(since)} (${reason}). Predictions and the wake planner use the app's own rules until it is back. Alarms are not affected.`;
}

export function upText(since: Date, now: Date): string {
  const minutes = Math.max(1, Math.round((now.getTime() - since.getTime()) / 60_000));
  return `SomniAI: the AI Brain is back, after ${minutes} min down (since ${utc(since)}).`;
}

export interface CheckDeps {
  url: string;
  fetch: Fetch;
  timeoutMs: number;
  now: Date;
  alert: (text: string) => Promise<AlertResult>;
}

export interface CheckResult {
  state: ServiceState;
  since: string;
  failures: number;
  reason: string | null;
  event: "down" | "up" | null;
  alert: AlertResult | null;
}

/** One check of the AI Brain, with its consequences stored and alerted. */
export async function checkAiBrain(deps: CheckDeps): Promise<CheckResult> {
  const { connectToDatabase } = await import("@/lib/mongoose");
  const { Outage, ServiceStatus } = await import("@/models/ServiceStatus");
  await connectToDatabase();
  const prev = await ServiceStatus.findOne({ service: AI_BRAIN }).lean<Status>();

  if (!deps.url) {
    const status: Status = { state: "not_configured", since: prev?.state === "not_configured" ? prev.since : deps.now, checkedAt: deps.now, failures: 0, failingSince: null, reason: null };
    await ServiceStatus.updateOne({ service: AI_BRAIN }, { $set: status }, { upsert: true });
    // Taking the AI Brain out of the configuration ends an outage it was in, without an alert.
    await Outage.updateMany({ service: AI_BRAIN, endedAt: null }, { $set: { endedAt: deps.now } });
    return { state: status.state, since: status.since.toISOString(), failures: 0, reason: null, event: null, alert: null };
  }

  const probe = await probeAiBrain(deps.url, deps.fetch, deps.timeoutMs);
  const { status, event } = nextStatus(prev, probe, deps.now);
  await ServiceStatus.updateOne({ service: AI_BRAIN }, { $set: status }, { upsert: true });

  let alert: AlertResult | null = null;
  if (event === "down") {
    alert = await deps.alert(downText(status.since, status.reason ?? "no reason given"));
    await Outage.create({ service: AI_BRAIN, startedAt: status.since, endedAt: null, reason: status.reason ?? "unknown", alerts: [{ about: "down", ...alert, at: deps.now }] });
  }
  else if (event === "up") {
    const open = await Outage.findOne({ service: AI_BRAIN, endedAt: null }).sort({ startedAt: -1 }).lean<{ _id: unknown; startedAt: Date }>();
    alert = await deps.alert(upText(open?.startedAt ?? prev?.since ?? deps.now, deps.now));
    if (open) {
      await Outage.updateOne({ _id: open._id }, { $set: { endedAt: deps.now }, $push: { alerts: { about: "up", ...alert, at: deps.now } } });
    }
  }
  return { state: status.state, since: status.since.toISOString(), failures: status.failures, reason: status.reason ?? null, event, alert };
}

export interface PublicStatus {
  state: ServiceState | "unknown";
  since: string | null;
}

/** What the app tells its users: up, down since when, or unknown when the checks aren't running. */
export async function aiBrainStatus(now = new Date()): Promise<PublicStatus> {
  const { connectToDatabase } = await import("@/lib/mongoose");
  const { ServiceStatus } = await import("@/models/ServiceStatus");
  await connectToDatabase();
  const s = await ServiceStatus.findOne({ service: AI_BRAIN }).lean<Status>();
  if (!s || now.getTime() - new Date(s.checkedAt).getTime() > STALE_AFTER_MS) {
    return { state: "unknown", since: null };
  }
  return { state: s.state, since: new Date(s.since).toISOString() };
}
