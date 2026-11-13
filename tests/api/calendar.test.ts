import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as connect } from "@/app/api/calendar/connect/route";
import { GET as callback } from "@/app/api/calendar/callback/route";
import { DELETE as disconnect, GET as state } from "@/app/api/calendar/route";
import { POST as sync } from "@/app/api/calendar/sync/route";
import { GET as context } from "@/app/api/context/route";
import { STATE_COOKIE } from "@/lib/calendarServer";
import { CalendarConnection } from "@/models/CalendarConnection";
import { Task } from "@/models/Task";
import { fakeGoogle, type FakeGoogle } from "@/tests/fixtures/google-calendar/fakeGoogle";
import { makeUser, read, request, signInAs } from "./helpers";

// Google is the fake in tests/fixtures/google-calendar: recorded-shape
// answers, and a record of every request. No test reaches Google.
const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: "fixture-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "fixture-secret",
  NEXTAUTH_URL: "http://localhost:3000",
  NEXTAUTH_SECRET: "test-server-secret",
};
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [k, v] of Object.entries(GOOGLE_ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) {
      delete process.env[k];
    }
    else {
      process.env[k] = v;
    }
  }
  vi.unstubAllGlobals();
});

function stubGoogle(g: FakeGoogle) {
  vi.stubGlobal("fetch", g.fetch);
  return g;
}

const week = [{ status: 200, fixture: "events-page1" }, { status: 200, fixture: "events-page2" }];

/** Start connecting, then come back from Google's screen with `query`. */
async function roundTrip(query: (state: string) => string, opts: { cookie?: boolean } = {}) {
  const started = await connect(request("GET", "/api/calendar/connect"));
  const location = new URL(started.headers.get("location")!);
  const st = location.searchParams.get("state")!;
  const cookie = (started as NextResponse).cookies.get(STATE_COOKIE)?.value;
  const back = await callback(new NextRequest(new URL(`/api/calendar/callback?${query(st)}`, "http://localhost"), {
    headers: opts.cookie === false || !cookie ? {} : { cookie: `${STATE_COOKIE}=${cookie}` },
  }));
  return { started, location, back: new URL(back.headers.get("location")!) };
}

async function connected(userId: string, events = week) {
  signInAs(userId);
  const g = stubGoogle(fakeGoogle({ token: [{ status: 200, fixture: "token-exchange" }], events }));
  const { back } = await roundTrip((st) => `state=${st}&code=fixture-code`);
  expect(back.search).toBe("?calendar=connected");
  return g;
}

const calendarTasks = (userId: string) =>
  Task.find({ userId, source: "google_calendar" }).sort({ dueDate: 1, dueTime: 1 }).lean<Record<string, unknown>[]>();

