// The web app's handle on the Android alarm plugin
// (android/app/src/main/java/app/somniai/alarm/alarms/SomniAlarmPlugin.java).
//
// The phone keeps alarms as wall-clock times, so "07:00" stays 07:00 through
// daylight saving and after moving time zone. toNativeAlarm turns a web alarm
// (an instant plus a repeat rule) into that form, in this device's time zone.
// Wiring the app's alarm list to it is prompt 2.5.

import { registerPlugin } from "@capacitor/core";
import type { Alarm } from "./types";

/** An alarm as the native side stores it. Days: 0 is Sunday, as in lib/recurrence.ts. */
export interface NativeAlarm {
  id: string;
  label: string;
  hour: number;
  minute: number;
  /** Repeats on these days; omitted for a one-off. */
  days?: number[];
  /** The local date a one-off rings on, YYYY-MM-DD; omitted when repeating. */
  date?: string;
  enabled: boolean;
  ringPlan?: unknown;
}

export type NativeStatus = "scheduled" | "waiting_for_permission" | "missed" | "done" | "disabled";

export interface ExactAlarmAccess {
  /** not_required below Android 12; needs_user on Android 12/12L with "Alarms & reminders" off. */
  state: "not_required" | "granted" | "needs_user" | "unavailable";
  permission: "android.permission.SCHEDULE_EXACT_ALARM" | "android.permission.USE_EXACT_ALARM" | null;
  sdk: number;
}

export interface NativeRecord {
  alarm: Required<Pick<NativeAlarm, "id" | "label" | "hour" | "minute" | "enabled">> & { days: number[]; date: string | null; ringPlan: unknown };
  status: NativeStatus;
  /** Epoch ms it is handed to AlarmManager for, when scheduled. */
  triggerAt: number | null;
  lastFiredAt: number | null;
}

/**
 * What happened to an occurrence, newest last. One that fires logs "fired",
 * then "ringing" (with the sound used and the phone's volume, ringer and Do
 * Not Disturb state), then how it ended: "dismissed", "unanswered" (rang the
 * full 20 minutes) or "interrupted" (Android stopped the service). "ring_failed"
 * means Android refused to start ringing; "missed" means it never fired.
 */
export interface NativeLogEntry {
  id: string;
  label: string;
  outcome: "fired" | "ringing" | "sound_failed" | "dismissed" | "unanswered" | "interrupted" | "ring_failed" | "missed";
  scheduledFor: number;
  /** When it happened, epoch ms; null for a missed occurrence. */
  at: number | null;
  detail: string | null;
}

export interface SomniAlarmPlugin {
  /** Saves and schedules (or reschedules) an alarm. Rejects with code INVALID, saving nothing, if it is malformed or already past. */
  schedule(options: { alarm: NativeAlarm }): Promise<NativeRecord & { exactAlarm: ExactAlarmAccess }>;
  cancel(options: { id: string }): Promise<{ id: string; removed: boolean }>;
  list(): Promise<{ alarms: NativeRecord[]; log: NativeLogEntry[]; exactAlarm: ExactAlarmAccess }>;
  exactAlarmStatus(): Promise<{ exactAlarm: ExactAlarmAccess }>;
  /** Opens "Alarms & reminders" where the user can change it (Android 12/12L); otherwise opened is false. */
  openExactAlarmSettings(): Promise<{ opened: boolean; exactAlarm: ExactAlarmAccess }>;
  /** What decides whether a ringing alarm is seen and heard. Read-only. */
  ringStatus(): Promise<{
    /** Android 14+: whether the ring screen can open over the lock screen; denied means a heads-up only. */
    fullScreenIntent: "not_required" | "granted" | "denied";
    notifications: boolean;
    alarmVolume: number;
    alarmVolumeMax: number;
    /** total_silence mutes alarms for every app; priority lets them through unless the user blocked alarms. */
    doNotDisturb: "off" | "priority" | "alarms_only" | "total_silence";
  }>;
  /** Opens the full-screen setting for this app on Android 14+; otherwise opened is false. */
  openFullScreenIntentSettings(): Promise<{ opened: boolean }>;
  notificationStatus(): Promise<{ enabled: boolean }>;
  requestNotifications(): Promise<{ enabled: boolean }>;
}

export const SomniAlarm = registerPlugin<SomniAlarmPlugin>("SomniAlarm");

const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The native form of a web alarm, read in this device's time zone. A custom
 * repeat with no days rings once, as nextOccurrence treats it.
 */
export function toNativeAlarm(alarm: Pick<Alarm, "_id" | "label" | "scheduledTime" | "repeat" | "enabled" | "ringPlan">): NativeAlarm {
  const at = new Date(alarm.scheduledTime);
  if (Number.isNaN(at.getTime())) {
    throw new Error(`alarm ${alarm._id} has no valid time`);
  }
  const days = alarm.repeat?.type === "daily"
    ? EVERY_DAY
    : alarm.repeat?.type === "weekdays"
      ? WEEKDAYS
      : alarm.repeat?.type === "custom"
        ? [...new Set(alarm.repeat.days ?? [])].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b)
        : [];
  return {
    id: alarm._id,
    label: alarm.label,
    hour: at.getHours(),
    minute: at.getMinutes(),
    ...(days.length > 0 ? { days } : { date: localDate(at) }),
    enabled: alarm.enabled,
    ...(alarm.ringPlan ? { ringPlan: alarm.ringPlan } : {}),
  };
}
