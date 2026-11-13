// The page's side of Google Calendar (prompt 4.1): what to say after the trip
// to Google's consent screen, and when to read the calendar again.

/** The page reads the calendar again when it opens, if the last read is older than this. */
export const RESYNC_AFTER_MS = 15 * 60_000;

export const CALENDAR_OUTCOMES = ["connected", "denied", "no_calendar_access", "failed", "not_configured"] as const;
export type CalendarOutcome = (typeof CALENDAR_OUTCOMES)[number];

/** The ?calendar= the callback returned with, if it is one. */
export function outcomeFrom(search: string): CalendarOutcome | null {
  const v = new URLSearchParams(search).get("calendar");
  return (CALENDAR_OUTCOMES as readonly string[]).includes(v ?? "") ? (v as CalendarOutcome) : null;
}

export function outcomeText(outcome: CalendarOutcome, events: number | null): string {
  switch (outcome) {
    case "connected":
      return events === null
        ? "Google Calendar connected."
        : `Google Calendar connected: ${events} upcoming ${events === 1 ? "event" : "events"} this week${events === 0 ? "" : ", added as tasks"}.`;
    case "denied":
      return "You said no on Google's screen, so nothing was connected.";
    case "no_calendar_access":
      return "Calendar access wasn't ticked on Google's screen, so nothing was connected. Connect again and tick it.";
    case "not_configured":
      return "Google isn't set up on this server, so the calendar can't be connected.";
    case "failed":
      return "Couldn't connect Google Calendar. Try again.";
  }
}

export function resyncDue(lastSyncAt: string | null, now: Date): boolean {
  return !lastSyncAt || now.getTime() - new Date(lastSyncAt).getTime() >= RESYNC_AFTER_MS;
}
