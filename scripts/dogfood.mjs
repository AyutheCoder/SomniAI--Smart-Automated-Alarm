// The dogfooding log's facts for one night (prompt 8.1, DOGFOOD.md), from
// production's own records, so a row in the log isn't written from memory at 7 am.
//
//   npm run dogfood                    last night (the night ending this noon)
//   npm run dogfood -- --night 2026-11-20    the night ending that morning
//   npm run dogfood -- --labels        with alarm labels (to read here; the log is public, so not by default)
//
// For each tester in DOGFOOD_ACCOUNTS ("A=address,B=address" in .env.deploy.local,
// never in the repository): every ring due that night, when it fired, how it
// ended (level, wake check), and every enabled alarm that was due and has no ring
// on record at all, the silent miss nobody would remember. Reads production
// (ATLAS_PRODUCTION_URI). Nights run noon to noon in --tz (default Asia/Kolkata).

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "./deploy.mjs";

/** How late a ring can fire and still count as on time. */
export const ON_TIME_MS = 60_000;
/** How long after its time an alarm with no ring on record is flagged (the phone may sync late). */
export const SYNC_GRACE_MS = 10 * 60_000;

/** Testers from "A=address,B=address". */
export function parseAccounts(value) {
  const out = [];
  for (const part of (value ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^([A-Za-z0-9]+)=(\S+@\S+)$/.exec(part);
    if (!m) {
      throw new Error(`DOGFOOD_ACCOUNTS: "${part}" isn't label=address`);
    }
    out.push({ label: m[1], email: m[2].toLowerCase() });
  }
  if (out.length === 0) {
    throw new Error("no testers: put DOGFOOD_ACCOUNTS=A=you@example.com,B=them@example.com in .env.deploy.local");
  }
  return out;
}

/** The UTC offset in minutes of a time zone at an instant. */
function offsetMinutes(tz, at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The night ending on `morning` (YYYY-MM-DD): noon the day before to noon that day, in `tz`. */
export function nightWindow(morning, tz) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(morning)) {
    throw new Error(`--night must be a date like 2026-11-20, not ${morning}`);
  }
  const [y, m, d] = morning.split("-").map(Number);
  const noonUtc = Date.UTC(y, m - 1, d, 12, 0, 0);
  const end = new Date(noonUtc - offsetMinutes(tz, new Date(noonUtc)) * 60_000);
  return { start: new Date(end.getTime() - 86_400_000), end };
}