describe("connecting Google Calendar", () => {
  it("sends the user to Google for read-only events on top of sign-in, tied to them by a cookie", async () => {
    const me = await makeUser({ email: "sleeper@example.com" });
    signInAs(me);
    const res = await connect(request("GET", "/api/calendar/connect"));
    expect(res.status).toBe(307);
    const url = new URL(res.headers.get("location")!);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/calendar.events.readonly");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("login_hint")).toBe("sleeper@example.com");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/calendar/callback");
    const cookie = (res as NextResponse).cookies.get(STATE_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.value).not.toContain(me);
  });

  it("connects: the grant is stored sealed, and the week's events become scored tasks", async () => {
    const me = await makeUser();
    const g = await connected(me);
    expect(g.calls.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual([
      "POST https://oauth2.googleapis.com/token",
      "GET https://www.googleapis.com/calendar/v3/calendars/primary/events",
      "GET https://www.googleapis.com/calendar/v3/calendars/primary/events",
    ]);
    // The access token from the code is used at once; no refresh needed.
    expect(g.calls[1].authorization).toBe("Bearer ya29.fixture-access-token-1");

    const conn = await CalendarConnection.findOne({ userId: me }).lean<Record<string, unknown>>();
    expect(conn).toMatchObject({ status: "connected", email: "sleeper@example.com", lastSync: { events: 5, added: 5, updated: 0, removed: 0 } });
    expect(JSON.stringify(conn)).not.toContain("fixture-refresh-token");
    expect(JSON.stringify(conn)).not.toContain("fixture-access-token");

    const tasks = await calendarTasks(me);
    expect(tasks.map((t) => [t.title, t.dueDate, t.dueTime ?? null])).toEqual([
      ["Final exam", "2026-11-17", "09:00"],
      ["Passport renewal appointment", "2026-11-18", null],
      ["Gym", "2026-11-19", "06:00"],
      ["Flight to Delhi", "2026-11-20", "06:10"],
      ["(No title)", "2026-11-21", "15:00"],
    ]);
    for (const t of tasks) {
      // Scored by the semantic engine (its local fallback here: no AI Brain in tests).
      expect(t).toMatchObject({ source: "google_calendar", category: "Calendar", priority: "medium", completed: false });
      expect(typeof t.importanceScore).toBe("number");
      expect(t.aiPriority).toMatch(/^(low|medium|high|critical)$/);
    }
    const exam = tasks.find((t) => t.title === "Final exam")!;
    expect(exam.description).toBe("Hall B\nBring ID & two pens");
    expect(Number(exam.importanceScore)).toBeGreaterThan(Number(tasks.find((t) => t.title === "Gym")!.importanceScore));

    signInAs(me);
    const s = await read(await state());
    expect(s.body.data).toMatchObject({ configured: true, connection: { status: "connected", email: "sleeper@example.com", upcomingTasks: 5, lastError: null } });
    const sources = (await read(await context(request("GET", "/api/context")))).body.data.sources;
    expect(sources.calendar).toEqual({ source: "live", detail: "Google Calendar, sleeper@example.com: 5 upcoming events as tasks" });
  });

  it("an empty calendar connects with no tasks", async () => {
    const me = await makeUser();
    await connected(me, [{ status: 200, fixture: "events-empty" }]);
    expect(await calendarTasks(me)).toEqual([]);
    expect((await CalendarConnection.findOne({ userId: me }).lean<{ lastSync: unknown }>())!.lastSync)
      .toEqual({ events: 0, added: 0, updated: 0, removed: 0 });
  });

  it("refused, unticked or forged: nothing is stored", async () => {
    const me = await makeUser();
    signInAs(me);
    const g = stubGoogle(fakeGoogle({ token: [{ status: 200, fixture: "token-exchange-no-calendar" }], events: week }));
    expect((await roundTrip((st) => `state=${st}&error=access_denied`)).back.search).toBe("?calendar=denied");
    // Calendar unticked on Google's screen: the grant is handed back.
    expect((await roundTrip((st) => `state=${st}&code=c`)).back.search).toBe("?calendar=no_calendar_access");
    expect(g.calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);
    // A state that isn't this browser's, or no cookie at all.
    expect((await roundTrip(() => "state=forged&code=c")).back.search).toBe("?calendar=failed");
    expect((await roundTrip((st) => `state=${st}&code=c`, { cookie: false })).back.search).toBe("?calendar=failed");
    expect(await CalendarConnection.countDocuments({})).toBe(0);
    expect(await Task.countDocuments({})).toBe(0);
  });

  it("another user's consent can't land on this account", async () => {
    const [me, other] = [await makeUser(), await makeUser()];
    signInAs(me);
    stubGoogle(fakeGoogle({ token: [{ status: 200, fixture: "token-exchange" }], events: week }));
    const started = await connect(request("GET", "/api/calendar/connect"));
    const st = new URL(started.headers.get("location")!).searchParams.get("state");
    const cookie = (started as NextResponse).cookies.get(STATE_COOKIE)!.value;
    signInAs(other);
    const back = await callback(new NextRequest(new URL(`/api/calendar/callback?state=${st}&code=c`, "http://localhost"), {
      headers: { cookie: `${STATE_COOKIE}=${cookie}` },
    }));
    expect(new URL(back.headers.get("location")!).search).toBe("?calendar=failed");
    expect(await CalendarConnection.countDocuments({})).toBe(0);
  });

  it("without Google set up on the server, it says so", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const me = await makeUser();
    signInAs(me);
    const res = await connect(request("GET", "/api/calendar/connect"));
    expect(new URL(res.headers.get("location")!).search).toBe("?calendar=not_configured");
    expect((await read(await state())).body.data).toEqual({ configured: false, connection: null });
  });
});

