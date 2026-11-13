"use client";

import { useCallback, useEffect, useState } from "react";
import { Sunrise } from "lucide-react";
import { clockBefore, localDate } from "@/lib/bedtime";
import type { MorningReport, ReportLines } from "@/lib/morningReport";

/** Sent when a ring's result has reached the server, so the report can be read. */
export const REPORT_CHANGED = "somniai:report-changed";

type Report = MorningReport & { lines: ReportLines };

/**
 * The morning report (prompt 3.4): the newest alarm's stage, wake check,
 * last night's plan, streak and escalation profile, worded by the server in
 * this device's time zone. When last night's plan can't be judged because no
 * bedtime was recorded, it asks for one.
 */
export default function MorningReportCard() {
  const [report, setReport] = useState<Report | null>(null);
  const [bedtime, setBedtime] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/wake-reports?tz=${encodeURIComponent(tz)}`);
      const json = await res.json();
      if (json.ok) {
        setReport(json.data.reports[0] ?? null);
      }
    }
    catch {
      // Offline: keep whatever is shown.
    }
  }, []);

  useEffect(() => {
    void load();
    const changed = () => void load();
    window.addEventListener(REPORT_CHANGED, changed);
    return () => window.removeEventListener(REPORT_CHANGED, changed);
  }, [load]);

  async function saveBedtime(e: React.FormEvent) {
    e.preventDefault();
    if (!report || !bedtime) {
      return;
    }
    const ringAt = new Date(report.ringAt);
    const sleepTime = clockBefore(bedtime, ringAt);
    const wakeTime = report.endedAt ? new Date(report.endedAt) : null;
    const res = await fetch("/api/sleep-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: localDate(ringAt),
        sleepTime: sleepTime.toISOString(),
        ...(wakeTime && wakeTime > sleepTime ? { wakeTime: wakeTime.toISOString() } : {}),
        source: "manual",
      }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    if (json?.ok) {
      setNotice(null);
      setBedtime("");
      await load();
    }
    else {
      setNotice(json?.error ?? "Couldn't save your bedtime. Try again once you're online.");
    }
  }

  if (!report) {
    return null;
  }
  const { lines } = report;
  return (
    <section aria-label="Morning report" className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-white">
        <Sunrise className="h-5 w-5 text-amber-300" /> Morning report
      </h2>
      <p className="mb-3 text-sm text-slate-400">{lines.title}</p>
      <ul className="space-y-1.5 text-sm text-slate-200">
        <li>{lines.stage}</li>
        <li>{lines.verification}</li>
        <li>{lines.plan}</li>
        <li>{lines.streak}</li>
        <li className="text-slate-400">{lines.profile}</li>
      </ul>
      {report.plan.status === "unknown" && (
        <form onSubmit={saveBedtime} className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="report-bedtime" className="text-slate-300">When did you go to bed?</label>
          <input
            id="report-bedtime"
            type="time"
            required
            value={bedtime}
            onChange={(e) => setBedtime(e.target.value)}
            className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-white"
          />
          <button type="submit" className="rounded-lg bg-indigo-500 px-3 py-1 font-medium text-white hover:bg-indigo-400">
            Save
          </button>
        </form>
      )}
      {notice && <p role="alert" className="mt-2 text-sm text-amber-200">{notice}</p>}
    </section>
  );
}
