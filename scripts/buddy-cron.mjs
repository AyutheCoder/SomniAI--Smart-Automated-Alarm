#!/usr/bin/env node
// Runs the server's scheduled checks every minute against a local server, as a
// scheduler does in production (BUDDY.md, MONITORING.md): the wake-buddy
// alerts, and the AI Brain's uptime check (prompt 7.3).
//
//   npm run dev            (one terminal)
//   npm run buddy:cron     (another; --url to point elsewhere, --once for one run)
//
// Reads CRON_SECRET from the environment or .env.local, and never prints it.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const base = args.includes("--url") ? args[args.indexOf("--url") + 1] : "http://localhost:3000";
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

const JOBS = {
  "buddy alerts": {
    path: "/api/cron/buddy-alerts",
    line: (d) => {
      const tried = d.attempts.map((a) => `${a.status}${a.detail ? ` (${a.detail})` : ""}`).join(", ");
      return `${d.pairs} pair(s), ${d.sent} sent${tried ? `: ${tried}` : ""}${Object.keys(d.skipped).length ? `; skipped ${JSON.stringify(d.skipped)}` : ""}`;
    },
  },
  "AI Brain": {
    path: "/api/cron/ai-brain-health",
    line: (d) => `${d.state}${d.reason ? ` (${d.reason})` : ""}${d.event ? `, ${d.event === "down" ? "outage started" : "outage over"}` : ""}${d.alert ? `; alert ${d.alert.status}${d.alert.detail ? ` (${d.alert.detail})` : ""}` : ""}`,
  },
};

async function tick() {
  const at = new Date().toLocaleTimeString();
  for (const [name, job] of Object.entries(JOBS)) {
    const url = base + job.path;
    try {
      const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${key}` } });
      const body = await res.json().catch(() => ({}));
      console.log(`${at} ${name}: ${res.ok ? job.line(body.data) : `${res.status} ${body.error ?? ""}`}`);
    }
    catch (e) {
      console.log(`${at} ${name}: couldn't reach ${url}: ${e.message}`);
    }
  }
}

await tick();
if (!once) {
  setInterval(tick, 60_000);
}