describe("syncing", () => {
  it("refreshes the access token, updates moved events, removes cancelled ones but keeps what's done", async () => {
    const me = await makeUser();
    await connected(me);
    const passport = await Task.findOneAndUpdate({ userId: me, externalId: "passport20261118" }, { $set: { completed: true } });
    expect(passport).not.toBeNull();
    const examBefore = await Task.findOne({ userId: me, externalId: "exam20261117" }).lean<{ _id: unknown }>();

    const g = stubGoogle(fakeGoogle({ token: [{ status: 200, fixture: "token-refresh" }], events: [{ status: 200, fixture: "events-changed" }] }));
    const r = await read(await sync());
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ ok: true, events: 2, added: 0, updated: 1, removed: 1 });
    expect(new URLSearchParams(g.calls[0].body).get("grant_type")).toBe("refresh_token");
    expect(new URLSearchParams(g.calls[0].body).get("refresh_token")).toBe("1//fixture-refresh-token");
    expect(g.calls[1].authorization).toBe("Bearer ya29.fixture-access-token-2");

    const tasks = await calendarTasks(me);
    expect(tasks.map((t) => [t.title, t.dueDate, t.dueTime ?? null, t.completed])).toEqual([
      ["Final exam (moved)", "2026-11-17", "10:30", false],
      // Cancelled, but done already: kept as the record of it.
      ["Passport renewal appointment", "2026-11-18", null, true],
      ["Gym", "2026-11-19", "06:00", false],
      ["(No title)", "2026-11-21", "15:00", false],
    ]);
    expect(String(tasks[0]._id)).toBe(String(examBefore!._id));
    expect(tasks[0].description).toBe("Hall C");
  });

  it("an unchanged week changes nothing", async () => {
    const me = await makeUser();
    await connected(me);
    stubGoogle(fakeGoogle({ token: [{ status: 200, fixture: "token-refresh" }], events: week }));
    expect((await read(await sync())).body.data).toEqual({ ok: true, events: 5, added: 0, updated: 0, removed: 0 });
    expect(await Task.countDocuments({ userId: me })).toBe(5);
  });

  it("access removed in Google: marked revoked, said plainly, and Google isn't asked again until reconnected", async () => {
    const me = await makeUser();
    await connected(me);
    stubGoogle(fakeGoogle({ token: [{ status: 400, fixture: "token-invalid-grant" }] }));
    const r = await read(await sync());
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("Google 400 invalid_grant: Token has been expired or revoked.");
    const s = (await read(await state())).body.data.connection;
    expect(s).toMatchObject({ status: "revoked", lastError: expect.stringMatching(/^Google no longer lets SomniAI read this calendar/) });
    const sources = (await read(await context(request("GET", "/api/context")))).body.data.sources;
    expect(sources.calendar.source).toBe("missing");
    expect(sources.calendar.detail).toMatch(/Connect it again\.$/);

    const again = stubGoogle(fakeGoogle({ token: [{ status: 200, fixture: "token-refresh" }], events: week }));
    expect((await read(await sync())).status).toBe(409);
    expect(again.calls).toEqual([]);
    // The tasks already made stay; reconnecting brings the calendar back.
    expect(await Task.countDocuments({ userId: me })).toBe(5);
    await connected(me);
    expect((await read(await state())).body.data.connection.status).toBe("connected");
  });

  it("a refused token or a missing permission revokes; an outage doesn't", async () => {
    const me = await makeUser();
    await connected(me);
    stubGoogle(fakeGoogle({ token: [{ status: 200, fixture: "token-refresh" }], events: [{ status: 503, fixture: "events-empty" }] }));
    const down = await read(await sync());
    expect(down.status).toBe(502);
    expect((await read(await state())).body.data.connection).toMatchObject({ status: "connected", lastError: "Google Calendar 503" });

    stubGoogle(fakeGoogle({ token: [{ status: 200, fixture: "token-refresh" }], events: [{ status: 403, fixture: "events-403-scope" }] }));
    expect((await read(await sync())).status).toBe(409);
    expect((await read(await state())).body.data.connection.status).toBe("revoked");

    const other = await makeUser();
    await connected(other);
    stubGoogle(fakeGoogle({ token: [{ status: 200, fixture: "token-refresh" }], events: [{ status: 401, fixture: "events-401" }] }));
    expect((await read(await sync())).status).toBe(409);
    expect((await read(await state())).body.data.connection.status).toBe("revoked");
  });

  it("a token that expires between the consent and the first read is refreshed once", async () => {
    const me = await makeUser();
    signInAs(me);
    const g = stubGoogle(fakeGoogle({
      token: [{ status: 200, fixture: "token-exchange" }, { status: 200, fixture: "token-refresh" }],
      events: [{ status: 401, fixture: "events-401" }, { status: 200, fixture: "events-empty" }],
    }));
    expect((await roundTrip((st) => `state=${st}&code=c`)).back.search).toBe("?calendar=connected");
    expect(g.calls.map((c) => c.authorization ?? c.url.split("?")[0])).toEqual([
      "https://oauth2.googleapis.com/token",
      "Bearer ya29.fixture-access-token-1",
      "https://oauth2.googleapis.com/token",
      "Bearer ya29.fixture-access-token-2",
    ]);
  });
});

