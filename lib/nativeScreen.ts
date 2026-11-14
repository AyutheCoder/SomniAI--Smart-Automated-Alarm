// Screen time before bed, from the page in the app (prompt 4.3): the phone
// measures it from Android's usage records (ScreenNights.java), this passes it
// the sleep log's bedtimes, sends the nights to the server, and says what
// happened in words. Without Usage access nothing is read or sent, and
// predictions leave screen time out.

import { SomniAlarm, type SomniAlarmPlugin } from "./nativeAlarm";
import type { NativeConnection } from "./nativeSync";

/** The plugin version with screen time. */
export const SCREEN_API = 6;

export function hasScreenTime(native: NativeConnection | null): boolean {
  return native !== null && "api" in native && native.api >= SCREEN_API;
}

/** Why SomniAI asks for Usage access, shown before Settings is opened. */
export const SCREEN_WHY = [
  "Using your phone in the hours before bed changes how well you sleep and how easily you wake, "
  + "so it's one of the things SomniAI's predictions and bedtime plan weigh.",
  "To measure it, SomniAI needs Android's Usage access. It counts how many minutes your phone was in use "
  + "in the 3 hours before you went to bed, once a night. Only that number leaves your phone: never which apps, "
  + "sites or messages.",
  "You turn it on in Settings, and can turn it off there at any time: then nothing more is measured, and nights "
  + "already measured stop counting once they're a week old. Without it, predictions simply leave screen time out.",
] as const;

export type ScreenImport =
  | { state: "measured"; nights: number; added: number; updated: number; unchanged: number; inProgress: boolean }
  | { state: "not_allowed" }
  | { state: "failed"; reason: string };

type Get = (path: string) => Promise<{ ok: boolean; data?: unknown }>;
type Post = (path: string, body: unknown) => Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>;

const getJson: Get = async (path) => {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => null) as { ok?: boolean; data?: unknown } | null;
  return { ok: res.ok && json?.ok === true, data: json?.data };
};

const postJson: Post = async (path, body) => {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null) as { data?: unknown; error?: string } | null;
  return { ok: res.ok, status: res.status, data: json?.data, error: json?.error };
};

interface LogItem { date?: unknown; sleepTime?: unknown; source?: unknown }

/** The sleep log's bedtimes by wake date, for the phone's window. Simulated nights aren't bedtimes. */
export function bedtimesFrom(items: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(items)) {
    return out;
  }
  for (const item of items as LogItem[]) {
    if (typeof item?.date !== "string" || typeof item.sleepTime !== "string" || item.source === "simulated") {
      continue;
    }
    const t = Date.parse(item.sleepTime);
    if (!Number.isNaN(t)) {
      out[item.date] = new Date(t).toISOString();
    }
  }
  return out;
}

/** Measures the last week on the phone and sends it to the server. */
export async function importScreenTime(
  plugin: Pick<SomniAlarmPlugin, "screenTimeStatus" | "readScreenTime"> = SomniAlarm,
  get: Get = getJson,
  post: Post = postJson,
): Promise<ScreenImport> {
  let allowed: boolean;
  try {
    allowed = (await plugin.screenTimeStatus()).allowed;
  }
  catch (e) {
    return { state: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
  if (!allowed) {
    return { state: "not_allowed" };
  }
  // Without the sleep log the phone reads bed itself: still a measurement, and each night says which.
  const logs = await get("/api/sleep-logs?limit=14").catch(() => ({ ok: false, data: undefined }));
  const bedtimes = logs.ok ? bedtimesFrom((logs.data as { items?: unknown } | undefined)?.items) : {};
  let read;
  try {
    read = await plugin.readScreenTime({ bedtimes });
  }
  catch (e) {
    return { state: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
  if (!read.allowed) {
    return { state: "not_allowed" };
  }
  const inProgress = read.skipped.some((s) => s.endsWith(": in_progress"));
  if (read.nights.length === 0) {
    return { state: "measured", nights: 0, added: 0, updated: 0, unchanged: 0, inProgress };
  }
  let res;
  try {
    res = await post("/api/screen-time", { nights: read.nights });
  }
  catch {
    return { state: "failed", reason: "Couldn't reach the server. It's tried again next time the app opens." };
  }
  if (!res.ok) {
    return { state: "failed", reason: res.error ?? `The server said ${res.status}.` };
  }
  const r = res.data as { added: number; updated: number; unchanged: number };
  return { state: "measured", nights: read.nights.length, ...r, inProgress };
}

/**
 * What happened, in words. {@code measuredRecently}: whether the server still
 * has nights from the last week, which predictions use until they're a week
 * old even with Usage access off.
 */
export function screenText(r: ScreenImport, measuredRecently = false): string {
  switch (r.state) {
    case "not_allowed":
      return measuredRecently
        ? "Usage access is off, so no more screen time is measured. The nights already measured count until they're a week old."
        : "Usage access is off, so screen time isn't measured. Predictions leave it out.";
    case "failed":
      return `Couldn't measure screen time: ${r.reason}`;
    case "measured": {
      const parts = r.nights === 0
        ? ["No night in the last week could be measured yet."]
        : [`Measured ${r.nights} ${r.nights === 1 ? "night" : "nights"}: ${r.added} added, ${r.updated} updated, ${r.unchanged} unchanged.`];
      if (r.inProgress) {
        parts.push("Last night is measured once you're up.");
      }
      return parts.join(" ");
    }
  }
}
