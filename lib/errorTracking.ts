// Error tracking (prompt 7.3), kept in SomniAI's own database (models/ErrorEvent.ts).
//
// Reports come from three places: route handlers that hit an error they don't
// handle (lib/http.ts routeError), the browser (POST /api/errors, from
// lib/errorReporter.ts and the error boundaries), and the AI Brain (its 500
// answers, recorded by lib/aiClient.ts). Each is reduced to what helps fix it:
// the error's type, a message and stack with personal details removed, and
// where it happened. The same error again only raises its count.
//
// Recording never throws and never blocks the answer: if the database can't
// take the report (it may be why there was an error), it goes to the server
// log as one JSON line instead.

import { createHash } from "node:crypto";
import type { ErrorSource } from "@/models/ErrorEvent";

export interface ErrorReport {
  source: ErrorSource;
  kind: string;
  message: string;
  stack?: string;
  where?: string;
}

const MAX = { kind: 100, message: 500, stack: 2000, where: 200 } as const;
const STACK_FRAMES = 8;
export const KEEP_DAYS = 90;

/**
 * Removes what could identify a person or open an account: email addresses,
 * tokens, ids, long numbers (phones), and the query part of URLs. Error
 * messages quote whatever they were given, so this runs on every report.
 */
export function scrub(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?/g, "<token>")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 <token>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{24}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{32,}\b/gi, "<hex>")
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, "$1?<query>")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "<number>");
}

const clip = (s: string | undefined, n: number) => (s === undefined ? undefined : s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A path without its query, scrubbed. */
export function placeOf(where: string | undefined): string | undefined {
  if (!where) {
    return undefined;
  }
  return clip(scrub(where.split(/[?#]/)[0]), MAX.where);
}

export function cleanStack(stack: string | undefined): string | undefined {
  if (!stack) {
    return undefined;
  }
  const frames = stack.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("at ")).slice(0, STACK_FRAMES);
  return frames.length ? clip(scrub(frames.join("\n")), MAX.stack) : undefined;
}

/** The report as stored: scrubbed and clipped. */
export function clean(r: ErrorReport): ErrorReport {
  return {
    source: r.source,
    kind: clip(scrub(r.kind || "Error"), MAX.kind)!,
    message: clip(scrub(r.message || "(no message)"), MAX.message)!,
    stack: cleanStack(r.stack),
    where: placeOf(r.where),
  };
}

/**
 * Same error, same fingerprint: the source, type, message with its numbers
 * blanked, place, and the top stack frame without line numbers (so a new build
 * doesn't split one error into many).
 */
export function fingerprint(r: ErrorReport): string {
  const c = clean(r);
  const top = (c.stack ?? "").split("\n")[0]?.replace(/:\d+(:\d+)?\)?$/, "") ?? "";
  const shape = c.message.replace(/\d+/g, "#");
  return createHash("sha256").update([c.source, c.kind, shape, c.where ?? "", top].join("|")).digest("hex").slice(0, 32);
}

/** What a thrown value says about itself. */
export function reportOf(err: unknown, source: ErrorSource, where?: string): ErrorReport {
  if (err instanceof Error) {
    return { source, kind: err.name || "Error", message: err.message, stack: err.stack, where };
  }
  return { source, kind: typeof err, message: typeof err === "string" ? err : JSON.stringify(err) ?? String(err), where };
}

export interface ErrorStore {
  record(fingerprint: string, report: ErrorReport, now: Date): Promise<void>;
}

const mongoStore: ErrorStore = {
  async record(fp, r, now) {
    const { connectToDatabase } = await import("@/lib/mongoose");
    const { ErrorEvent } = await import("@/models/ErrorEvent");
    await connectToDatabase();
    const update = {
      $setOnInsert: { fingerprint: fp, source: r.source, kind: r.kind, firstAt: now },
      $set: { message: r.message, stack: r.stack, where: r.where, lastAt: now, expiresAt: new Date(now.getTime() + KEEP_DAYS * 86_400_000) },
      $inc: { count: 1 },
    };
    try {
      await ErrorEvent.updateOne({ fingerprint: fp }, update, { upsert: true });
    }
    catch (e) {
      // Two reports of a new error at once: the second upsert loses the race; count it on the first.
      if ((e as { code?: number }).code !== 11000) {
        throw e;
      }
      await ErrorEvent.updateOne({ fingerprint: fp }, update);
    }
  },
};

/** Records an error. Never throws: "recorded" in the database, or "logged" to the server log. */
export async function recordError(report: ErrorReport, now = new Date(), store: ErrorStore = mongoStore): Promise<"recorded" | "logged"> {
  let c: ErrorReport;
  let fp: string;
  try {
    c = clean(report);
    fp = fingerprint(report);
  }
  catch {
    return "logged";
  }
  try {
    await store.record(fp, c, now);
    return "recorded";
  }
  catch (e) {
    console.error(JSON.stringify({ event: "error-not-recorded", why: e instanceof Error ? e.message : String(e), fingerprint: fp, ...c }));
    return "logged";
  }
}
