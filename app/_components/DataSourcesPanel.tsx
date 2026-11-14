"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Database, HeartPulse, MapPin, Smartphone } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { DataSources, DataSourceStatus } from "@/lib/aiFeatures";
import type { CalendarState } from "@/lib/calendarServer";
import { outcomeFrom, outcomeText, resyncDue } from "@/lib/calendarClient";
import { SomniAlarm, type HealthState } from "@/lib/nativeAlarm";
import { hasHealth, importFromHealthConnect, importText } from "@/lib/nativeHealth";
import { hasScreenTime, importScreenTime, SCREEN_WHY, screenText, type ScreenImport } from "@/lib/nativeScreen";
import type { NativeConnection } from "@/lib/nativeSync";

const ROWS: [keyof DataSources, string][] = [
  ["sleepLogs", "Sleep log"],
  ["weather", "Weather"],
  ["calendar", "Calendar"],
  ["wearable", "Wearable"],
  ["screenTime", "Screen time"],
];

const DOT: Record<DataSourceStatus["source"], string> = {
  live: "bg-emerald-400",
  simulated: "bg-amber-400",
  missing: "bg-slate-600",
};

const STATE: Record<DataSourceStatus["source"], string> = {
  live: "connected",
  simulated: "simulated",
  missing: "not connected",
};

/**
 * Which of the user's data sources are connected, and so what predictions can
 * use. Only live sources feed predictions; the rest are shown as what they are.
 */
