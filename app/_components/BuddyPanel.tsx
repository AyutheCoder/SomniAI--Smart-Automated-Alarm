"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HeartHandshake } from "lucide-react";
import { ALERT_AFTER_DEFAULT, RATE } from "@/lib/buddy";
import type { PushRegistration } from "@/lib/nativeBuddy";

interface BuddyStatus {
  buddy: { pairId: string; name: string; since: string; canCallThem: boolean; hasDevice: boolean } | null;
  invite: { code: string; expiresAt: string } | null;
  incoming: { requestId: string; name: string; at: string }[];
  outgoing: { requestId: string; name: string; at: string }[];
  settings: { alertAfterMinutes: number; ordinaryAlarms: boolean; phone: string | null; sharePhone: boolean };
  emergencyContact: { name: string; phone: string } | null;
  channels: { push: boolean; sms: boolean };
  hasDevice: boolean;
  alerts: { channel: "buddy" | "emergencyContact"; status: string; at: string }[];
}

const DELAYS = [5, 10, 15, 20, 30, 45, 60];

const ALERT_WORDS: Record<string, Record<string, string>> = {
  buddy: {
    sent: "your buddy was told",
    failed: "the push to your buddy failed",
    no_device: "your buddy had no phone set up for alerts",
    not_configured: "push isn't set up on the server",
  },
  emergencyContact: {
    sent: "your emergency contact was texted",
    failed: "the text to your emergency contact failed",
    not_configured: "texts aren't set up on the server",
  },
};

async function call(path: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return { ok: res.ok && json.ok !== false, error: json.error };
  }
  catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

/**
 * Wake buddy (prompt 3.2): pair with someone you trust, both agreeing; if you
 * don't confirm you're awake after a critical alarm, they get a push with a
 * button to call you. `push` is this phone's registration, or null in a browser.
 */
