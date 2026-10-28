#!/usr/bin/env node
// Runs the wake-buddy alert check every minute against a local server, as a
// scheduler does in production (BUDDY.md):
//
//   npm run dev            (one terminal)
//   npm run buddy:cron     (another; --url to point elsewhere, --once for one run)
//
// Reads CRON_SECRET from the environment or .env.local, and never prints it.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const url = (args.includes("--url") ? args[args.indexOf("--url") + 1] : "http://localhost:3000") + "/api/cron/buddy-alerts";
const once = args.includes("--once");

function secret() {
  if (process.env.CRON_SECRET) {
    return process.env.CRON_SECRET;
  }
  try {
    const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith("CRON_SECRET="));
    return line ? line.slice("CRON_SECRET=".length).trim().replace(/^["']|["']$/g, "") : "";
  }
  catch {
    return "";
  }
}

const key = secret();
if (!key) {
  console.error("buddy-cron: set CRON_SECRET in .env.local (BUDDY.md, step 4), then restart npm run dev.");
  process.exit(1);
}

async function tick() {
  const at = new Date().toLocaleTimeString();
  try {
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${key}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log(`${at} ${res.status} ${body.error ?? ""}`);
      return;
    }
    const d = body.data;
    const tried = d.attempts.map((a) => `${a.status}${a.detail ? ` (${a.detail})` : ""}`).join(", ");
    console.log(`${at} ${d.pairs} pair(s), ${d.sent} sent${tried ? `: ${tried}` : ""}${Object.keys(d.skipped).length ? `; skipped ${JSON.stringify(d.skipped)}` : ""}`);
  }
  catch (e) {
    console.log(`${at} couldn't reach ${url}: ${e.message}`);
  }
}

await tick();
if (!once) {
  setInterval(tick, 60_000);
}
