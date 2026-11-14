"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Download, Trash2 } from "lucide-react";
import type { TelemetrySummary } from "@/lib/telemetry";
import { SomniAlarm } from "@/lib/nativeAlarm";
import type { NativeConnection } from "@/lib/nativeSync";
import { TELEMETRY_CONSENT } from "@/lib/telemetryConsent";
import { allow, deleteEverything, hasTelemetry, interactionText, syncPhone, withdraw, type Outcome } from "@/lib/telemetryClient";

const BUTTON = "inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10 disabled:opacity-50";

/**
 * Alarm telemetry (prompt 5.1): off until the user allows it, with the text
 * they agree to in front of them; then stop, download or delete at any time.
 */
export default function TelemetryPanel({ native = null }: { native?: NativeConnection | null }) {
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [note, setNote] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const phone = hasTelemetry(native) ? SomniAlarm : null;

  const load = useCallback(async () => {
    try {
      const json = await (await fetch("/api/telemetry", { cache: "no-store" })).json();
      if (json.ok) {
        setSummary(json.data as TelemetrySummary);
        return json.data as TelemetrySummary;
      }
    }
    catch {
      // Shown as loading until it answers.
    }
    return null;
  }, []);

  useEffect(() => {
    void load().then((s) => {
      // The phone holds its own copy of the consent; bring it in step with the account.
      if (s && phone) {
        void syncPhone(phone, s.consent).catch(() => {});
      }
    });
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<Outcome>) {
    setBusy(true);
    try {
      setNote(await action());
    }
    catch (e) {
      setNote({ ok: false, text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}` });
    }
    finally {
      setBusy(false);
      setConfirming(false);
      await load();
    }
  }

  const on = summary?.consent.granted === true;
  return (
    <section aria-label="Alarm telemetry" className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-white">
        <Activity className="h-5 w-5 text-violet-300" /> {TELEMETRY_CONSENT.title}
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-300"}`}>
          {summary === null ? "…" : on ? "on" : "off"}
        </span>
      </h2>
      {summary === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <details open={!on} className="mb-3 text-xs text-slate-300">
            <summary className="cursor-pointer text-slate-400">What is recorded{on ? "" : ", if you allow it"}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {TELEMETRY_CONSENT.points.map((p) => <li key={p}>{p}</li>)}
            </ul>
            <p className="mt-2 text-slate-500">{TELEMETRY_CONSENT.separately}</p>
          </details>
          <p className="mb-3 text-xs text-slate-400">
            {on
              ? `On since ${new Date(summary.consent.grantedAt as string).toLocaleDateString()}. ${summary.wakes} ${summary.wakes === 1 ? "wake" : "wakes"} recorded.`
              : summary.wakes > 0
                ? `Off. ${summary.wakes} ${summary.wakes === 1 ? "wake" : "wakes"} recorded earlier ${summary.wakes === 1 ? "is" : "are"} kept until you delete ${summary.wakes === 1 ? "it" : "them"}.`
                : "Off. Nothing is recorded."}
            {native === null || !("api" in native) ? " Recording happens in the SomniAI Android app; here you can turn it on or off, download or delete." : ""}
            {native !== null && "api" in native && !phone ? " Update the app to record on this phone." : ""}
          </p>
          {on && summary.latest.length > 0 && (
            <ul className="mb-3 space-y-0.5 text-xs text-slate-400" aria-label="Latest wakes">
              {summary.latest.map((w) => (
                <li key={w.scheduledFor}>
                  {new Date(w.scheduledFor).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}: {w.outcome}, first touch {interactionText(w.firstInteractionMs)}, {w.snoozes} {w.snoozes === 1 ? "snooze" : "snoozes"}{w.stage ? `, reached ${w.stage}` : ""}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {on
              ? <button type="button" disabled={busy} onClick={() => void run(() => withdraw(phone))} className={BUTTON}>Stop recording</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => allow(phone))} className={BUTTON}>Allow telemetry</button>}
            <a href="/api/telemetry/export" download className={BUTTON}><Download className="h-3.5 w-3.5" /> Download everything</a>
            {confirming ? (
              <span className="flex items-center gap-2 text-xs text-rose-200">
                Delete {summary.wakes} recorded {summary.wakes === 1 ? "wake" : "wakes"}? This can&apos;t be undone.
                <button type="button" disabled={busy} onClick={() => void run(() => deleteEverything(phone))} className={BUTTON}>Delete</button>
                <button type="button" onClick={() => setConfirming(false)} className={BUTTON}>Cancel</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className={BUTTON}><Trash2 className="h-3.5 w-3.5" /> Delete everything</button>
            )}
          </div>
        </>
      )}
      {note && <p role="status" aria-label="Telemetry" className={`mt-3 text-xs ${note.ok ? "text-violet-200" : "text-amber-300"}`}>{note.text}</p>}
    </section>
  );
}
