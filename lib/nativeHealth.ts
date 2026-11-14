// Health Connect, from the page in the app (prompt 4.2): the phone reads and
// folds the nights (HealthNights.java), this sends them to the server's
// import, and says what happened in words. In a browser there is no Health
// Connect, and the page says the app reads it.

import { SomniAlarm, type HealthState, type SomniAlarmPlugin } from "./nativeAlarm";
import type { NativeConnection } from "./nativeSync";

/** The plugin version with Health Connect. */
export const HEALTH_API = 5;

const SLEEP = "android.permission.health.READ_SLEEP";
const RESTING_HR = "android.permission.health.READ_RESTING_HEART_RATE";

export function hasHealth(native: NativeConnection | null): boolean {
  return native !== null && "api" in native && native.api >= HEALTH_API;
}

export type HealthImport =
  | { state: "imported"; nights: number; added: number; updated: number; unchanged: number; keptManual: string[]; inProgress: number; heartRate: boolean }
  | { state: "unavailable"; status: HealthState["status"] }
  | { state: "not_allowed" }
  | { state: "failed"; reason: string };

type Post = (path: string, body: unknown) => Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>;

const postJson: Post = async (path, body) => {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null) as { data?: unknown; error?: string } | null;
  return { ok: res.ok, status: res.status, data: json?.data, error: json?.error };
};

/** Reads the last two weeks from Health Connect and sends them to the sleep log. */
export async function importFromHealthConnect(
  plugin: Pick<SomniAlarmPlugin, "healthStatus" | "readSleep"> = SomniAlarm,
  post: Post = postJson,
): Promise<HealthImport> {
  let state: HealthState;
  try {
    state = await plugin.healthStatus();
  }
  catch (e) {
    return { state: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
  if (state.status !== "available") {
    return { state: "unavailable", status: state.status };
  }
  if (!state.granted.includes(SLEEP)) {
    return { state: "not_allowed" };
  }
  let read;
  try {
    read = await plugin.readSleep();
  }
  catch (e) {
    return { state: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
  const inProgress = read.skipped.filter((s) => s.endsWith(": in_progress")).length;
  const heartRate = state.granted.includes(RESTING_HR);
  if (read.nights.length === 0) {
    return { state: "imported", nights: 0, added: 0, updated: 0, unchanged: 0, keptManual: [], inProgress, heartRate };
  }
  let res;
  try {
    res = await post("/api/sleep-logs/import", { nights: read.nights });
  }
  catch {
    return { state: "failed", reason: "Couldn't reach the server. It's tried again next time the app opens." };
  }
  if (!res.ok) {
    return { state: "failed", reason: res.error ?? `The server said ${res.status}.` };
  }
  const r = res.data as { added: number; updated: number; unchanged: number; keptManual: string[] };
  return { state: "imported", nights: read.nights.length, ...r, inProgress, heartRate };
}

const nightsWord = (n: number) => `${n} ${n === 1 ? "night" : "nights"}`;

export function importText(r: HealthImport): string {
  switch (r.state) {
    case "unavailable":
      return r.status === "not_installed"
        ? "Health Connect isn't on this phone. Install it, then connect."
        : "Health Connect needs an update before SomniAI can read it.";
    case "not_allowed":
      return "SomniAI isn't allowed to read sleep from Health Connect yet.";
    case "failed":
      return `Couldn't read Health Connect: ${r.reason}`;
    case "imported": {
      const parts = r.nights === 0
        ? ["No sleep recorded in Health Connect in the last two weeks."]
        : [`Read ${nightsWord(r.nights)} from Health Connect: ${r.added} added, ${r.updated} updated, ${r.unchanged} unchanged.`];
      if (r.keptManual.length > 0) {
        parts.push(`${nightsWord(r.keptManual.length)} you entered yourself ${r.keptManual.length === 1 ? "was" : "were"} kept as you wrote ${r.keptManual.length === 1 ? "it" : "them"}.`);
      }
      if (r.inProgress > 0) {
        parts.push("A sleep still being recorded is read next time.");
      }
      if (!r.heartRate) {
        parts.push("Resting heart rate isn't allowed, so it's left out.");
      }
      return parts.join(" ");
    }
  }
}