export default function DataSourcesPanel({ onTasksChanged, native = null }: { onTasksChanged?: () => void; native?: NativeConnection | null } = {}) {
  const [sources, setSources] = useState<DataSources | null>(null);
  const [locating, setLocating] = useState(false);
  const [weatherNote, setWeatherNote] = useState("");
  const [calendar, setCalendar] = useState<CalendarState | null>(null);
  const [calendarNote, setCalendarNote] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [health, setHealth] = useState<HealthState | null>(null);
  const [healthNote, setHealthNote] = useState("");
  const [reading, setReading] = useState(false);
  const [screenAllowed, setScreenAllowed] = useState<boolean | null>(null);
  // What the last measurement said; worded when shown, against what the server still has.
  const [screenResult, setScreenResult] = useState<ScreenImport | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [explaining, setExplaining] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/context?limit=1", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setSources(json.data.sources as DataSources);
      }
    }
    catch {
      // The panel stays in its loading state; nothing here is critical.
    }
  }, []);

  const connectWeather = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setWeatherNote("This browser can't share a location.");
      return;
    }
    setLocating(true);
    setWeatherNote("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/context", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          });
          const json = await res.json();
          if (json.ok && json.data.sources?.weather !== "live") {
            setWeatherNote("The weather service didn't answer; try again later.");
          }
          await load();
        }
        finally {
          setLocating(false);
        }
      },
      (err) => {
        setWeatherNote(err.code === err.PERMISSION_DENIED
          ? "Location is blocked for this site in your browser settings."
          : "Couldn't get your location.");
        setLocating(false);
      },
      { timeout: 10_000, maximumAge: 30 * 60_000 },
    );
  }, [load]);

  const loadCalendar = useCallback(async (): Promise<CalendarState | null> => {
    try {
      const json = await (await fetch("/api/calendar", { cache: "no-store" })).json();
      if (json.ok) {
        setCalendar(json.data as CalendarState);
        return json.data as CalendarState;
      }
    }
    catch {
      // Shown as not connected until it answers.
    }
    return null;
  }, []);

  const syncCalendar = useCallback(async (quiet: boolean) => {
    setSyncing(true);
    try {
      const json = await (await fetch("/api/calendar/sync", { method: "POST" })).json();
      if (!quiet || !json.ok) {
        setCalendarNote(json.ok
          ? `Read ${json.data.events} upcoming ${json.data.events === 1 ? "event" : "events"}: ${json.data.added} added, ${json.data.updated} updated, ${json.data.removed} removed.`
          : json.error ?? "Couldn't read the calendar.");
      }
      if (json.ok) {
        onTasksChanged?.();
      }
    }
    catch {
      setCalendarNote("Couldn't reach the server to read the calendar.");
    }
    finally {
      setSyncing(false);
      await Promise.all([load(), loadCalendar()]);
    }
  }, [load, loadCalendar, onTasksChanged]);

  // Health Connect, in the app (prompt 4.2): read on opening, and on Sync now.
  const readHealth = useCallback(async (quiet: boolean) => {
    setReading(true);
    try {
      const r = await importFromHealthConnect();
      if (!quiet || r.state === "failed" || (r.state === "imported" && (r.added > 0 || r.updated > 0))) {
        setHealthNote(importText(r));
      }
      setHealth(await SomniAlarm.healthStatus().catch(() => null));
    }
    finally {
      setReading(false);
      await load();
    }
  }, [load]);

  const connectHealth = useCallback(async () => {
    try {
      const state = await SomniAlarm.requestHealthPermissions();
      setHealth(state);
      if (state.granted.includes("android.permission.health.READ_SLEEP")) {
        await readHealth(false);
      }
      else {
        setHealthNote("Sleep wasn't allowed in Health Connect, so nothing was read.");
      }
    }
    catch (e) {
      setHealthNote(`Couldn't open Health Connect: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [readHealth]);

  const nativeHealth = hasHealth(native);
  useEffect(() => {
    if (!nativeHealth) {
      return;
    }
    void SomniAlarm.healthStatus().then((state) => {
      setHealth(state);
      if (state.status === "available" && state.granted.includes("android.permission.health.READ_SLEEP")) {
        void readHealth(true);
      }
    }).catch(() => setHealth(null));
  }, [nativeHealth, readHealth]);

  // Screen time before bed, in the app (prompt 4.3): measured on opening, on
  // Measure now, and on coming back from Settings with Usage access turned on.
  const measureScreen = useCallback(async (quiet: boolean) => {
    setMeasuring(true);
    try {
      const r = await importScreenTime();
      setScreenAllowed(r.state !== "not_allowed");
      if (!quiet || r.state === "failed" || (r.state === "measured" && (r.added > 0 || r.updated > 0))) {
        setScreenResult(r);
      }
    }
    finally {
      setMeasuring(false);
      await load();
    }
  }, [load]);

  const nativeScreen = hasScreenTime(native);
  useEffect(() => {
    if (!nativeScreen) {
      return;
    }
    let last: boolean | null = null;
    const check = async (quiet: boolean) => {
      const allowed = await SomniAlarm.screenTimeStatus().then((s) => s.allowed).catch(() => null);
      setScreenAllowed(allowed);
      if (allowed && last !== true) {
        setExplaining(false);
        void measureScreen(quiet);
      }
      else if (allowed === false && last === true) {
        setScreenResult({ state: "not_allowed" });
      }
      last = allowed;
    };
    void check(true);
    // Back from Settings: Usage access may have been turned on or off there.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void check(false);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [nativeScreen, measureScreen]);

  async function disconnectCalendar() {
    const json = await (await fetch("/api/calendar", { method: "DELETE" })).json().catch(() => null);
    setCalendarNote(json?.ok
      ? `Disconnected${json.data.revokedAtGoogle ? "" : " here (Google didn't confirm; you can also remove SomniAI at myaccount.google.com/permissions)"}. ${json.data.removedTasks} calendar ${json.data.removedTasks === 1 ? "task" : "tasks"} removed.`
      : json?.error ?? "Couldn't disconnect.");
    onTasksChanged?.();
    await Promise.all([load(), loadCalendar()]);
  }

  useEffect(() => {
    // Back from Google's consent screen: say how it went, once.
    const outcome = outcomeFrom(window.location.search);
    void loadCalendar().then((state) => {
      if (outcome) {
        setCalendarNote(outcomeText(outcome, outcome === "connected" ? state?.connection?.lastSync?.events ?? null : null));
        const url = new URL(window.location.href);
        url.searchParams.delete("calendar");
        window.history.replaceState(null, "", url.toString());
        if (outcome === "connected") {
          onTasksChanged?.();
        }
      }
      else if (state?.connection?.status === "connected" && resyncDue(state.connection.lastSyncAt, new Date())) {
        void syncCalendar(true);
      }
    });
    // Once, on opening; the callbacks it uses are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    // Weather is live by default once the browser allows location: if it
    // already does, use it without asking again. Otherwise wait for the button.
    navigator.permissions?.query({ name: "geolocation" as PermissionName })
      .then((p) => {
        if (p.state === "granted") {
          connectWeather();
        }
      })
      .catch(() => {});
  }, [load, connectWeather]);

  return (
    <section aria-label="Data sources" className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-white">
        <Database className="h-5 w-5 text-sky-300" /> Data sources
      </h2>
      <p className="mb-4 text-xs text-slate-400">
        Predictions use connected sources only. Anything simulated or not connected is left out.
      </p>
      {!sources ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <ul className="space-y-2">
          {ROWS.map(([key, label]) => {
            const status = sources[key];
            return (
              <li key={key} data-source={status.source} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status.source]}`} aria-hidden />
                <span className="w-24 text-white">{label}</span>
                <span className="text-slate-300">{STATE[status.source]}</span>
                <span className="text-xs text-slate-500">{status.detail}</span>
                {key === "weather" && status.source !== "live" && (
                  <button
                    type="button"
                    onClick={connectWeather}
                    disabled={locating}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    <MapPin className="h-3.5 w-3.5" /> {locating ? "Locating…" : "Use my location"}
                  </button>
                )}
                {key === "sleepLogs" && (
                  <HealthControls native={native} state={health} reading={reading} onConnect={() => void connectHealth()} onRead={() => void readHealth(false)} />
                )}
                {key === "screenTime" && (
                  <ScreenControls
                    native={native}
                    allowed={screenAllowed}
                    measuring={measuring}
                    onExplain={() => setExplaining(true)}
                    onMeasure={() => void measureScreen(false)}
                  />
                )}
                {key === "calendar" && <CalendarControls state={calendar} syncing={syncing} onSync={() => void syncCalendar(false)} onDisconnect={() => void disconnectCalendar()} />}
              </li>
            );
          })}
        </ul>
      )}
      {explaining && screenAllowed === false && (
        <div role="dialog" aria-label="Why SomniAI asks for Usage access" className="mt-3 rounded-xl border border-sky-300/20 bg-sky-300/5 p-3 text-xs text-slate-300">
          <p className="mb-2 font-medium text-white">Why SomniAI asks for Usage access</p>
          {SCREEN_WHY.map((p) => <p key={p} className="mb-2">{p}</p>)}
          <p className="mb-3 text-slate-400">In Settings, find SomniAI under Usage access and turn on &quot;Permit usage access&quot;, then come back.</p>
          <span className="flex gap-2">
            <button type="button" onClick={() => void SomniAlarm.openUsageAccess()} className={BUTTON}>
              <Smartphone className="h-3.5 w-3.5" /> Open Settings
            </button>
            <button type="button" onClick={() => setExplaining(false)} className={BUTTON}>Not now</button>
          </span>
        </div>
      )}
      {weatherNote && <p className="mt-3 text-xs text-amber-300">{weatherNote}</p>}
      {healthNote && <p role="status" aria-label="Health Connect" className="mt-3 text-xs text-emerald-200">{healthNote}</p>}
      {screenResult && (
        <p role="status" aria-label="Screen time" className="mt-3 text-xs text-violet-200">
          {screenText(screenResult, sources?.screenTime.source === "live")}
        </p>
      )}
      {calendarNote && <p role="status" aria-label="Calendar" className="mt-3 text-xs text-sky-200">{calendarNote}</p>}
    </section>
  );
}

