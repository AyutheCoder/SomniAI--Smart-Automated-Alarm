import { describe, expect, it } from "vitest";
import {
  CALENDAR_SCOPE,
  authorizationUrl,
  eventToTask,
  exchangeCode,
  googleConfigFromEnv,
  listUpcomingEvents,
  refreshAccessToken,
  revokeToken,
  type GoogleEvent,
} from "./googleCalendar";
import { fakeGoogle, fixture } from "@/tests/fixtures/google-calendar/fakeGoogle";

const NOW = new Date("2026-11-16T00:00:00.000Z");
const CFG = { clientId: "fixture-client.apps.googleusercontent.com", clientSecret: "fixture-secret", redirectUri: "http://localhost:3000/api/calendar/callback" };

describe("connecting: incremental authorisation on the sign-in client", () => {
  it("is set up only with the sign-in client and the site's address", () => {
    expect(googleConfigFromEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", NEXTAUTH_URL: "https://somni.example/" }))
      .toEqual({ clientId: "id", clientSecret: "s", redirectUri: "https://somni.example/api/calendar/callback" });
    expect(googleConfigFromEnv({ GOOGLE_CLIENT_ID: "id", NEXTAUTH_URL: "x" })).toBeNull();
    expect(googleConfigFromEnv({})).toBeNull();
  });

  it("asks for read-only events, adds to what was granted, and for offline access", () => {
    const url = new URL(authorizationUrl(CFG, "state-1", "sleeper@example.com"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CFG.clientId,
      redirect_uri: CFG.redirectUri,
      response_type: "code",
      scope: `openid email ${CALENDAR_SCOPE}`,
      include_granted_scopes: "true",
      access_type: "offline",
      prompt: "consent",
      state: "state-1",
      login_hint: "sleeper@example.com",
    });
    expect(CALENDAR_SCOPE).toBe("https://www.googleapis.com/auth/calendar.events.readonly");
  });

  it("exchanges the code for tokens and the account's email", async () => {
    const g = fakeGoogle({ token: [{ status: 200, fixture: "token-exchange" }] });
    const r = await exchangeCode("code-1", CFG, g.fetch, NOW);
    expect(r).toEqual({
      ok: true,
      accessToken: "ya29.fixture-access-token-1",
      expiresAt: new Date(NOW.getTime() + 3599_000),
      refreshToken: "1//fixture-refresh-token",
      scopes: ["openid", "https://www.googleapis.com/auth/userinfo.email", CALENDAR_SCOPE],
      email: "sleeper@example.com",
    });
    expect(Object.fromEntries(new URLSearchParams(g.calls[0].body))).toEqual({
      code: "code-1", client_id: CFG.clientId, client_secret: CFG.clientSecret, redirect_uri: CFG.redirectUri, grant_type: "authorization_code",
    });
  });
});

describe("token refresh", () => {
  it("gets a new access token, keeping the refresh token", async () => {
    const g = fakeGoogle({ token: [{ status: 200, fixture: "token-refresh" }] });
    const r = await refreshAccessToken("1//fixture-refresh-token", CFG, g.fetch, NOW);
    expect(r).toMatchObject({ ok: true, accessToken: "ya29.fixture-access-token-2", refreshToken: null, email: null });
    expect(new URLSearchParams(g.calls[0].body).get("grant_type")).toBe("refresh_token");
  });

  it("revoked access is told apart from a passing failure", async () => {
    const revoked = await refreshAccessToken("x", CFG, fakeGoogle({ token: [{ status: 400, fixture: "token-invalid-grant" }] }).fetch, NOW);
    expect(revoked).toEqual({ ok: false, revoked: true, error: "Google 400 invalid_grant: Token has been expired or revoked." });
    const down = await refreshAccessToken("x", CFG, fakeGoogle({ token: [new Error("ETIMEDOUT")] }).fetch, NOW);
    expect(down).toEqual({ ok: false, revoked: false, error: "Google unreachable: ETIMEDOUT" });
  });

  it("revoking says whether Google answered", async () => {
    expect(await revokeToken("t", fakeGoogle({ revoke: 200 }).fetch)).toBe(true);
    expect(await revokeToken("t", fakeGoogle({ revoke: 400 }).fetch)).toBe(true);
    expect(await revokeToken("t", fakeGoogle({ revoke: 503 }).fetch)).toBe(false);
  });
});

describe("reading the week ahead", () => {
  it("reads every page of the primary calendar's next seven days, cancellations included", async () => {
    const g = fakeGoogle({ events: [{ status: 200, fixture: "events-page1" }, { status: 200, fixture: "events-page2" }] });
    const r = await listUpcomingEvents("ya29.token", NOW, g.fetch);
    expect(r.ok && r.events.map((e) => e.id)).toEqual([
      "exam20261117", "passport20261118", "dentist20261118", "standup20261117", "office20261118",
      "gym_20261119T003000Z", "flight20261120", "untitled20261121",
    ]);
    const first = new URL(g.calls[0].url);
    expect(Object.fromEntries(first.searchParams)).toEqual({
      timeMin: "2026-11-16T00:00:00.000Z", timeMax: "2026-11-23T00:00:00.000Z",
      singleEvents: "true", orderBy: "startTime", showDeleted: "true", maxResults: "100",
    });
    expect(g.calls[0].authorization).toBe("Bearer ya29.token");
    expect(new URL(g.calls[1].url).searchParams.get("pageToken")).toBe("fixture-page-2");
  });

  it("an empty calendar is an empty week, not an error", async () => {
    const r = await listUpcomingEvents("t", NOW, fakeGoogle({ events: [{ status: 200, fixture: "events-empty" }] }).fetch);
    expect(r).toEqual({ ok: true, events: [] });
  });

  it("a refused token, a missing permission and an outage are each named", async () => {
    expect(await listUpcomingEvents("t", NOW, fakeGoogle({ events: [{ status: 401, fixture: "events-401" }] }).fetch))
      .toMatchObject({ ok: false, kind: "unauthorized" });
    expect(await listUpcomingEvents("t", NOW, fakeGoogle({ events: [{ status: 403, fixture: "events-403-scope" }] }).fetch))
      .toEqual({ ok: false, kind: "no_permission", error: "Request had insufficient authentication scopes." });
    expect(await listUpcomingEvents("t", NOW, fakeGoogle({ events: [new Error("ECONNRESET")] }).fetch))
      .toEqual({ ok: false, kind: "failed", error: "Google Calendar unreachable: ECONNRESET" });
  });
});

describe("events as tasks", () => {
  const items = [
    ...(fixture("events-page1") as { items: GoogleEvent[] }).items,
    ...(fixture("events-page2") as { items: GoogleEvent[] }).items,
  ];
  const byId = (id: string) => eventToTask(items.find((e) => e.id === id)!);

  it("a timed event keeps its own local date and time, and its notes as plain text", () => {
    expect(byId("exam20261117")).toEqual({
      externalId: "exam20261117", cancelled: false, title: "Final exam", description: "Hall B\nBring ID & two pens",
      dueDate: "2026-11-17", dueTime: "09:00", updated: "2026-11-10T08:00:00.000Z",
    });
    expect(byId("flight20261120")).toMatchObject({ dueDate: "2026-11-20", dueTime: "06:10" });
    expect(byId("gym_20261119T003000Z")).toMatchObject({ title: "Gym", dueDate: "2026-11-19", dueTime: "06:00" });
  });

  it("an all-day event has a date and no time; an untitled one says so", () => {
    expect(byId("passport20261118")).toEqual({
      externalId: "passport20261118", cancelled: false, title: "Passport renewal appointment", description: "",
      dueDate: "2026-11-18", updated: "2026-11-09T08:00:00.000Z",
    });
    expect(byId("untitled20261121")).toMatchObject({ title: "(No title)", dueDate: "2026-11-21", dueTime: "15:00" });
  });

  it("a cancelled event is marked to remove; declined and working-location ones aren't tasks", () => {
    expect(byId("dentist20261118")).toEqual({ externalId: "dentist20261118", cancelled: true });
    expect(byId("standup20261117")).toBeNull();
    expect(byId("office20261118")).toBeNull();
    expect(eventToTask({ id: "x", status: "confirmed", summary: "No start" })).toBeNull();
  });
});
