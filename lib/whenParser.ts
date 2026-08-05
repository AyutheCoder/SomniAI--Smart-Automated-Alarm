/**
 * Pull a date and time out of the words a person actually types.
 *
 * The semantic engine already understands that "final exam tomorrow" is urgent,
 * but the scheduler needs a structured `dueDate` and silently drops any task
 * without one. So a task the system correctly read as critical produced no
 * alarm at all, and the panel reported "no tasks need a wake alarm" - which
 * looked like a considered decision rather than a discarded row.
 *
 * This closes that gap: whatever date the sentence implies becomes a real
 * dueDate at creation time, so the task, the list and the scheduler all agree.
 * Explicit picker values always win; this only fills what the user left blank.
 */

export interface ParsedWhen {
  /** YYYY-MM-DD in local time. */
  dueDate?: string;
  /** HH:MM, 24-hour. */
  dueTime?: string;
  /** The words that produced the match, for showing the user what was read. */
  matched?: string;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/** Times of day people name instead of giving a clock time. */
const DAYPARTS: Record<string, string> = {
  "early morning": "06:00",
  morning: "08:00",
  noon: "12:00",
  midday: "12:00",
  afternoon: "14:00",
  evening: "19:00",
  tonight: "21:00",
  night: "21:00",
  midnight: "23:59",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

/** Clock time: "9am", "9 pm", "09:00", "9:30pm", "at 7". */
function parseTime(text: string): { time: string; matched: string } | null {
  const explicit = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (explicit) {
    let hour = Number(explicit[1]);
    const minute = Number(explicit[2] ?? 0);
    const meridiem = explicit[3].toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) {
      return { time: `${pad(hour)}:${pad(minute)}`, matched: explicit[0].trim() };
    }
  }

  const twentyFour = /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (twentyFour) {
    return {
      time: `${pad(Number(twentyFour[1]))}:${twentyFour[2]}`,
      matched: twentyFour[0].trim(),
    };
  }

  // "at 7" with no meridiem - assume the waking half of the day.
  const bare = /\bat\s+(\d{1,2})\b(?!\s*:)/i.exec(text);
  if (bare) {
    const hour = Number(bare[1]);
    if (hour >= 1 && hour <= 23) {
      const resolved = hour <= 7 ? hour + 12 : hour; // "at 6" reads as evening
      return { time: `${pad(resolved)}:00`, matched: bare[0].trim() };
    }
  }

  for (const [word, time] of Object.entries(DAYPARTS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) {
      return { time, matched: word };
    }
  }
  return null;
}

/** Day reference: "today", "tomorrow", "monday", "next friday", "in 3 days". */
function parseDate(text: string, now: Date): { date: Date; matched: string } | null {
  if (/\btomorrow\b/i.test(text)) {
    return { date: addDays(now, 1), matched: "tomorrow" };
  }
  if (/\b(today|tonight|this evening|this morning)\b/i.test(text)) {
    const m = /\b(today|tonight|this evening|this morning)\b/i.exec(text)!;
    return { date: new Date(now), matched: m[1] };
  }
  if (/\bday after tomorrow\b/i.test(text)) {
    return { date: addDays(now, 2), matched: "day after tomorrow" };
  }

  const inDays = /\bin\s+(\d{1,2})\s+days?\b/i.exec(text);
  if (inDays) {
    return { date: addDays(now, Number(inDays[1])), matched: inDays[0] };
  }

  const weekday = new RegExp(
    `\\b(next\\s+)?(${Object.keys(WEEKDAYS).join("|")})\\b`,
    "i",
  ).exec(text);
  if (weekday) {
    const target = WEEKDAYS[weekday[2].toLowerCase()];
    // Always forward: naming a weekday means the next one, never the last.
    let delta = (target - now.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    if (weekday[1]) delta += 7; // "next friday" skips the coming one
    return { date: addDays(now, delta), matched: weekday[0].trim() };
  }
  return null;
}

/**
 * Read a due date/time out of free text.
 *
 * `now` is injectable so the behaviour is testable without freezing the clock.
 */
export function parseWhen(text: string, now: Date = new Date()): ParsedWhen {
  const source = (text ?? "").trim();
  if (!source) {
    return {};
  }

  const date = parseDate(source, now);
  const time = parseTime(source);
  if (!date && !time) {
    return {};
  }

  // "tonight" names both the day and the hour, so it matches both parsers -
  // report it once.
  const parts: string[] = [];
  if (date) parts.push(date.matched);
  if (time && time.matched.toLowerCase() !== date?.matched.toLowerCase()) {
    parts.push(time.matched);
  }

  // A bare time with no day means the next time that clock time comes round.
  let resolved = date ? date.date : new Date(now);
  if (!date && time) {
    const [h, m] = time.time.split(":").map(Number);
    const candidate = new Date(now);
    candidate.setHours(h, m, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      resolved = addDays(now, 1);
    }
  }

  return {
    dueDate: ymd(resolved),
    dueTime: time?.time,
    matched: parts.join(" "),
  };
}