export default function BuddyPanel({ push }: { push: PushRegistration | null }) {
  const [status, setStatus] = useState<BuddyStatus | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactConsent, setContactConsent] = useState(false);

  const filled = useRef(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/buddy");
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      const data = (await res.json()).data as BuddyStatus;
      setStatus(data);
      // The fields take the saved values once: a later load (React runs the
      // first one twice in development; a slow answer anywhere) must not
      // overwrite what is being typed.
      if (!filled.current) {
        filled.current = true;
        setPhone(data.settings.phone ?? "");
        setContactName(data.emergencyContact?.name ?? "");
        setContactPhone(data.emergencyContact?.phone ?? "");
        setContactConsent(data.emergencyContact !== null);
      }
    }
    catch {
      setError("Couldn't load your wake buddy. It will show when the server is back.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string, method: string, body?: unknown) {
    setError("");
    const r = await call(path, method, body);
    if (!r.ok) {
      setError(r.error ?? "That didn't work.");
    }
    await load();
    return r.ok;
  }

  if (!status) {
    return error ? <p className="mb-6 text-sm text-rose-300">{error}</p> : null;
  }
  const s = status.settings;

  return (
    <section aria-label="Wake buddy" className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-white">
        <HeartHandshake className="h-5 w-5 text-pink-300" /> Wake buddy
      </h2>
      <p className="mb-4 text-sm text-slate-400">
        Someone you trust. If you don&apos;t confirm you&apos;re awake {s.alertAfterMinutes} minutes after a critical alarm,
        their phone tells them, with a button to call you. You both have to agree, and either of you can stop it at any time.
      </p>

      {status.buddy ? (
        <div className="mb-4 rounded-xl bg-white/5 p-4 text-sm text-slate-200">
          <p>
            <strong className="text-white">{status.buddy.name}</strong> is your wake buddy, and you are theirs.
          </p>
          <ul className="mt-2 list-disc pl-5 text-slate-400">
            <li>{status.buddy.hasDevice ? "Their phone can receive your alerts." : "Their phone isn't set up for alerts yet: they need to open SomniAI on it."}</li>
            <li>{status.buddy.canCallThem ? "If they miss one, your alert can call them." : "They haven't shared a number, so their alerts can't call them."}</li>
          </ul>
          <button
            onClick={() => { if (window.confirm(`Stop being wake buddies with ${status.buddy!.name}? Neither of you will get alerts.`)) void act("/api/buddy", "DELETE"); }}
            className="mt-3 rounded-lg border border-rose-400/40 px-3 py-1.5 text-rose-200 hover:bg-rose-500/10"
          >
            Unpair
          </button>
        </div>
      ) : (
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-white/5 p-4 text-sm">
            <p className="mb-2 font-medium text-white">Invite someone</p>
            {status.invite ? (
              <>
                <p className="text-slate-300">Give them this code. It works once, until {new Date(status.invite.expiresAt).toLocaleString()}.</p>
                <p aria-label="Invite code" className="my-2 font-mono text-2xl tracking-widest text-white">{status.invite.code}</p>
                <button onClick={() => void act("/api/buddy/invite", "DELETE")} className="text-xs text-slate-400 underline">Withdraw the code</button>
              </>
            ) : (
              <button onClick={() => void act("/api/buddy/invite", "POST")} className="rounded-lg bg-pink-500/80 px-3 py-1.5 text-white hover:bg-pink-500">
                Get a code
              </button>
            )}
          </div>
          <form
            className="rounded-xl bg-white/5 p-4 text-sm"
            onSubmit={(e) => { e.preventDefault(); void act("/api/buddy/requests", "POST", { code }).then((ok) => ok && setCode("")); }}
          >
            <label htmlFor="buddy-code" className="mb-2 block font-medium text-white">Have someone&apos;s code?</label>
            <div className="flex gap-2">
              <input
                id="buddy-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ABCD-EFGH"
                autoComplete="off"
                className="w-36 rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 font-mono uppercase text-white"
              />
              <button type="submit" className="rounded-lg bg-indigo-500/80 px-3 py-1.5 text-white hover:bg-indigo-500">Ask to pair</button>
            </div>
          </form>
        </div>
      )}

      {status.incoming.map((r) => (
        <div key={r.requestId} role="group" aria-label={`Request from ${r.name}`} className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-indigo-500/10 p-3 text-sm text-indigo-100">
          <span><strong>{r.name}</strong> wants to be your wake buddy.</span>
          <button onClick={() => void act(`/api/buddy/requests/${r.requestId}`, "PATCH", { accept: true })} className="ml-auto rounded-lg bg-emerald-500/80 px-3 py-1 text-white">Accept</button>
          <button onClick={() => void act(`/api/buddy/requests/${r.requestId}`, "PATCH", { accept: false })} className="rounded-lg border border-white/20 px-3 py-1">Decline</button>
        </div>
      ))}
      {status.outgoing.map((r) => (
        <div key={r.requestId} className="mb-3 flex items-center gap-2 rounded-xl bg-white/5 p-3 text-sm text-slate-300">
          <span>Waiting for <strong>{r.name}</strong> to accept.</span>
          <button onClick={() => void act(`/api/buddy/requests/${r.requestId}`, "DELETE")} className="ml-auto text-xs underline">Withdraw</button>
        </div>
      ))}

      <fieldset className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
        <legend className="mb-2 font-medium text-white">Your alerts</legend>
        <label className="flex items-center gap-2">
          Tell my buddy after
          <select
            value={s.alertAfterMinutes}
            onChange={(e) => void act("/api/buddy/settings", "PUT", { alertAfterMinutes: Number(e.target.value) })}
            className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-white"
          >
            {DELAYS.map((m) => <option key={m} value={m}>{m} minutes{m === ALERT_AFTER_DEFAULT ? " (default)" : ""}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.ordinaryAlarms} onChange={(e) => void act("/api/buddy/settings", "PUT", { ordinaryAlarms: e.target.checked })} />
          Ordinary alarms too, not only critical ones
        </label>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); void act("/api/buddy/settings", "PUT", { phone: phone.trim() === "" ? null : phone }); }}
        >
          <label htmlFor="buddy-phone">My number</label>
          <input id="buddy-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7700 900123"
            className="w-40 rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-white" />
          <button type="submit" className="rounded-lg border border-white/20 px-2 py-1 text-xs">Save</button>
        </form>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.sharePhone}
            disabled={!s.phone}
            onChange={(e) => void act("/api/buddy/settings", "PUT", { sharePhone: e.target.checked })}
          />
          Put my number in my alerts, so my buddy can call me
        </label>
      </fieldset>
      <p className="mt-3 text-xs text-slate-500">
        Your buddy sees your name, and when an alert goes out, that alarm&apos;s label and time; never your other alarms, tasks or e-mail address.
        At most one alert per alarm, {RATE.minGapMinutes} minutes apart, {RATE.maxPerDay} a day. SomniAI only knows what reaches its
        server: if your phone is offline when you wake, your buddy may be told even though you&apos;re up.
      </p>

      <p role="status" aria-label="Alerts on this phone" className="mt-3 text-xs text-slate-400">
        {push === null
          ? "Alerts arrive in the SomniAI app on a phone; open it there to receive your buddy's."
          : push.state === "registered"
            ? "This phone receives your buddy's alerts."
            : `This phone can't receive alerts yet: ${push.reason}`}
      </p>

      <form
        aria-label="Emergency contact"
        className="mt-4 rounded-xl bg-white/5 p-4 text-sm text-slate-300"
        onSubmit={(e) => {
          e.preventDefault();
          void act("/api/buddy/settings", "PUT", { emergencyContact: { name: contactName, phone: contactPhone, consent: contactConsent } });
        }}
      >
        <p className="mb-1 font-medium text-white">Emergency contact</p>
        <p className="mb-3 text-xs text-slate-400">
          Someone without SomniAI, texted at the same time as your buddy, under the same rules: {s.ordinaryAlarms ? "any" : "a critical"} alarm
          not answered after {s.alertAfterMinutes} minutes, at most once per alarm. SomniAI&apos;s server texts them, so it works even
          if your phone is off.
          {!status.channels.sms && " Texts aren't set up on this server yet, so they wouldn't go out."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Contact's name" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Name"
            className="w-32 rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-white" />
          <input aria-label="Contact's number" type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+91 98765 43210"
            className="w-44 rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-white" />
        </div>
        <label className="mt-2 flex items-start gap-2 text-xs">
          <input type="checkbox" checked={contactConsent} onChange={(e) => setContactConsent(e.target.checked)} className="mt-0.5" />
          They&apos;ve agreed to get these texts from SomniAI.
        </label>
        <div className="mt-2 flex gap-2">
          <button type="submit" className="rounded-lg border border-white/20 px-3 py-1 text-xs">Save contact</button>
          {status.emergencyContact && (
            <button
              type="button"
              onClick={() => void act("/api/buddy/settings", "PUT", { emergencyContact: null }).then((ok) => {
                if (ok) {
                  setContactName("");
                  setContactPhone("");
                  setContactConsent(false);
                }
              })}
              className="text-xs text-slate-400 underline"
            >
              Remove
            </button>
          )}
        </div>
      </form>

      {status.alerts.length > 0 && (
        <div className="mt-3 text-xs text-slate-400">
          <p className="font-medium text-slate-300">Recent alerts about you</p>
          <ul className="list-disc pl-5">
            {status.alerts.map((a, i) => (
              <li key={i}>{new Date(a.at).toLocaleString()}: {ALERT_WORDS[a.channel]?.[a.status] ?? a.status}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    </section>
  );
}
