// The paper's wake-time regularity label (ai-brain/datasets/wake_proxy.py),
// ported so a person's own nights are labelled exactly as the population
// model's training nights were (prompt 5.3). tests/fixtures/wake-proxy is the
// Python original's output, and lib/wakeProxy.test.ts checks this matches it.
//
// A night is regular unless its wake was more than 30 minutes later than the
// person's habit: the median of up to 28 earlier nights of the same kind
// (weekday or weekend), needing at least 3, measured around a 24-hour clock.
// A night without a habit yet is unlabelled (null), never guessed.

export const TOLERANCE_MIN = 30;
export const WINDOW = 28;
export const MIN_NIGHTS = 3;

export interface WakeNight {
  /** The wake date, YYYY-MM-DD, as the sleep log keys nights. */
  date: string;
  /** Local wake time in hours (7.5 is 07:30); null if not recorded. */
  wakeHour: number | null;
}

const isWeekend = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};

/** Python's ((raw + 12) % 24) - 12: signed hours later than the habit, around the clock. */
export function circularDeviation(actual: number, habit: number): number {
  const raw = actual - habit + 12;
  return (((raw % 24) + 24) % 24) - 12;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Each night's label, in the order given: true regular, false late, null unlabelled. */
export function regularityLabels(nights: WakeNight[]): (boolean | null)[] {
  const order = nights.map((n, i) => ({ ...n, i })).sort((a, b) => a.date.localeCompare(b.date));
  const out: (boolean | null)[] = new Array(nights.length).fill(null);
  const seen: Record<"weekday" | "weekend", (number | null)[]> = { weekday: [], weekend: [] };
  for (const n of order) {
    const bucket = isWeekend(n.date) ? "weekend" : "weekday";
    // The previous WINDOW nights of this kind (recorded or not), as pandas' rolling window counts rows.
    const earlier = seen[bucket].slice(-WINDOW).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    const habit = earlier.length >= MIN_NIGHTS ? median(earlier) : null;
    const wake = typeof n.wakeHour === "number" && Number.isFinite(n.wakeHour) ? n.wakeHour : null;
    out[n.i] = habit === null || wake === null ? null : !(circularDeviation(wake, habit) > TOLERANCE_MIN / 60);
    seen[bucket].push(wake);
  }
  return out;
}
