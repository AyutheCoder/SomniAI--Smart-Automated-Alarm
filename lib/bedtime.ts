// Turning a wake plan into real times tonight, and the bedtime reminder.
//
// The planner gives bedtime as hours past the midnight before the wake day,
// running past 24 for after midnight: 22.25 is 22:15 the evening before, 24.5
// is 00:30 on the wake day. The reminder is kept on the device and shown as a
// web notification at that time, while a SomniAI tab is open (native in
// Phase 2).

import type { KeyValueStore } from "./outbox";

/** The next time the clock reads "HH:MM": later today, or else tomorrow. */
export function nextWakeAt(hhmm: string, now: Date): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  if (at.getTime() <= now.getTime()) {
    at.setDate(at.getDate() + 1);
  }
  return at;
}

/** The planned bedtime as a moment, or null if it would not come before the wake. */
export function bedtimeBefore(wakeAt: Date, bedtimeHour: number): Date | null {
  const midnight = new Date(wakeAt);
  midnight.setHours(0, 0, 0, 0);
  const bedtime = new Date(midnight.getTime() + (bedtimeHour - 24) * 3_600_000);
  return bedtime.getTime() < wakeAt.getTime() ? bedtime : null;
}

export function clockTime(at: Date): string {
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

export interface BedtimeReminder {
  /** When to remind: the planned bedtime. */
  at: string;
  /** The wake it is for; past this, the reminder is stale. */
  wakeAt: string;
  /** Set once shown, so it is shown once. */
  shownAt?: string;
}

const keyFor = (userId: string) => `somniai.bedtime.v1:${userId}`;

export function saveReminder(store: KeyValueStore | null, userId: string, reminder: BedtimeReminder | null) {
  try {
    store?.setItem(keyFor(userId), JSON.stringify(reminder));
  }
  catch {
    // Storage blocked: the reminder lasts as long as this page.
  }
}

export function loadReminder(store: KeyValueStore | null, userId: string): BedtimeReminder | null {
  try {
    const raw = store?.getItem(keyFor(userId));
    const r = raw ? (JSON.parse(raw) as BedtimeReminder | null) : null;
    return r && typeof r.at === "string" && typeof r.wakeAt === "string" ? r : null;
  }
  catch {
    return null;
  }
}

/** Due once its time has come, until shown or until the wake it was for has passed. */
export function reminderDue(r: BedtimeReminder | null, now: Date): boolean {
  return r !== null
    && !r.shownAt
    && now.getTime() >= Date.parse(r.at)
    && now.getTime() < Date.parse(r.wakeAt);
}
