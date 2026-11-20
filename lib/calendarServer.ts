// The user's Google Calendar, connected and synced (prompt 4.1). Upcoming
// events become tasks, each scored by the semantic engine like a typed-in
// task; a resync updates them, and a cancelled event's task is removed (unless
// it was already done). Google refusing the stored grant marks the connection
// revoked, and the panel asks to connect again. Server-only.

import { randomBytes } from "node:crypto";
import { analyzeSemantic, type SemanticAnalysis } from "@/lib/aiClient";
import {
  CALENDAR_SCOPE,
  eventToTask,
  exchangeCode,
  googleConfigFromEnv,
  listUpcomingEvents,
  refreshAccessToken,
  revokeToken,
  type Fetch,
  type GoogleConfig,
} from "@/lib/googleCalendar";
import { open, seal } from "@/lib/secretBox";
import { CalendarConnection, type CalendarConnectionDocument } from "@/models/CalendarConnection";
import { Task } from "@/models/Task";

const SEAL_PURPOSE = "google-calendar";
const STATE_PURPOSE = "google-calendar-oauth";
/** The cookie that ties Google's answer to the browser and user that asked. */
export const STATE_COOKIE = "somni_calendar_state";
/** How long the trip to Google's consent screen may take. */
const STATE_TTL_MS = 10 * 60_000;

export interface CalendarDeps {
  google: GoogleConfig | null;
  fetch: Fetch;
  now: Date;
  analyze: (text: string) => Promise<SemanticAnalysis | undefined>;
}

export function calendarDeps(): CalendarDeps {
  return {
    google: googleConfigFromEnv(),
    fetch: fetch as unknown as Fetch,
    now: new Date(),
    analyze: async (text) => {
      try {
        return (await analyzeSemantic(text)).data;
      }
      catch {
        return undefined;
      }
    },
  };
}

/**
 * The `state` for Google's consent screen and the cookie that vouches for it:
 * the callback accepts the answer only in the same browser, for the same
 * signed-in user, within ten minutes.
 */
export function makeOAuthState(userId: string, now: Date): { state: string; cookie: string } {
  const state = randomBytes(16).toString("base64url");
  return { state, cookie: seal(JSON.stringify({ state, userId, exp: now.getTime() + STATE_TTL_MS }), STATE_PURPOSE) };
}

export function checkOAuthState(cookie: string | undefined, state: string | null, userId: string, now: Date): boolean {
  if (!cookie || !state) {
    return false;
  }
  const opened = open(cookie, STATE_PURPOSE);
  if (!opened) {
    return false;
  }
  try {
    const v = JSON.parse(opened) as { state?: string; userId?: string; exp?: number };
    return v.state === state && v.userId === userId && typeof v.exp === "number" && v.exp > now.getTime();
  }
  catch {
    return false;
  }
}

export type SyncResult =
  | { ok: true; events: number; added: number; updated: number; removed: number }
  | { ok: false; reason: "not_configured" | "not_connected" | "revoked" | "no_permission" | "failed"; error: string };

export type ConnectResult =
  | { ok: true; email: string | null; sync: SyncResult }
  | { ok: false; reason: "not_configured" | "no_calendar_access" | "failed"; error: string };

const REVOKED_TEXT = "Google no longer lets SomniAI read this calendar (access was removed, or it expired). Connect it again.";

async function markRevoked(userId: string, error: string, now: Date) {
  await CalendarConnection.updateOne({ userId }, { $set: { status: "revoked", lastError: error, lastSyncAt: now } });
}

