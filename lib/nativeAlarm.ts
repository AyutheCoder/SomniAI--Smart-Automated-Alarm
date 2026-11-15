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
 * full 20 minutes) or "interrupted" (Android stopped the service).
 * "dismiss_refused" is a stop without a passed wake check, which the service
 * turns down. "ring_failed"
 * means Android refused to start ringing; "missed" means it never fired.
 */
export interface NativeLogEntry {
  id: string;
  label: string;
  outcome: "fired" | "ringing" | "sound_failed" | "dismissed" | "dismiss_refused" | "unanswered" | "interrupted" | "ring_failed" | "missed";
  scheduledFor: number;
  /** When it happened, epoch ms; null for a missed occurrence. */
  at: number | null;
  detail: string | null;
}

export interface SomniAlarmPlugin {
  /** Saves and schedules (or reschedules) an alarm. Rejects with code INVALID, saving nothing, if it is malformed or already past. */
  /** What this native code offers: 2 adds reconcile. Missing on builds before 2.5. */
  version(): Promise<{ api: number }>;
  /**
   * Makes the phone's schedule match the server's full list (lib/nativeSync.ts
   * calls it). Idempotent. Rejects with INVALID, changing nothing, for a
   * malformed alarm, a non-server id or an id listed twice.
   */
  reconcile(options: { alarms: NativeAlarm[] }): Promise<{
    put: string[];
    removed: string[];
    unchanged: string[];
    /** One-offs that already rang on the phone; the server hears through the outbox. */
    keptHistory: string[];
    /** One-offs whose time had passed: not scheduled. */
    past: string[];
    exactAlarm: ExactAlarmAccess;
  }>;
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
  /**
   * Ring results waiting for the server: each ring's fire, verify and dismiss
   * calls with "at", when they happened. They are sent by the phone itself
   * when a network is available, signed in with the web view's session.
   */
  pendingSync(): Promise<{ calls: { id: string; alarmId: string; path: string; body: string; queuedAt: number }[] }>;
  /** Tries to send them now. "waiting" counts what is still queued. */
  syncNow(): Promise<{ sent: number; dropped: string[]; waiting: number; lastStatus: number }>;
  notificationStatus(): Promise<{ enabled: boolean }>;
  requestNotifications(): Promise<{ enabled: boolean }>;
  /** API 3: every bedtime check now (Preflight.java). Read-only. */
  preflight(): Promise<{ checks: PreflightCheck[]; attention: number }>;
  /** API 3: opens the native "Tonight's alarm check" screen, with a fix for each failure. */
  openPreflight(): Promise<void>;
  /** API 3: the wake plan's bedtime (ISO), or null to clear it; the check runs half an hour before. */
  setBedtime(options: { at: string | null }): Promise<{ bedtime: string | null }>;
  /** API 4: this phone's push token for wake-buddy alerts, or why there isn't one. */
  pushToken(): Promise<{ available: boolean; token?: string; reason?: string }>;
  /** API 5: Health Connect on this phone, and which read permissions are granted (lib/nativeHealth.ts). */
  healthStatus(): Promise<HealthState>;
  /** API 5: Health Connect's permission screen for sleep and resting heart rate. */
  requestHealthPermissions(): Promise<HealthState>;
  /** API 5: the last two weeks of nights, folded one per wake date, longest session kept. */
  readSleep(): Promise<{ status: HealthAvailability; nights: HealthNight[]; skipped: string[] }>;
  /** API 5: Health Connect itself, or its Play Store page when it isn't installed. */
  openHealthConnect(): Promise<{ opened: boolean }>;
  /** API 6: whether Usage access is on, for screen time before bed (4.3). */
  screenTimeStatus(): Promise<{ allowed: boolean }>;
  /** API 7: telemetry on the phone (5.1): the consent it holds, wakes open between rings, and queued. */
  telemetryStatus(): Promise<PhoneTelemetry>;
  /** API 7: the consent the server holds; withdrawing drops everything not yet sent. */
  setTelemetryConsent(options: { granted: boolean; version?: string }): Promise<PhoneTelemetry & { dropped: number }>;
  /** API 7: drops every wake not yet sent (the user deleted their telemetry). */
  clearTelemetry(): Promise<PhoneTelemetry & { dropped: number }>;
  /** API 8: the account was deleted (7.2): cancels and forgets every alarm, drops unsent calls and telemetry. */
  forgetAccount(): Promise<{ alarms: number; unsent: number; openWakes: number }>;
  /** API 6: Settings' Usage access page. */
  openUsageAccess(): Promise<{ opened: boolean }>;
  /**
   * API 6: the last week's screen time before bed, a night per wake date.
   * bedtimes are the sleep log's, by wake date; other nights use the phone's
   * reading of bed. Without Usage access nothing is read (allowed: false).
   */
  readScreenTime(options: { bedtimes: Record<string, string> }): Promise<{ allowed: boolean; nights: ScreenNightReading[]; skipped: string[] }>;
}

export interface PhoneTelemetry {
  granted: boolean;
  version: string | null;
  openWakes: number;
  queued: number;
}

/** One night as ScreenNights.java measures it; the server's import takes it as is. */
export interface ScreenNightReading {
  date: string;
  bedtime: string;
  minutes: number;
  windowMinutes: number;
  bedtimeFrom: "sleep_log" | "phone";
}

export type HealthAvailability = "available" | "not_installed" | "update_required";

export interface HealthState {
  status: HealthAvailability;
  /** Health Connect permission names, of SomniAI's two. */
  granted: string[];
  allGranted: boolean;
  error?: string;
}

/** One night as HealthNights.java folds it; the server's import takes it as is. */
export interface HealthNight {
  date: string;
  sleepTime: string;
  wakeTime: string;
  asleepMinutes: number;
  inBedMinutes: number;
  stagesRecorded: boolean;
  sessions: number;
  sessionId: string;
  origin?: string;
  restingHr?: number;
}

export interface PreflightCheck {
  id: string;
  /** unverified: the phone can't read it; confirmed: the user said it's done. */
  status: "pass" | "fail" | "unverified" | "confirmed";
  title: string;
  detail: string;
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
export function toNativeAlarm(alarm: Pick<Alarm, "_id" | "label" | "scheduledTime" | "repeat" | "enabled" | "ringPlan" | "snoozedFrom">): NativeAlarm {
  // A snoozed alarm has the snooze as its scheduledTime; its own time is
  // snoozedFrom. The phone always gets the alarm's own time: it keeps its own
  // snooze (prompt 5.1, AlarmRecord.snoozedUntil), and a snooze time sent here
  // at minute precision would replace it, or, once that minute had begun,
  // read as past and cancel the snooze's ring. A repeating alarm would also
  // move every later morning.
  const at = new Date(alarm.snoozedFrom ? alarm.snoozedFrom : alarm.scheduledTime);
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
