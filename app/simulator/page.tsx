"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Bed,
  CalendarDays,
  CloudSun,
  Gauge,
  Mic,
  MonitorSmartphone,
  RefreshCw,
  Watch,
  Zap,
} from "lucide-react";
import { createMicAdapter, createMotionAdapter, createScreenAdapter, type MicSample, type MotionSample, type ScreenSample, type SensorAdapter } from "@/lib/sensors";
import type { BehavioralMetrics } from "@/lib/features";

interface ContextSnapshotView {
  at: string;
  source: string;
  weather?: {
    tempC: number;
    condition: string;
  };
  calendar?: {
    title: string;
    start: string;
    importanceScore?: number;
  }[];
  wearable?: {
    restingHr?: number;
    steps?: number;
    lastSleepHours?: number;
  };
}

type EventPayload = {
  type: string;
  value?: number;
  meta?: Record<string, unknown>;
  at?: string;
};

function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function SimulatorPage() {
  const [status, setStatus] = useState<string>("");
  const flash = useCallback((msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(""), 3000);
  }, []);

  async function postEvents(events: EventPayload[]) {
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
    return res.json();
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 flex items-center gap-3">
        <Link
          href="/"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10"
          aria-label="Back to home"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Behavior Simulator</h1>
          <p className="text-sm text-slate-400">
            Inject sensor, behavior &amp; context data to exercise the AI layer.
          </p>
        </div>
        {status && (
          <span className="ml-auto rounded-lg bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-300">
            {status}
          </span>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <LiveSensors onLog={postEvents} flash={flash} />
        <MetricsPanel />
        <InjectBehavior onPost={postEvents} flash={flash} />
        <InjectSleep onPost={postEvents} flash={flash} />
        <ContextPanel flash={flash} />
      </div>

      <p className="mt-8 text-center text-xs text-slate-600">
        All sensor data is processed locally; the microphone computes a loudness
        level only and is never recorded.
      </p>
    </main>
  );
}

function LiveSensors({
  onLog,
  flash,
}: {
  onLog: (events: EventPayload[]) => Promise<unknown>;
  flash: (m: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
        <Activity className="h-5 w-5 text-emerald-300" /> Live Sensors
      </h2>
      <div className="space-y-3">
        <MotionTile onLog={onLog} flash={flash} />
        <MicTile onLog={onLog} flash={flash} />
        <ScreenTile onLog={onLog} flash={flash} />
      </div>
    </section>
  );
}

function useSensor<T>(make: () => SensorAdapter<T>) {
  const adapterRef = useRef<SensorAdapter<T> | null>(null);
  const [running, setRunning] = useState(false);
  const [sample, setSample] = useState<T | null>(null);
  const [simulated, setSimulated] = useState(false);

  const start = useCallback(async () => {
    if (adapterRef.current) return;
    const adapter = make();
    adapterRef.current = adapter;
    setSimulated(adapter.simulated);
    await adapter.start((s) => setSample(s));
    setRunning(true);
  }, [make]);

  const stop = useCallback(() => {
    adapterRef.current?.stop();
    adapterRef.current = null;
    setRunning(false);
  }, []);

  useEffect(() => () => adapterRef.current?.stop(), []);

  return { running, sample, simulated, start, stop };
}

function SensorTile({
  icon: Icon,
  title,
  running,
  simulated,
  onStart,
  onStop,
  onLog,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  running: boolean;
  simulated: boolean;
  onStart: () => void;
  onStop: () => void;
  onLog: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-emerald-300">{Icon}</span>
        <span className="text-sm font-medium text-white">{title}</span>
        {running && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            simulated
              ? "bg-amber-500/15 text-amber-300"
              : "bg-emerald-500/15 text-emerald-300"
          }`}>
            {simulated ? "simulated" : "live"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {running && onLog && (
            <button
              onClick={onLog}
              className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 transition hover:bg-white/10"
            >
              Log
            </button>
          )}
          <button
            onClick={running ? onStop : onStart}
            className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
              running
                ? "bg-rose-500/80 text-white hover:bg-rose-500"
                : "bg-emerald-500 text-white hover:bg-emerald-400"
            }`}
          >
            {running ? "Stop" : "Start"}
          </button>
        </div>
      </div>
      <div className="text-xs text-slate-400">{children}</div>
    </div>
  );
}

function MotionTile({
  onLog,
  flash,
}: {
  onLog: (e: EventPayload[]) => Promise<unknown>;
  flash: (m: string) => void;
}) {
  const { running, sample, simulated, start, stop } = useSensor<MotionSample>(() => createMotionAdapter());

  return (
    <SensorTile
      icon={<Activity className="h-4 w-4" />}
      title="Motion (accelerometer)"
      running={running}
      simulated={simulated}
      onStart={start}
      onStop={stop}
      onLog={
        async () => {
          if (!sample) return;
          await onLog([
            { type: "motion", value: Math.round(sample.magnitude * 100) / 100 },
          ]);
          flash("Logged motion sample");
        }
      }
    >
      {sample ? (
        <span>
          magnitude <b className="text-white">{sample.magnitude.toFixed(2)}</b>{" "}
          m/s² · z {sample.z.toFixed(1)}
        </span>
      ) : (
        "Idle — press Start to read device motion."
      )}
    </SensorTile>
  );
}

function MicTile({
  onLog,
  flash,
}: {
  onLog: (e: EventPayload[]) => Promise<unknown>;
  flash: (m: string) => void;
}) {
  const { running, sample, simulated, start, stop } = useSensor<MicSample>(() => createMicAdapter());

  return (
    <SensorTile
      icon={<Mic className="h-4 w-4" />}
      title="Ambient noise (RMS only)"
      running={running}
      simulated={simulated}
      onStart={start}
      onStop={stop}
      onLog={
        async () => {
          if (!sample) return;
          await onLog([
            { type: "ambient_noise", value: Math.round(sample.rms * 1000) / 1000 },
          ]);
          flash("Logged ambient noise");
        }
      }
    >
      {sample ? (
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full rounded-full bg-emerald-400"
              style={{ width: `${Math.min(100, Math.round(sample.rms * 300))}%` }}
            />
          </div>
          <b className="text-white">{sample.db.toFixed(0)} dB</b>
        </div>
      ) : (
        "Idle — Start to measure room loudness (no recording)."
      )}
    </SensorTile>
  );
}

function ScreenTile({
  onLog,
  flash,
}: {
  onLog: (e: EventPayload[]) => Promise<unknown>;
  flash: (m: string) => void;
}) {
  const { running, sample, simulated, start, stop } = useSensor<ScreenSample>(() => createScreenAdapter());

  return (
    <SensorTile
      icon={<MonitorSmartphone className="h-4 w-4" />}
      title="Screen activity"
      running={running}
      simulated={simulated}
      onStart={start}
      onStop={stop}
      onLog={
        async () => {
          if (!sample) return;
          await onLog([
            { type: sample.state, value: Math.round(sample.idleMs) },
          ]);
          flash("Logged screen state");
        }
      }
    >
      {sample ? (
        <span>
          <b className="text-white">{sample.visible ? "Visible" : "Hidden"}</b> ·{" "}
          {sample.focused ? "focused" : "blurred"} · idle{" "}
          {(sample.idleMs / 1000).toFixed(0)}s
        </span>
      ) : (
        "Idle — Start to track visibility, focus & idle time."
      )}
    </SensorTile>
  );
}

function InjectBehavior({
  onPost,
  flash,
}: {
  onPost: (e: EventPayload[]) => Promise<unknown>;
  flash: (m: string) => void;
}) {
  const [responseMs, setResponseMs] = useState(4000);
  const [snoozeCount, setSnoozeCount] = useState(1);
  const [confidence, setConfidence] = useState(80);

  async function fire(type: string, value?: number, meta?: Record<string, unknown>) {
    await onPost([{ type, value, meta }]);
    flash(`Logged ${type}`);
  }

  const buttons: Array<[
    string,
    string,
    () => void
  ]> = [
    ["alarm_fire", "Alarm fire", () => fire("alarm_fire")],
    ["snooze", "Snooze", () => fire("snooze", snoozeCount)],
    ["dismiss", "Dismiss", () => fire("dismiss", confidence, { responseMs })],
    ["verify_pass", "Verify pass", () => fire("verify_pass", confidence)],
    ["verify_fail", "Verify fail", () => fire("verify_fail", confidence)],
    ["interaction", "Interaction", () => fire("interaction")],
  ];

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
        <Zap className="h-5 w-5 text-amber-300" /> Inject Behavior Events
      </h2>
      <div className="space-y-3">
        <Slider label="Response time" value={responseMs} min={500} max={30000} step={500} suffix=" ms" onChange={setResponseMs} />
        <Slider label="Snooze count" value={snoozeCount} min={0} max={5} step={1} onChange={setSnoozeCount} />
        <Slider label="Wake confidence" value={confidence} min={0} max={100} step={1} suffix="%" onChange={setConfidence} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {buttons.map(([type, label, fn]) => (
          <button
            key={type}
            onClick={fn}
            className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-white/10"
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function InjectSleep({
  onPost,
  flash,
}: {
  onPost: (e: EventPayload[]) => Promise<unknown>;
  flash: (m: string) => void;
}) {
  const [date, setDate] = useState(() => ymd(new Date()));
  const [duration, setDuration] = useState(7.5);
  const [snoozeCount, setSnoozeCount] = useState(1);
  const [confidence, setConfidence] = useState(80);
  const [busy, setBusy] = useState(false);

  async function addNight() {
    setBusy(true);
    try {
      const wake = new Date(`${date}T07:00:00`);
      const sleep = new Date(wake.getTime() - duration * 3600000);
      const res = await fetch("/api/sleep-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          sleepTime: sleep.toISOString(),
          wakeTime: wake.toISOString(),
          durationHours: duration,
          snoozeCount,
          wakeConfidence: confidence,
          source: "manual",
        }),
      });
      const json = await res.json();
      flash(json.ok ? "Saved sleep night" : json.error || "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function generateWeek() {
    setBusy(true);
    try {
      const events: EventPayload[] = [];
      for (let i = 1; i <= 7; i++) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        const d = ymd(day);
        const dur = Math.round((5.5 + Math.random() * 3.5) * 10) / 10;
        const wake = new Date(`${d}T0${5 + Math.floor(Math.random() * 3)}:30:00`);
        const sleep = new Date(wake.getTime() - dur * 3600000);
        const snoozes = Math.floor(Math.random() * 4);
        const conf = 45 + Math.floor(Math.random() * 55);
        const responseMs = 1000 + Math.floor(Math.random() * 20000);

        await fetch("/api/sleep-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: d,
            sleepTime: sleep.toISOString(),
            wakeTime: wake.toISOString(),
            durationHours: dur,
            snoozeCount: snoozes,
            alarmResponseMs: responseMs,
            wakeConfidence: conf,
            source: "sensor",
          }),
        });

        const at = wake.toISOString();
        events.push({ type: "alarm_fire", at, meta: { synthetic: true } });
        for (let s = 0; s < snoozes; s++) {
          events.push({ type: "snooze", value: 1, at });
        }
        events.push({ type: conf >= 70 ? "verify_pass" : "verify_fail", value: conf, at });
        events.push({ type: "dismiss", value: conf, at, meta: { responseMs } });
      }

      if (events.length > 0) {
        await onPost(events);
        flash("Generated 7 nights of history");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
        <Bed className="h-5 w-5 text-indigo-300" /> Inject Sleep Night
      </h2>
      <div className="space-y-3">
        <label className="block text-xs text-slate-400">
          Night of
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400"
          />
        </label>
        <Slider label="Duration" value={duration} min={3} max={11} step={0.5} suffix=" h" onChange={setDuration} />
        <Slider label="Snooze count" value={snoozeCount} min={0} max={5} step={1} onChange={setSnoozeCount} />
        <Slider label="Wake confidence" value={confidence} min={0} max={100} step={1} suffix="%" onChange={setConfidence} />
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={addNight}
          disabled={busy}
          className="flex-1 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-50"
        >
          Add night
        </button>
        <button
          onClick={generateWeek}
          disabled={busy}
          className="flex-1 rounded-lg border border-white/10 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
        >
          Generate 7 nights
        </button>
      </div>
    </section>
  );
}

function ContextPanel({ flash }: { flash: (m: string) => void }) {
  const [snapshot, setSnapshot] = useState<ContextSnapshotView | null>(null);
  const [busy, setBusy] = useState(false);

  const loadLatest = useCallback(async () => {
    try {
      const res = await fetch("/api/context?limit=1");
      const json = await res.json();
      if (json.ok && json.data.items[0]) {
        setSnapshot(json.data.items[0]);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  async function generate(uselocation: boolean) {
    setBusy(true);
    try {
      const body: {
        simulate?: boolean;
        lat?: number;
        lon?: number;
      } = {
        simulate: true,
      };
      if (uselocation && navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              body.simulate = false;
              body.lat = pos.coords.latitude;
              body.lon = pos.coords.longitude;
              resolve();
            },
            () => resolve(),
            { timeout: 5000 }
          );
        });
      }
      const res = await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        setSnapshot(json.data);
        flash("Context snapshot saved");
      } else {
        flash(json.error || "Failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
        <CloudSun className="h-5 w-5 text-sky-300" /> Context Snapshot
      </h2>
      <div className="flex gap-2">
        <button
          onClick={() => generate(false)}
          disabled={busy}
          className="flex-1 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-50"
        >
          Generate (simulated)
        </button>
        <button
          onClick={() => generate(true)}
          disabled={busy}
          className="flex-1 rounded-lg border border-white/10 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
        >
          Use my location
        </button>
      </div>

      {snapshot && (
        <div className="mt-4 space-y-3 text-sm">
          {snapshot.weather && (
            <div className="flex items-center gap-2 text-slate-300">
              <CloudSun className="h-4 w-4 text-amber-300" />
              {snapshot.weather.condition} · {snapshot.weather.tempC}°C
              <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-500">
                {snapshot.source}
              </span>
            </div>
          )}
          {snapshot.wearable && (
            <div className="flex items-center gap-2 text-slate-300">
              <Watch className="h-4 w-4 text-emerald-300" />
              {snapshot.wearable.restingHr} bpm · {snapshot.wearable.steps} steps · {snapshot.wearable.lastSleepHours} h sleep
            </div>
          )}
          {snapshot.calendar && snapshot.calendar.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-2 text-slate-300">
                <CalendarDays className="h-4 w-4 text-indigo-300" /> Upcoming
              </p>
              <ul className="space-y-1 pl-6 text-xs text-slate-400">
                {snapshot.calendar.map((c, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>{c.title}</span>
                    <span className="text-slate-500">
                      {new Date(c.start).toLocaleDateString()} · imp({c.importanceScore ?? "-"})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MetricsPanel() {
  const [metrics, setMetrics] = useState<BehavioralMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/metrics");
      const json = await res.json();
      if (json.ok) {
        setMetrics(json.data.metrics);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const bars: Array<[
    string,
    number,
    boolean
  ]> = metrics
    ? [
        ["Sleep consistency", metrics.sleepConsistencyScore, true],
        ["Wake efficiency", metrics.wakeEfficiencyScore, true],
        ["Productivity", metrics.productivityScore, true],
        ["Wake resistance", metrics.wakeResistanceIndex, false],
        ["Sleep disruption", metrics.sleepDisruptionScore, false],
        ["Fatigue", metrics.fatigueScore, false],
      ]
    : [];

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
        <Gauge className="h-5 w-5 text-violet-300" /> Behavioral Metrics
        <button
          onClick={refresh}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-white/10"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </h2>

      {!metrics ? (
        <p className="text-sm text-slate-500">No metrics yet — inject some data.</p>
      ) : (
        <>
          <div className="space-y-2.5">
            {bars.map(([label, value, higherBetter]) => (
              <MetricBar key={label} label={label} value={value} higherBetter={higherBetter} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Prob label="Wake success" value={metrics.wakeSuccessProbability} higherBetter />
            <Prob label="Oversleep risk" value={metrics.oversleepProbability} higherBetter={false} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            From {metrics.nights} night{metrics.nights === 1 ? "" : "s"} &amp; {metrics.events} event{metrics.events === 1 ? "" : "s"}.
          </p>
        </>
      )}
    </section>
  );
}

function MetricBar({
  label,
  value,
  higherBetter,
}: {
  label: string;
  value: number;
  higherBetter: boolean;
}) {
  const good = higherBetter ? value >= 60 : value <= 40;
  const mid = !good && (higherBetter ? value >= 40 : value <= 60);
  const color = good ? "bg-emerald-400" : mid ? "bg-amber-400" : "bg-rose-400";
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function Prob({
  label,
  value,
  higherBetter,
}: {
  label: string;
  value: number;
  higherBetter: boolean;
}) {
  const p = Math.round(value * 100);
  const good = higherBetter ? p >= 60 : p <= 40;
  return (
    <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3">
      <p className={`text-2xl font-bold ${good ? "text-emerald-300" : "text-amber-300"}`}>
        {p}%
      </p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300">
          {value}
          {suffix ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}