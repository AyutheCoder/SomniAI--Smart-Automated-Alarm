"use client";

import { useEffect, useState } from "react";
import type { PublicStatus } from "@/lib/uptime";

/** The words for a status, or null when there's nothing to say (7.3). */
export function serviceText(s: PublicStatus | null, now = new Date()): string | null {
  if (!s || s.state !== "down" || !s.since) {
    return null;
  }
  const since = new Date(s.since);
  const when = since.toDateString() === now.toDateString()
    ? since.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : since.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  return `Predictions and the wake planner are offline since ${when}. Alarms ring as normal, and SomniAI uses its own rules until they're back.`;
}

/** Says so when the AI Brain is down (lib/uptime.ts); checks again every two minutes. */
export default function ServiceBanner() {
  const [status, setStatus] = useState<PublicStatus | null>(null);
  useEffect(() => {
    const load = () => void fetch("/api/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setStatus(j.ok ? (j.data.aiBrain as PublicStatus) : null))
      .catch(() => {});
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);
  const text = serviceText(status);
  return text ? (
    <p role="status" aria-label="Service status" className="mb-6 rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100">
      {text}
    </p>
  ) : null;
}
