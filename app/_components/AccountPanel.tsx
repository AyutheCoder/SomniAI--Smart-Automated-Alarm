"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Download, ShieldCheck, Trash2 } from "lucide-react";
import type { AccountSummary } from "@/lib/accountData";
import { deleteMyAccount, FORGET_API } from "@/lib/accountClient";
import { SomniAlarm } from "@/lib/nativeAlarm";
import type { NativeConnection } from "@/lib/nativeSync";

const BUTTON = "inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10 disabled:opacity-50";
const INPUT = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-rose-400/60";

/**
 * Your data (prompt 7.2): the privacy policy and terms, everything stored about
 * the account as one download, and deleting the account with all of it.
 */
export default function AccountPanel({ userId, native = null }: { userId: string; native?: NativeConnection | null }) {
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setSummary(j.ok ? (j.data as AccountSummary) : null))
      .catch(() => setSummary(null));
  }, []);

  const total = summary ? Object.values(summary.records).reduce((a, b) => a + b, 0) : null;
  const api = native !== null && "api" in native ? native.api : 0;

  async function remove() {
    setBusy(true);
    setNote(null);
    try {
      const out = await deleteMyAccount(
        { confirm, password: summary?.hasPassword ? password : undefined },
        { userId, phone: api > 0 ? SomniAlarm : null, api, storage: typeof window === "undefined" ? null : window.localStorage },
      );
      setNote(out);
      if (out.ok) {
        // Give the result a moment on screen, then leave: this session's account is gone.
        setTimeout(() => void signOut({ callbackUrl: "/sign-in?deleted=1" }), 4000);
      }
    }
    catch (e) {
      setNote({ ok: false, text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}. Nothing was deleted.` });
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <section id="your-data" aria-label="Your data" className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-white">
        <ShieldCheck className="h-5 w-5 text-emerald-300" /> Your data
      </h2>
      <p className="mb-3 text-xs text-slate-400">
        {summary ? `${summary.email}: ${total} ${total === 1 ? "record" : "records"} stored. ` : ""}
        What is kept, why, and for how long is in the <Link href="/privacy" className="underline">privacy policy</Link>;
        using SomniAI is under the <Link href="/terms" className="underline">terms</Link>.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href="/api/account/export" download className={BUTTON}><Download className="h-3.5 w-3.5" /> Download all my data</a>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className={BUTTON}><Trash2 className="h-3.5 w-3.5" /> Delete my account</button>
        )}
      </div>
      {open && (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-xs text-slate-300">
          <p className="mb-2 font-semibold text-rose-200">Delete the account and everything stored with it</p>
          <ul className="mb-3 list-disc space-y-1 pl-5">
            <li>Deleted now, from the live database: alarms, tasks, sleep, screen time, telemetry, wake reports, buddy pairings and alerts, the study enrolment (you leave the study), and the account itself.</li>
            <li>Google is asked to remove SomniAI&apos;s calendar access. This phone&apos;s alarms are cancelled and forgotten.</li>
            <li>Not undone: texts and alerts already sent to your buddy or emergency contact. Download your data first if you want a copy.</li>
          </ul>
          <label className="mb-2 block">
            <span className="mb-1 block text-slate-400">Type your email address to confirm</span>
            <input aria-label="Email to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className={INPUT} />
          </label>
          {summary?.hasPassword && (
            <label className="mb-3 block">
              <span className="mb-1 block text-slate-400">Your password</span>
              <input aria-label="Password to confirm" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={INPUT} />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || confirm.trim() === "" || note?.ok === true} onClick={() => void remove()} className={`${BUTTON} border-rose-400/40 text-rose-100`}>
              {busy ? "Deleting…" : "Delete everything, permanently"}
            </button>
            <button type="button" disabled={busy || note?.ok === true} onClick={() => { setOpen(false); setNote(null); }} className={BUTTON}>Cancel</button>
          </div>
          {api > 0 && api < FORGET_API && <p className="mt-2 text-amber-300">This app is older than this feature: it will cancel its alarms, and keep their history until you update it or clear its storage.</p>}
        </div>
      )}
      {note && <p role="status" aria-label="Account" className={`mt-3 text-xs ${note.ok ? "text-emerald-200" : "text-amber-300"}`}>{note.text}</p>}
    </section>
  );
}
