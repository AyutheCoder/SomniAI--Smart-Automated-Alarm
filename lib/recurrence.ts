// When a recurring alarm rings next. Shared by the dismiss route and the
// browser, which re-arms an alarm itself when the server can't be reached at
// ring time, so the two can never disagree.

export interface Repeat {
  type: "none" | "daily" | "weekdays" | "custom";
  days?: number[];
}

const DAY_MS = 24 * 3600_000;
const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * The next time a recurring alarm should ring: same clock time as `base`, on
 * an allowed day, strictly after both `base` and `now`.
 *
 * It used to step one day from `base` without looking at `now`, so an alarm
 * dismissed days late (the tab had been closed) was re-armed in the past and
 * never rang again.
 *
 * Days and clock times are the server's local time; per-user time zones are
 * not handled yet.
 */
export function nextOccurrence(base: Date, repeat: Repeat | undefined, now: Date): Date | null {
  if (!repeat || repeat.type === "none") {
    return null;
  }
  const allowedDays = repeat.type === "weekdays"
    ? WEEKDAYS
    : repeat.type === "custom"
      ? repeat.days ?? []
      : null;
  if (allowedDays && allowedDays.length === 0) {
    return null;
  }
  const after = Math.max(base.getTime(), now.getTime());
  const candidate = new Date(base);
  candidate.setSeconds(0, 0);
  // Skip most of any backlog in one step, stopping a day short so the loop
  // below still finds the first allowed day after `after`.
  const behind = Math.floor((after - candidate.getTime()) / DAY_MS) - 1;
  if (behind > 0) {
    candidate.setDate(candidate.getDate() + behind);
  }
  for (let i = 0; i < 10; i++) {
    candidate.setDate(candidate.getDate() + 1);
    if (candidate.getTime() > after && (!allowedDays || allowedDays.includes(candidate.getDay()))) {
      return candidate;
    }
  }
  return null;
}
