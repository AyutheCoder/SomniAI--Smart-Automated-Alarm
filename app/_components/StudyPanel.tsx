"use client";

import { useCallback, useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { SomniAlarm } from "@/lib/nativeAlarm";
import type { NativeConnection } from "@/lib/nativeSync";
import type { StudyState } from "@/lib/studyServer";
import { TELEMETRY_CONSENT } from "@/lib/telemetryConsent";
import { hasTelemetry } from "@/lib/telemetryClient";

const BUTTON = "inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10 disabled:opacity-50";

/**
 * Study mode (prompt 6.2): join with a code after reading the consent
 * document, see your participant code, and leave at any time, which deletes
 * what the study collected.
 */
export default function StudyPanel({ native = null }: { native?: NativeConnection | null }) {
  const [state, setState] = useState<StudyState | null>(null);
  const [code, setCode] = useState("");
  const [reading, setReading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const phone = hasTelemetry(native) ? SomniAlarm : null;

  const load = useCallback(async () => {
    try {
      const json = await (await fetch("/api/study", { cache: "no-store" })).json();
      if (json.ok) {
        setState(json.data as StudyState);
      }
    }
    catch {
      // Shown as loading until it answers.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function join() {
    if (!state) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/study/enrol", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, agree: agreed, consentVersion: state.consent.version, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const json = await res.json();
      if (json.ok) {
        setState(json.data as StudyState);
        setReading(false);
        setCode("");
        // Joining turned telemetry on; tell the phone now rather than at the next opening.
        await phone?.setTelemetryConsent({ granted: true, version: TELEMETRY_CONSENT.version }).catch(() => {});
        setNote({ ok: true, text: `You're taking part as ${json.data.enrolment.participantId}. You can leave at any time, here.` });
      }
      else {
        setNote({ ok: false, text: json.error ?? "Couldn't join." });
      }
    }
    catch {
      setNote({ ok: false, text: "Couldn't reach the server." });
    }
    finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      // The phone first: it stops recording and drops what it hasn't sent.
      await phone?.setTelemetryConsent({ granted: false }).catch(() => {});
      const json = await (await fetch("/api/study", { method: "DELETE" })).json();
      if (json.ok) {
        setState(json.data as StudyState);
        setNote({ ok: true, text: "You've left the study. Everything it collected has been deleted, telemetry is off, and your alarms are back to normal." });
      }
      else {
        setNote({ ok: false, text: json.error ?? "Couldn't leave. Try again." });
      }
    }
    catch {
      setNote({ ok: false, text: "Couldn't reach the server. Try again." });
    }
    finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section aria-label="Study" className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
        <FlaskConical className="h-5 w-5 text-amber-300" /> Research study
      </h2>
      {!state ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : state.enrolment ? (
        <div className="space-y-2 text-xs text-slate-300">
          <p>
            You&apos;re taking part as <span className="font-semibold text-white">{state.enrolment.participantId}</span>, under
            consent {state.enrolment.consentVersion}, since {new Date(state.enrolment.consentedAt).toLocaleDateString()}.
          </p>
          {confirming ? (
            <p className="flex flex-wrap items-center gap-2 text-rose-200">
              Leave, and delete everything the study collected from you? This can&apos;t be undone.
              <button type="button" disabled={busy} onClick={() => void leave()} className={BUTTON}>Leave and delete</button>
              <button type="button" onClick={() => setConfirming(false)} className={BUTTON}>Cancel</button>
            </p>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={BUTTON}>Leave the study</button>
          )}
        </div>
      ) : (
        <div className="space-y-2 text-xs text-slate-300">
          <p>If a researcher gave you a code, you can join their study here.</p>
          <span className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="study-code">Study code</label>
            <input id="study-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH-JKLM"
              className="rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1 text-slate-100" />
            <button type="button" disabled={code.trim().length === 0} onClick={() => { setReading(true); setAgreed(false); }} className={BUTTON}>
              Read what taking part means
            </button>
          </span>
          {reading && (
            <div role="dialog" aria-label="Study consent" className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3">
              <p className="mb-1 font-medium text-white">{state.consent.title}</p>
              <p className="mb-2 text-slate-500">Consent document {state.consent.version}</p>
              {state.consent.sections.map((s) => (
                <div key={s.heading} className="mb-2">
                  <p className="font-medium text-slate-200">{s.heading}</p>
                  {s.text.map((t) => <p key={t}>{t}</p>)}
                </div>
              ))}
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                I&apos;ve read this and agree to take part
              </label>
              <span className="mt-2 flex gap-2">
                <button type="button" disabled={!agreed || busy} onClick={() => void join()} className={BUTTON}>Join the study</button>
                <button type="button" onClick={() => setReading(false)} className={BUTTON}>Not now</button>
              </span>
            </div>
          )}
        </div>
      )}
      {note && <p role="status" aria-label="Study" className={`mt-3 text-xs ${note.ok ? "text-amber-100" : "text-amber-300"}`}>{note.text}</p>}
    </section>
  );
}