/** The local date (YYYY-MM-DD) of an instant in `tz`. */
export function localDate(at, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function hhmm(at, tz) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

const ref = (id) => `#${String(id).slice(-4)}`;

/**
 * One tester's night as findings, newest facts first in each ring. Pure.
 * reports: WakeReports due in the window; fires: alarm_fire events in the window;
 * alarms: the tester's enabled alarms whose time falls in the window.
 */
export function nightFindings({ reports, fires, alarms, now, tz, labels = false }) {
  const rings = [];
  const flags = [];
  const name = (alarmId, label) => (labels && label ? `${label} ${ref(alarmId)}` : ref(alarmId));
  const firesByAlarm = new Map();
  for (const f of fires) {
    const id = String(f.meta?.alarmId ?? "");
    firesByAlarm.set(id, [...(firesByAlarm.get(id) ?? []), new Date(f.at)]);
  }
  const reported = new Set();
  for (const r of [...reports].sort((a, b) => new Date(a.ringAt) - new Date(b.ringAt))) {
    const id = String(r.alarmId);
    const due = new Date(r.ringAt);
    reported.add(`${id}@${due.getTime()}`);
    const fired = (firesByAlarm.get(id) ?? []).filter((t) => Math.abs(t - due) < 6 * 3600_000).sort((a, b) => a - b)[0];
    const late = fired ? fired - due : null;
    const v = r.verification ?? {};
    const check = !v.required ? "no check" : v.passed ? `check passed${v.seconds != null ? ` in ${Math.round(v.seconds)} s` : ""}${v.score != null ? `, score ${v.score}` : ""}` : "check not passed";
    const parts = [
      `${hhmm(due, tz)} ${name(id, r.label)}`,
      r.outcome === "missed" ? "MISSED (no one stopped it)" : "woke",
      r.level ? `level ${r.level}${r.levelLabel ? ` (${r.levelLabel})` : ""}` : null,
      check,
      late === null ? "fire time not recorded" : late > ON_TIME_MS ? `fired ${Math.round(late / 1000)} s LATE` : "on time",
    ].filter(Boolean);
    rings.push(parts.join(", "));
    if (r.outcome === "missed") {
      flags.push(`MISS: ${hhmm(due, tz)} ${name(id, r.label)} rang and nobody stopped it`);
    }
    if (late !== null && late > ON_TIME_MS) {
      flags.push(`MISS: ${hhmm(due, tz)} ${name(id, r.label)} fired ${Math.round(late / 1000)} s late`);
    }
  }
  // A fire with no report: rang, but its ending never reached the server.
  for (const [id, times] of firesByAlarm) {
    for (const t of times) {
      if (![...reported].some((k) => k.startsWith(`${id}@`) && Math.abs(Number(k.split("@")[1]) - t) < 6 * 3600_000)) {
        rings.push(`${hhmm(t, tz)} ${name(id)}, rang, no outcome recorded`);
        flags.push(`CHECK: ${hhmm(t, tz)} ${name(id)} rang but how it ended never reached the server (still ringing, or the phone hasn't synced)`);
      }
    }
  }
  // Due, past the grace, and nothing at all on record: the silent miss.
  for (const a of alarms) {
    const id = String(a._id);
    const due = new Date(a.scheduledTime);
    if (now - due < SYNC_GRACE_MS || (firesByAlarm.get(id) ?? []).length > 0 || [...reported].some((k) => k.startsWith(`${id}@`))) {
      continue;
    }
    rings.push(`${hhmm(due, tz)} ${name(id, a.label)}, NO RING ON RECORD`);
    flags.push(`MISS?: ${hhmm(due, tz)} ${name(id, a.label)} was due and nothing was recorded: did it ring? (phone off, alarm not on the phone, or not synced)`);
  }
  return { rings, flags };
}

/** The report for all testers, as Markdown to paste into DOGFOOD.md. */
export function renderNight(morning, perTester) {
  const lines = [`### Night ending ${morning}`, ""];
  for (const t of perTester) {
    lines.push(`**Tester ${t.label}:** ${t.rings.length || t.flags.length ? "" : "no alarm was due."}`);
    for (const r of t.rings) {
      lines.push(`- ${r}`);
    }
    for (const f of t.flags) {
      lines.push(`- **${f}**`);
    }
    lines.push("");
  }
  const flagged = perTester.reduce((n, t) => n + t.flags.length, 0);
  lines.push(flagged ? `${flagged} thing(s) to look at: each real one goes under Failures with a test and a fix.` : "Nothing flagged from the records. Add anything the records can't see: false alarms, annoyances.");
  return lines;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const tz = arg("--tz") ?? "Asia/Kolkata";
  const now = new Date();
  const morning = arg("--night") ?? localDate(now, tz);
  const window = nightWindow(morning, tz);
  const deploy = existsSync(".env.deploy.local") ? parseEnv(readFileSync(".env.deploy.local", "utf8")) : {};
  const testers = parseAccounts(deploy.DOGFOOD_ACCOUNTS);
  if (!deploy.ATLAS_PRODUCTION_URI) {
    throw new Error("ATLAS_PRODUCTION_URI isn't in .env.deploy.local");
  }
  const { MongoClient } = await import("mongodb");
  const client = await MongoClient.connect(deploy.ATLAS_PRODUCTION_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    const db = client.db();
    const out = [];
    for (const t of testers) {
      const user = await db.collection("users").findOne({ email: t.email }, { projection: { _id: 1 } });
      if (!user) {
        out.push({ label: t.label, rings: [], flags: [`CHECK: no production account for tester ${t.label}'s address`] });
        continue;
      }
      const userId = String(user._id);
      const inWindow = { $gte: window.start, $lt: window.end };
      const [reports, fires, alarms] = await Promise.all([
        db.collection("wakereports").find({ userId, ringAt: inWindow }).toArray(),
        db.collection("behaviorevents").find({ userId, type: "alarm_fire", at: inWindow }).toArray(),
        db.collection("alarms").find({ userId, enabled: true, scheduledTime: inWindow }).toArray(),
      ]);
      out.push({ label: t.label, ...nightFindings({ reports, fires, alarms, now, tz, labels: process.argv.includes("--labels") }) });
    }
    const errors = await db.collection("errorevents").countDocuments({ lastAt: { $gte: window.start, $lt: window.end } });
    for (const line of renderNight(morning, out)) {
      console.log(line);
    }
    console.log(`\n(${errors} kind(s) of app error recorded in production that night.)`);
  }
  finally {
    await client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`dogfood: ${e.message}`);
    process.exit(1);
  });
}
