import { describe, expect, it } from "vitest";
import { outcomeFrom, outcomeText, resyncDue } from "./calendarClient";

describe("the page after Google's consent screen", () => {
  it("reads only the outcomes the callback sends", () => {
    expect(outcomeFrom("?calendar=connected")).toBe("connected");
    expect(outcomeFrom("?x=1&calendar=no_calendar_access")).toBe("no_calendar_access");
    expect(outcomeFrom("?calendar=<script>")).toBeNull();
    expect(outcomeFrom("")).toBeNull();
  });

  it("says what happened, including an empty calendar", () => {
    expect(outcomeText("connected", 3)).toBe("Google Calendar connected: 3 upcoming events this week, added as tasks.");
    expect(outcomeText("connected", 1)).toBe("Google Calendar connected: 1 upcoming event this week, added as tasks.");
    expect(outcomeText("connected", 0)).toBe("Google Calendar connected: 0 upcoming events this week.");
    expect(outcomeText("connected", null)).toBe("Google Calendar connected.");
    expect(outcomeText("denied", null)).toBe("You said no on Google's screen, so nothing was connected.");
    expect(outcomeText("no_calendar_access", null)).toMatch(/^Calendar access wasn't ticked/);
  });

  it("reads the calendar again when the page opens, at most every 15 minutes", () => {
    const now = new Date("2026-11-16T08:00:00Z");
    expect(resyncDue(null, now)).toBe(true);
    expect(resyncDue("2026-11-16T07:46:00Z", now)).toBe(false);
    expect(resyncDue("2026-11-16T07:45:00Z", now)).toBe(true);
  });
});
