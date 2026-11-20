// The web app's side of the bedtime check (prompt 3.1). The checks and their
// fixes are native (Preflight.java, PreflightActivity.java), so they work with
// the app closed and offline; the page passes on the planned bedtime and links
// to the check.

import { Capacitor } from "@capacitor/core";
import { SomniAlarm, type SomniAlarmPlugin } from "./nativeAlarm";
import type { NativeConnection } from "./nativeSync";

/** The plugin version with the bedtime check. */
export const PREFLIGHT_API = 3;

export function hasPreflight(native: NativeConnection | null): boolean {
  return native !== null && "api" in native && native.api >= PREFLIGHT_API;
}

/**
 * Tells the phone tonight's planned bedtime (or null to clear it), so its
 * check runs half an hour before. "unsupported" is an app built before 3.1,
 * which has no bedtime check.
 */
export async function shareBedtime(
  at: string | null,
  plugin: Pick<SomniAlarmPlugin, "setBedtime"> = SomniAlarm,
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
): Promise<"shared" | "not_native" | "unsupported"> {
  if (!isNative()) {
    return "not_native";
  }
  try {
    await plugin.setBedtime({ at });
    return "shared";
  }
  catch {
    return "unsupported";
  }
}

/** One line for the page: what the phone's check says now. */
export function preflightLine(attention: number): string {
  if (attention === 0) {
    return "Tonight's alarm check: all clear.";
  }
  return attention === 1
    ? "Tonight's alarm check: 1 setting could stop your alarm."
    : `Tonight's alarm check: ${attention} settings could stop your alarm.`;
}
