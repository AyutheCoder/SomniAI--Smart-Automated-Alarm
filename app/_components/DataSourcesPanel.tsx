"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, MapPin } from "lucide-react";
import type { DataSources, DataSourceStatus } from "@/lib/aiFeatures";

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
export default function DataSourcesPanel() {
  const [sources, setSources] = useState<DataSources | null>(null);
  const [locating, setLocating] = useState(false);
  const [weatherNote, setWeatherNote] = useState("");

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
              </li>
            );
          })}
        </ul>
      )}
      {weatherNote && <p className="mt-3 text-xs text-amber-300">{weatherNote}</p>}
    </section>
  );
}
