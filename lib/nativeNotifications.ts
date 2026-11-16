// Notifications for the phone's alarms (prompt 7.5, found with the first Firebase
// build on the POCO). On Android 13+ a fresh install may not show notifications
// until the person allows them, and nothing in the app asked: an alarm then rang
// with no notification and no ring screen (the screen comes through the
// notification's full-screen intent), so there was no way to stop it. Now the
// app asks once when it opens, and while they're off says so plainly, with a way
// to fix it.

import type { SomniAlarmPlugin } from "./nativeAlarm";

type Plugin = Pick<SomniAlarmPlugin, "notificationStatus" | "requestNotifications" | "openPreflight">;

export const NOTIFICATIONS_OFF = "Notifications are off for SomniAI, so an alarm would ring without showing its screen, "
  + "and there would be no way to stop it here. Allow notifications for your alarms to work.";

/** Session key: Android's prompt is asked for once per app start, not on every page load. */
export const ASKED_KEY = "somniai.notificationsAsked";

export type NotificationState = "on" | "off" | "unknown";

/** Whether notifications are on, asking Android once if they're off and `ask` says it may. */
export async function ensureNotifications(plugin: Plugin, ask: boolean): Promise<NotificationState> {
  let enabled: boolean;
  try {
    enabled = (await plugin.notificationStatus()).enabled;
  }
  catch {
    return "unknown"; // An app too old to say: nothing to show rather than a wrong warning.
  }
  if (enabled || !ask) {
    return enabled ? "on" : "off";
  }
  try {
    return (await plugin.requestNotifications()).enabled ? "on" : "off";
  }
  catch {
    return "off";
  }
}

/**
 * The banner's button: Android's prompt, and if Android won't show it (refused
 * before), the bedtime check's screen, whose notifications row opens Settings.
 */
export async function allowNotifications(plugin: Plugin): Promise<NotificationState> {
  const state = await ensureNotifications(plugin, true);
  if (state === "off") {
    await plugin.openPreflight().catch(() => undefined);
  }
  return state;
}
