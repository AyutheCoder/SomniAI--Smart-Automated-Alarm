"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Database, MapPin } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { DataSources, DataSourceStatus } from "@/lib/aiFeatures";
import type { CalendarState } from "@/lib/calendarServer";
import { outcomeFrom, outcomeText, resyncDue } from "@/lib/calendarClient";

const ROWS: [keyof DataSources, string][] = [
  ["sleepLogs", "Sleep log"],
  ["weather", "Weather"],
  ["calendar", "Calendar"],
  ["wearable", "Wearable"],
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
export default function DataSourcesPanel({ onTasksChanged }: { onTasksChanged?: () => void } = {}) {
  const [sources, setSources] = useState<DataSources | null>(null);
  const [locating, setLocating] = useState(false);
  const [weatherNote, setWeatherNote] = useState("");
  const [calendar, setCalendar] = useState<CalendarState | null>(null);
  const [calendarNote, setCalendarNote] = useState("");
  const [syncing, setSyncing] = useState(false);

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
                {key === "calendar" && <CalendarControls state={calendar} syncing={syncing} onSync={() => void syncCalendar(false)} onDisconnect={() => void disconnectCalendar()} />}
              </li>
            );
          })}
        </ul>
      )}
      {weatherNote && <p className="mt-3 text-xs text-amber-300">{weatherNote}</p>}
      {calendarNote && <p role="status" aria-label="Calendar" className="mt-3 text-xs text-sky-200">{calendarNote}</p>}
    </section>
  );
}

const BUTTON = "inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10 disabled:opacity-50";

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