/** Finishes connecting: the code from Google's consent screen, for this user. */
export async function connectCalendar(userId: string, code: string, deps: CalendarDeps): Promise<ConnectResult> {
  if (!deps.google) {
    return { ok: false, reason: "not_configured", error: "Google isn't set up on this server" };
  }
  const tokens = await exchangeCode(code, deps.google, deps.fetch, deps.now);
  if (!tokens.ok) {
    return { ok: false, reason: "failed", error: tokens.error };
  }
  if (!tokens.scopes.includes(CALENDAR_SCOPE)) {
    // Google lets people untick calendar access on the consent screen. Keep nothing.
    await revokeToken(tokens.refreshToken ?? tokens.accessToken, deps.fetch);
    return { ok: false, reason: "no_calendar_access", error: "Calendar access wasn't ticked on Google's screen, so nothing was connected" };
  }
  if (!tokens.refreshToken) {
    return { ok: false, reason: "failed", error: "Google didn't give SomniAI lasting access; try connecting again" };
  }
  await CalendarConnection.findOneAndUpdate(
    { userId },
    {
      $set: {
        provider: "google",
        email: tokens.email,
        refreshTokenSealed: seal(tokens.refreshToken, SEAL_PURPOSE),
        scopes: tokens.scopes,
        status: "connected",
        connectedAt: deps.now,
        lastError: null,
      },
      $unset: { lastSyncAt: 1, lastSync: 1 },
    },
    { upsert: true },
  );
  return { ok: true, email: tokens.email, sync: await syncCalendar(userId, deps, tokens.accessToken) };
}

/** Reads the week ahead into tasks. `accessToken`: one just issued, to skip a refresh. */
export async function syncCalendar(userId: string, deps: CalendarDeps, accessToken?: string): Promise<SyncResult> {
  const conn = await CalendarConnection.findOne({ userId }).lean<CalendarConnectionDocument>();
  if (!conn) {
    return { ok: false, reason: "not_connected", error: "Google Calendar isn't connected" };
  }
  if (conn.status === "revoked") {
    return { ok: false, reason: "revoked", error: conn.lastError ?? REVOKED_TEXT };
  }
  if (!deps.google) {
    return { ok: false, reason: "not_configured", error: "Google isn't set up on this server" };
  }
  const google = deps.google;
  const refreshToken = open(conn.refreshTokenSealed, SEAL_PURPOSE);
  if (!refreshToken) {
    // Sealed under another server secret: unusable, so ask to connect again.
    await markRevoked(userId, "SomniAI can't read its stored Google access any more (the server's secret changed). Connect again.", deps.now);
    return { ok: false, reason: "revoked", error: "stored access can't be opened" };
  }

  const fresh = async (): Promise<SyncResult | string> => {
    const r = await refreshAccessToken(refreshToken, google, deps.fetch, deps.now);
    if (r.ok) {
      return r.accessToken;
    }
    if (r.revoked) {
      await markRevoked(userId, REVOKED_TEXT, deps.now);
      return { ok: false, reason: "revoked", error: r.error };
    }
    await CalendarConnection.updateOne({ userId }, { $set: { lastError: `Couldn't refresh access: ${r.error}` } });
    return { ok: false, reason: "failed", error: r.error };
  };

  let token = accessToken ?? await fresh();
  if (typeof token !== "string") {
    return token;
  }
  let listed = await listUpcomingEvents(token, deps.now, deps.fetch);
  if (!listed.ok && listed.kind === "unauthorized" && accessToken) {
    // The token handed in has expired already: refresh once and try again.
    token = await fresh();
    if (typeof token !== "string") {
      return token;
    }
    listed = await listUpcomingEvents(token, deps.now, deps.fetch);
  }
  if (!listed.ok) {
    if (listed.kind === "unauthorized" || listed.kind === "no_permission") {
      await markRevoked(userId, listed.kind === "no_permission"
        ? "Google says SomniAI may not read this calendar. Connect it again and allow calendar access."
        : REVOKED_TEXT, deps.now);
      return { ok: false, reason: listed.kind === "no_permission" ? "no_permission" : "revoked", error: listed.error };
    }
    await CalendarConnection.updateOne({ userId }, { $set: { lastError: listed.error } });
    return { ok: false, reason: "failed", error: listed.error };
  }

  const counts = { events: 0, added: 0, updated: 0, removed: 0 };
  for (const event of listed.events) {
    const t = eventToTask(event);
    if (!t) {
      continue;
    }
    const key = { userId, source: "google_calendar", externalId: t.externalId };
    if (t.cancelled) {
      // A task already done stays as the record of it.
      counts.removed += (await Task.deleteOne({ ...key, completed: false })).deletedCount ?? 0;
      continue;
    }
    counts.events++;
    const existing = await Task.findOne(key).lean<{ title: string; description?: string; externalUpdated?: string }>();
    if (existing && existing.externalUpdated === (t.updated ?? undefined)) {
      continue;
    }
    const textChanged = !existing || existing.title !== t.title || (existing.description ?? "") !== t.description;
    const semantic = textChanged ? await deps.analyze([t.title, t.description].filter(Boolean).join(". ")) : undefined;
    const scored = semantic
      ? {
        aiPriority: semantic.suggestedPriority,
        importanceScore: semantic.importanceScore,
        stressScore: semantic.stressScore,
        intent: semantic.intent,
        emotion: semantic.emotion,
      }
      : {};
    const fields = {
      title: t.title,
      description: t.description,
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      externalUpdated: t.updated ?? undefined,
      ...scored,
    };
    if (existing) {
      await Task.updateOne(key, { $set: fields, ...(t.dueTime ? {} : { $unset: { dueTime: 1 } }) });
      counts.updated++;
    }
    else {
      try {
        await Task.create({ ...key, ...fields, category: "Calendar", priority: "medium" });
        counts.added++;
      }
      catch (e) {
        // Another sync added it a moment ago.
        if ((e as { code?: number }).code !== 11000) {
          throw e;
        }
      }
    }
  }
  await CalendarConnection.updateOne({ userId }, { $set: { lastSyncAt: deps.now, lastSync: counts, lastError: null } });
  return { ok: true, ...counts };
}

