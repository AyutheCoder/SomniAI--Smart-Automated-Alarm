// Telemetry from the page (prompt 5.1): giving, withdrawing, deleting, and
// keeping the phone's consent in step with the account's. The phone records
// only with consent it holds itself (WakeTelemetry.java), so every change here
// reaches it; withdrawing or deleting also drops what it hasn't sent yet.

import type { PhoneTelemetry, SomniAlarmPlugin } from "./nativeAlarm";
import type { NativeConnection } from "./nativeSync";
import { TELEMETRY_CONSENT, type TelemetryConsentState } from "./telemetryConsent";

/** The plugin version with telemetry and the ring screen's snooze. */
export const TELEMETRY_API = 7;

export function hasTelemetry(native: NativeConnection | null): boolean {
  return native !== null && "api" in native && native.api >= TELEMETRY_API;
}

type Phone = Pick<SomniAlarmPlugin, "telemetryStatus" | "setTelemetryConsent" | "clearTelemetry">;
type Call = (method: "PUT" | "DELETE", path: string, body?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>;

const call: Call = async (method, path, body) => {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null) as { ok?: boolean; data?: unknown; error?: string } | null;
  return { ok: res.ok && json?.ok === true, data: json?.data, error: json?.error ?? (res.ok ? undefined : `The server said ${res.status}.`) };
};

/** The server's reason, without a closing full stop, to put inside a sentence. */
const said = (error: string | undefined) => (error ?? "no answer").replace(/\.$/, "");

/** What the phone must be told so it matches the account; null when it already does. */
export function phoneNeeds(account: Pick<TelemetryConsentState, "granted" | "version">, phone: Pick<PhoneTelemetry, "granted" | "version">):
  { granted: boolean; version?: string } | null {
  if (account.granted && account.version) {
    return phone.granted && phone.version === account.version ? null : { granted: true, version: account.version };
  }
  return phone.granted ? { granted: false } : null;
}

/** Brings the phone in step with the account, on opening the app. Returns what changed there. */
export async function syncPhone(phone: Phone, account: TelemetryConsentState): Promise<"granted" | "withdrawn" | null> {
  const need = phoneNeeds(account, await phone.telemetryStatus());
  if (!need) {
    return null;
  }
  await phone.setTelemetryConsent(need);
  return need.granted ? "granted" : "withdrawn";
}

export type Outcome = { ok: true; text: string; consent?: TelemetryConsentState } | { ok: false; text: string };

export async function allow(phone: Phone | null, put: Call = call): Promise<Outcome> {
  const res = await put("PUT", "/api/telemetry/consent", { granted: true, version: TELEMETRY_CONSENT.version });
  if (!res.ok) {
    return { ok: false, text: `Couldn't turn telemetry on: ${said(res.error)}.` };
  }
  const consent = res.data as TelemetryConsentState;
  if (phone) {
    await phone.setTelemetryConsent({ granted: true, version: TELEMETRY_CONSENT.version });
  }
  return {
    ok: true,
    consent,
    text: phone
      ? "Telemetry is on. It starts with the next alarm that rings on this phone."
      : "Telemetry is on. It starts with the next alarm that rings in the SomniAI Android app.",
  };
}

export async function withdraw(phone: Phone | null, put: Call = call): Promise<Outcome> {
  // The phone first: from this moment it records nothing, whatever the network does.
  const dropped = phone ? (await phone.setTelemetryConsent({ granted: false })).dropped : 0;
  const res = await put("PUT", "/api/telemetry/consent", { granted: false });
  if (!res.ok) {
    return { ok: false, text: `This phone stopped recording, but the account couldn't be updated: ${said(res.error)}. Try again.` };
  }
  return {
    ok: true,
    consent: res.data as TelemetryConsentState,
    text: "Telemetry is off. Nothing more is recorded."
      + (dropped > 0 ? ` ${dropped} ${dropped === 1 ? "wake" : "wakes"} not yet sent from this phone ${dropped === 1 ? "was" : "were"} dropped.` : "")
      + " What was already recorded stays until you delete it.",
  };
}

export async function deleteEverything(phone: Phone | null, del: Call = call): Promise<Outcome> {
  // The phone's unsent wakes go first, so none arrives after the deletion
  // (the server refuses one from before it anyway).
  const dropped = phone ? (await phone.clearTelemetry()).dropped : 0;
  const res = await del("DELETE", "/api/telemetry");
  if (!res.ok) {
    return { ok: false, text: `Couldn't delete: ${said(res.error)}. Nothing on the server was deleted; try again.` };
  }
  const deleted = (res.data as { deleted: number }).deleted;
  return {
    ok: true,
    text: `Deleted ${deleted} recorded ${deleted === 1 ? "wake" : "wakes"}`
      + (dropped > 0 ? `, and ${dropped} not yet sent from this phone` : "") + ".",
  };
}

/** "4.3 s" / "1 min 2 s" for a time to first interaction. */
export function interactionText(ms: number | null): string {
  if (ms === null) {
    return "untouched";
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}