describe("disconnecting, and who can do what", () => {
  it("revokes at Google, forgets the grant, and removes the calendar's unfinished tasks only", async () => {
    const me = await makeUser();
    await connected(me);
    await Task.updateOne({ userId: me, externalId: "gym_20261119T003000Z" }, { $set: { completed: true } });
    await Task.create({ userId: me, title: "Typed in", priority: "high" });
    const g = stubGoogle(fakeGoogle({ revoke: 200 }));
    const r = await read(await disconnect());
    expect(r.body.data).toEqual({ revokedAtGoogle: true, removedTasks: 4 });
    expect(new URLSearchParams(g.calls[0].body).get("token")).toBe("1//fixture-refresh-token");
    expect(await CalendarConnection.countDocuments({})).toBe(0);
    expect((await Task.find({ userId: me }).lean<{ title: string }[]>()).map((t) => t.title).sort()).toEqual(["Gym", "Typed in"]);
    expect((await read(await disconnect())).status).toBe(404);
  });

  it("Google not answering the revoke still disconnects here, and says so", async () => {
    const me = await makeUser();
    await connected(me);
    stubGoogle(fakeGoogle({ revoke: 503 }));
    expect((await read(await disconnect())).body.data.revokedAtGoogle).toBe(false);
    expect(await CalendarConnection.countDocuments({})).toBe(0);
  });

  it("every route needs the signed-in user, and works on their own calendar only", async () => {
    signInAs(null);
    for (const res of [await connect(request("GET", "/x")), await callback(request("GET", "/x")), await state(), await sync(), await disconnect()]) {
      expect(res.status).toBe(401);
    }
    const [me, other] = [await makeUser(), await makeUser()];
    await connected(me);
    signInAs(other);
    expect((await read(await sync())).status).toBe(404);
    expect((await read(await state())).body.data.connection).toBeNull();
    expect((await read(await disconnect())).status).toBe(404);
    expect(await CalendarConnection.countDocuments({ userId: me })).toBe(1);
  });
});