const BUTTON = "inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10 disabled:opacity-50";

/** Health Connect for the sleep log (prompt 4.2): only in the Android app. */
function HealthControls({ native, state, reading, onConnect, onRead }: {
  native: NativeConnection | null;
  state: HealthState | null;
  reading: boolean;
  onConnect: () => void;
  onRead: () => void;
}) {
  if (!hasHealth(native)) {
    const inApp = native !== null && "api" in native;
    return (
      <span className="ml-auto text-xs text-slate-500">
        {inApp ? "Update the app to read Health Connect" : "Sleep from Health Connect is read in the Android app"}
      </span>
    );
  }
  if (!state) {
    return null;
  }
  if (state.status !== "available") {
    return (
      <button type="button" onClick={() => void SomniAlarm.openHealthConnect()} className={`ml-auto ${BUTTON}`}>
        <HeartPulse className="h-3.5 w-3.5" /> {state.status === "not_installed" ? "Install Health Connect" : "Update Health Connect"}
      </button>
    );
  }
  if (!state.granted.includes("android.permission.health.READ_SLEEP")) {
    return (
      <button type="button" onClick={onConnect} className={`ml-auto ${BUTTON}`}>
        <HeartPulse className="h-3.5 w-3.5" /> Connect Health Connect
      </button>
    );
  }
  return (
    <span className="ml-auto flex gap-2">
      <button type="button" onClick={onRead} disabled={reading} className={BUTTON}>
        <HeartPulse className="h-3.5 w-3.5" /> {reading ? "Reading…" : "Sync now"}
      </button>
      <button type="button" onClick={() => void SomniAlarm.openHealthConnect()} className={BUTTON}>Manage</button>
    </span>
  );
}

