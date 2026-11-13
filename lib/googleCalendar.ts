// Google Calendar, read-only (prompt 4.1). The OAuth steps and the Calendar
// API, with the network passed in, so tests run on recorded fixtures and never
// reach Google. Server-only: lib/calendarServer.ts stores the connection and
// turns events into tasks.
//
// Connecting is incremental authorisation on the same Google OAuth client as
// sign-in: SomniAI asks for calendar access only when the user connects it,
// with include_granted_scopes so the grant adds to what sign-in already has.
// The scope is the narrowest that reads events: calendar.events.readonly.

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
/** openid and email name the Google account that was connected, nothing more. */
export const SCOPES = ["openid", "email", CALENDAR_SCOPE];
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
/** Upcoming means the next week; more pages than this aren't read. */
export const WINDOW_DAYS = 7;
const MAX_PAGES = 4;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** The OAuth client sign-in uses; null if Google isn't set up on this server. */
export function googleConfigFromEnv(env: Record<string, string | undefined> = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const base = env.NEXTAUTH_URL;
  if (!clientId || !clientSecret || !base) {
    return null;
  }
  return { clientId, clientSecret, redirectUri: `${base.replace(/\/+$/, "")}/api/calendar/callback` };
}

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ status: number; json: () => Promise<unknown> }>;

export function authorizationUrl(cfg: GoogleConfig, state: string, loginHint?: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    include_granted_scopes: "true",
    // A refresh token, so SomniAI can read the calendar later without the user present.
    access_type: "offline",
    // Google sends a refresh token only with consent; asked each time someone connects.
    prompt: "consent",
    state,
  });
  if (loginHint) {
    q.set("login_hint", loginHint);
  }
  return `${AUTH_URL}?${q.toString()}`;
}

export type TokenResult =
  | { ok: true; accessToken: string; expiresAt: Date; refreshToken: string | null; scopes: string[]; email: string | null }
  /** revoked: Google says the grant is gone (removed by the user, or expired); reconnect. */
  | { ok: false; revoked: boolean; error: string };

/** The email in an id_token straight from Google's token endpoint (for display only). */
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  }
  catch {
    return null;
  }
}

async function tokenRequest(params: Record<string, string>, fetchFn: Fetch, now: Date): Promise<TokenResult> {
  let res;
  try {
    res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
  }
  catch (e) {
    return { ok: false, revoked: false, error: `Google unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; id_token?: string;
    error?: string; error_description?: string;
  };
  if (res.status === 200 && body.access_token) {
    return {
      ok: true,
      accessToken: body.access_token,
      expiresAt: new Date(now.getTime() + (body.expires_in ?? 3600) * 1000),
      refreshToken: body.refresh_token ?? null,
      scopes: (body.scope ?? "").split(" ").filter(Boolean),
      email: emailFromIdToken(body.id_token),
    };
  }
  return {
    ok: false,
    revoked: body.error === "invalid_grant",
    error: `Google ${res.status} ${body.error ?? ""}${body.error_description ? `: ${body.error_description}` : ""}`.trim(),
  };
}

export function exchangeCode(code: string, cfg: GoogleConfig, fetchFn: Fetch, now = new Date()): Promise<TokenResult> {
  return tokenRequest({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  }, fetchFn, now);
}

export function refreshAccessToken(refreshToken: string, cfg: GoogleConfig, fetchFn: Fetch, now = new Date()): Promise<TokenResult> {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
  }, fetchFn, now);
}

/** Tells Google to drop the grant. Whether it answered is returned, not thrown. */
export async function revokeToken(token: string, fetchFn: Fetch): Promise<boolean> {
  try {
    const res = await fetchFn(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    // 400 invalid_token: already revoked, which is what was wanted.
    return res.status === 200 || res.status === 400;
  }
  catch {
    return false;
  }
}

/** The parts of a Calendar API event SomniAI reads. */
export interface GoogleEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  updated?: string;
  eventType?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

export type EventsResult =
  | { ok: true; events: GoogleEvent[] }
  /** unauthorized: the access token was refused (expired, or the grant revoked). */
  | { ok: false; kind: "unauthorized" | "no_permission" | "failed"; error: string };

export async function listUpcomingEvents(accessToken: string, now: Date, fetchFn: Fetch): Promise<EventsResult> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: new Date(now.getTime() + WINDOW_DAYS * 86_400_000).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      // Cancelled ones too, so their tasks can be removed.
      showDeleted: "true",
      maxResults: "100",
    });
    if (pageToken) {
      q.set("pageToken", pageToken);
    }
    let res;
    try {
      res = await fetchFn(`${EVENTS_URL}?${q.toString()}`, { headers: { authorization: `Bearer ${accessToken}` } });
    }
    catch (e) {
      return { ok: false, kind: "failed", error: `Google Calendar unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
    const body = (await res.json().catch(() => ({}))) as {
      items?: GoogleEvent[]; nextPageToken?: string; error?: { message?: string; status?: string };
    };
    if (res.status === 401) {
      return { ok: false, kind: "unauthorized", error: body.error?.message ?? "Google Calendar refused the access token" };
    }
    if (res.status === 403) {
      return { ok: false, kind: "no_permission", error: body.error?.message ?? "SomniAI wasn't given access to the calendar" };
    }
    if (res.status !== 200 || !Array.isArray(body.items)) {
      return { ok: false, kind: "failed", error: `Google Calendar ${res.status}${body.error?.message ? `: ${body.error.message}` : ""}` };
    }
    events.push(...body.items);
    pageToken = body.nextPageToken;
    if (!pageToken) {
      break;
    }
  }
  return { ok: true, events };
}

/** Event kinds that aren't something to get up for. */
const NOT_TASKS = new Set(["workingLocation", "outOfOffice", "birthday"]);

export type EventTask =
  | { externalId: string; cancelled: true }
  | { externalId: string; cancelled: false; title: string; description: string; dueDate: string; dueTime?: string; updated: string | null };

function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * An event as a task, in the event's own local date and time (the time the
 * user sees in their calendar). Null for events that aren't tasks: declined
 * ones, working location, out of office, birthdays.
 */
export function eventToTask(e: GoogleEvent): EventTask | null {
  if (!e.id) {
    return null;
  }
  if (e.status === "cancelled") {
    return { externalId: e.id, cancelled: true };
  }
  if (e.eventType && NOT_TASKS.has(e.eventType)) {
    return null;
  }
  if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) {
    return null;
  }
  const dateTime = e.start?.dateTime?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  const date = e.start?.date?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (!dateTime && !date) {
    return null;
  }
  return {
    externalId: e.id,
    cancelled: false,
    title: (e.summary?.trim() || "(No title)").slice(0, 200),
    description: plainText(e.description ?? "").slice(0, 2000),
    dueDate: dateTime ? dateTime[1] : date!,
    ...(dateTime ? { dueTime: dateTime[2] } : {}),
    updated: e.updated ?? null,
  };
}