/**
 * Disconnects: asks Google to drop the grant, forgets it here, and removes the
 * calendar's tasks that aren't done (nothing would keep them current).
 */
export async function disconnectCalendar(userId: string, deps: CalendarDeps): Promise<{ revokedAtGoogle: boolean; removedTasks: number } | null> {
  const conn = await CalendarConnection.findOne({ userId }).lean<CalendarConnectionDocument>();
  if (!conn) {
    return null;
  }
  const token = open(conn.refreshTokenSealed, SEAL_PURPOSE);
  const revokedAtGoogle = token ? await revokeToken(token, deps.fetch) : false;
  await CalendarConnection.deleteOne({ userId });
  const removed = await Task.deleteMany({ userId, source: "google_calendar", completed: false });
  return { revokedAtGoogle, removedTasks: removed.deletedCount ?? 0 };
}

export interface CalendarState {
  /** Whether this server has a Google OAuth client to connect with. */
  configured: boolean;
  connection: {
    status: "connected" | "revoked";
    email: string | null;
    connectedAt: string;
    lastSyncAt: string | null;
    lastSync: { events: number; added: number; updated: number; removed: number } | null;
    lastError: string | null;
    upcomingTasks: number;
  } | null;
}

export async function calendarState(userId: string, deps: Pick<CalendarDeps, "google">): Promise<CalendarState> {
  const conn = await CalendarConnection.findOne({ userId }).lean<CalendarConnectionDocument>();
  if (!conn) {
    return { configured: Boolean(deps.google), connection: null };
  }
  const upcomingTasks = await Task.countDocuments({ userId, source: "google_calendar", completed: false });
  return {
    configured: Boolean(deps.google),
    connection: {
      status: conn.status,
      email: conn.email ?? null,
      connectedAt: new Date(conn.connectedAt).toISOString(),
      lastSyncAt: conn.lastSyncAt ? new Date(conn.lastSyncAt).toISOString() : null,
      lastSync: conn.lastSync ?? null,
      lastError: conn.lastError ?? null,
      upcomingTasks,
    },
  };
}