/** Screen time before bed (prompt 4.3): only in the Android app, with Usage access. */
function ScreenControls({ native, allowed, measuring, onExplain, onMeasure }: {
  native: NativeConnection | null;
  allowed: boolean | null;
  measuring: boolean;
  onExplain: () => void;
  onMeasure: () => void;
}) {
  if (!hasScreenTime(native)) {
    const inApp = native !== null && "api" in native;
    return (
      <span className="ml-auto text-xs text-slate-500">
        {inApp ? "Update the app to measure screen time" : "Screen time before bed is measured in the Android app"}
      </span>
    );
  }
  if (allowed === null) {
    return null;
  }
  if (!allowed) {
    return (
      <button type="button" onClick={onExplain} className={`ml-auto ${BUTTON}`}>
        <Smartphone className="h-3.5 w-3.5" /> Measure screen time
      </button>
    );
  }
  return (
    <span className="ml-auto flex gap-2">
      <button type="button" onClick={onMeasure} disabled={measuring} className={BUTTON}>
        <Smartphone className="h-3.5 w-3.5" /> {measuring ? "Measuring…" : "Measure now"}
      </button>
      <button type="button" onClick={() => void SomniAlarm.openUsageAccess()} className={BUTTON}>Manage</button>
    </span>
  );
}

/** Connect, sync or disconnect Google Calendar (prompt 4.1). */
function CalendarControls({ state, syncing, onSync, onDisconnect }: {
  state: CalendarState | null;
  syncing: boolean;
  onSync: () => void;
  onDisconnect: () => void;
}) {
  if (!state) {
    return null;
  }
  const status = state.connection?.status;
  if (status === "connected") {
    return (
      <span className="ml-auto flex gap-2">
        <button type="button" onClick={onSync} disabled={syncing} className={BUTTON}>
          <CalendarDays className="h-3.5 w-3.5" /> {syncing ? "Reading…" : "Sync now"}
        </button>
        <button type="button" onClick={onDisconnect} className={BUTTON}>Disconnect</button>
      </span>
    );
  }
  if (!state.configured) {
    return <span className="ml-auto text-xs text-slate-500">Google isn&apos;t set up on this server</span>;
  }
  if (Capacitor.isNativePlatform()) {
    // Google refuses its consent screen inside an app's web view.
    return <span className="ml-auto text-xs text-slate-400">Connect it from SomniAI in a web browser; it then works here too</span>;
  }
  return (
    <a href="/api/calendar/connect" className={`ml-auto ${BUTTON}`}>
      <CalendarDays className="h-3.5 w-3.5" /> {status === "revoked" ? "Connect again" : "Connect Google Calendar"}
    </a>
  );
}
