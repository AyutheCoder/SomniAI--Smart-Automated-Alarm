// What has gone wrong lately (prompt 7.3): the error reports in SomniAI's own
// database (models/ErrorEvent.ts), most recent first, one line per kind of error.
//
//   npm run errors                     the last 7 days
//   npm run errors -- --days 30        further back (reports are kept 90 days)
//   npm run errors -- --source ai-brain   server, browser or ai-brain only
//   npm run errors -- --stack          with each one's stack
//
// Reads MONGO_DB_URI as the app does, from the environment or .env.local.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ago = (ms) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** The summary as lines of text. */
export function summarise(events, now = new Date(), { stack = false } = {}) {
  if (events.length === 0) {
    return ["No errors recorded in this period."];
  }
  const total = events.reduce((n, e) => n + e.count, 0);
  const lines = [`${events.length} kind(s) of error, ${total} time(s) in all:`, ""];
  for (const e of events) {
    lines.push(`${String(e.count).padStart(5)}x  ${e.source.padEnd(8)} ${e.kind}: ${e.message}`);
    lines.push(`        ${e.where ?? "(no place)"}, last ${ago(now - new Date(e.lastAt))}, first ${ago(now - new Date(e.firstAt))}`);
    if (stack && e.stack) {
      for (const f of e.stack.split("\n")) {
        lines.push(`          ${f}`);
      }
    }
  }
  return lines;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const days = Number(arg("--days") ?? 7);
  const source = arg("--source");
  if (!(days > 0) || (source && !["server", "browser", "ai-brain"].includes(source))) {
    console.error("usage: npm run errors -- [--days N] [--source server|browser|ai-brain] [--stack]");
    process.exit(2);
  }
  let uri = process.env.MONGO_DB_URI;
  if (!uri && existsSync(".env.local")) {
    uri = readFileSync(".env.local", "utf8").match(/^MONGO_DB_URI=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
  }
  if (!uri) {
    console.error("MONGO_DB_URI is not set");
    process.exit(2);
  }
  const { MongoClient } = await import("mongodb");
  const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const now = new Date();
    const filter = { lastAt: { $gte: new Date(now.getTime() - days * 86_400_000) }, ...(source ? { source } : {}) };
    const events = await client.db().collection("errorevents").find(filter).sort({ lastAt: -1 }).limit(200).toArray();
    for (const line of summarise(events, now, { stack: process.argv.includes("--stack") })) {
      console.log(line);
    }
  }
  finally {
    await client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`errors: ${e.message}`);
    process.exit(1);
  });
}
