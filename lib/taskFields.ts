import { isClockTime, isIsoDate } from "@/lib/validate";

/**
 * Checks the due date and time a client sends for a task. The scheduler only
 * understands YYYY-MM-DD and HH:MM, so anything else ("next week", "9am") was
 * stored and then silently dropped from scheduling. Empty values clear them.
 */
export function invalidDue(body: { dueDate?: unknown; dueTime?: unknown }): string | null {
  if (body.dueDate !== undefined && body.dueDate !== "" && body.dueDate !== null && !isIsoDate(body.dueDate)) {
    return "dueDate must be a date like 2026-10-22";
  }
  if (body.dueTime !== undefined && body.dueTime !== "" && body.dueTime !== null && !isClockTime(body.dueTime)) {
    return "dueTime must be a 24-hour time like 07:30";
  }
  return null;
}
