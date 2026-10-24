"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlarmClock, BarChart3, CheckCircle2, Circle, ListTodo, LogOut, Moon, Plus, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import type { Alarm, Priority, Task, WakeStrategy } from "@/lib/types";
import { Outbox, browserStore } from "@/lib/outbox";
import { loadAlarmCache, mergeWithLocal, saveAlarmCache } from "@/lib/alarmCache";
import { dismissLocally, snoozeLocally, syncCalls } from "@/lib/ringFlow";
import { resolveRingPlan } from "@/lib/ringPlan";
import { connectNative, type NativeConnection, type NativeSyncStatus } from "@/lib/nativeSync";
import RingingOverlay, { type ResolveResult } from "./_components/RingingOverlay";
import InsightsPanel from "./_components/InsightsPanel";
import DataSourcesPanel from "./_components/DataSourcesPanel";
import SmartSchedulePanel from "./_components/SmartSchedulePanel";
import WakePlanPanel from "./_components/WakePlanPanel";
import BedtimeReminder from "./_components/BedtimeReminder";

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "text-slate-400 bg-slate-500/10",
  medium: "text-sky-300 bg-sky-500/10",
  high: "text-amber-300 bg-amber-500/10",
  critical: "text-rose-300 bg-rose-500/10",
};

const INTENT_LABELS: Record<NonNullable<Task["intent"]>, string> = {
  "must-not-miss": "must-not-miss",
  routine: "routine",
  casual: "casual",
  "procrastination-risk": "procrastination risk",
};

const INTENT_COLORS: Record<NonNullable<Task["intent"]>, string> = {
  "must-not-miss": "text-rose-300 bg-rose-500/10",
  routine: "text-slate-400 bg-slate-500/10",
  casual: "text-emerald-300 bg-emerald-500/10",
  "procrastination-risk": "text-amber-300 bg-amber-500/10",
};

const EMOTION_COLORS: Record<NonNullable<Task["emotion"]>, string> = {
  stress: "text-rose-300 bg-rose-500/10",
  fatigue: "text-violet-300 bg-violet-500/10",
  motivation: "text-emerald-300 bg-emerald-500/10",
  calm: "text-sky-300 bg-sky-500/10",
  neutral: "text-slate-400 bg-slate-500/10",
};

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Home() {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [ringingAlarm, setRingingAlarm] = useState<Alarm | null>(null);
  const firedIdsRef = useRef<Set<string>>(new Set());
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState<Priority>("medium");
  const [taskDue, setTaskDue] = useState("");
  const [alarmLabel, setAlarmLabel] = useState("");
  const [alarmTime, setAlarmTime] = useState(() => toLocalInputValue(new Date(Date.now() + 60000)));
  const [alarmStrategy, setAlarmStrategy] = useState<WakeStrategy>("adaptive");
  const [alarmIntensity, setAlarmIntensity] = useState(60);
  const [alarmVerify, setAlarmVerify] = useState(true);
  const [alarmMethods, setAlarmMethods] = useState<string[]>(["math"]);

  const userId = session?.user?.id ?? null;
  // What a ring changed is recorded here and sent once the ring is over, so
  // nothing at ring time calls the server; it survives reloads and retries.
  const outbox = useMemo(() => (userId ? new Outbox(browserStore(), `somniai.outbox.v1:${userId}`) : null), [userId]);
  const ringingRef = useRef(false);
  const flushingRef = useRef(false);
  const [pendingSync, setPendingSync] = useState(0);
  const [offline, setOffline] = useState(false);
  // Counts changes made on this page to the alarm and task lists. A list load
  // that started before such a change is older than it, and must not replace
  // it: a fresh alarm used to vanish when the page's first load landed late.
  const localEdits = useRef(0);
  const editAlarms = useCallback((update: (prev: Alarm[]) => Alarm[]) => {
    localEdits.current += 1;
    setAlarms(update);
  }, []);
  const editTasks = useCallback((update: (prev: Task[]) => Task[]) => {
    localEdits.current += 1;
    setTasks(update);
  }, []);

  // In the Android app the phone rings alarms natively; this page keeps the
  // phone's schedule in step with the server (lib/nativeSync.ts) and does not
  // ring them itself, so nothing rings twice.
  const [native, setNative] = useState<NativeConnection | null>(null);
  const [nativeStatus, setNativeStatus] = useState<NativeSyncStatus>({ state: "idle" });
  const nativeSync = native && "sync" in native ? native.sync : null;
  // True only while the alarm list is the server's own: a list that failed to
  // load, or the offline cache, must never be sent to the phone, which would
  // remove the alarms missing from it.
  const serverLoaded = useRef(false);
  useEffect(() => {
    let live = true;
    void connectNative(setNativeStatus).then((c) => {
      if (live) {
        setNative(c);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const loadData = useCallback(async () => {
    // Wait for the session: the device's own copy of the alarms is per user.
    if (!userId) {
      return;
    }
    const store = browserStore();
    try {
      // Load again if something changed on the page meanwhile; after three
      // tries, keep what the page has rather than apply an older answer.
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = localEdits.current;
        const [tRes, aRes] = await Promise.all([
          fetch("/api/tasks"),
          fetch("/api/alarms"),
        ]);
        const tJson = await tRes.json();
        const aJson = await aRes.json();
        if (localEdits.current !== before) {
          continue;
        }
        if (tJson.ok) {
          setTasks(tJson.data.items);
        }
        if (!aJson.ok) {
          throw new Error(aJson.error ?? "alarms unavailable");
        }
        setAlarms(mergeWithLocal(aJson.data.items, loadAlarmCache(store, userId), outbox?.pendingAlarmIds() ?? new Set()));
        serverLoaded.current = true;
        setOffline(false);
        return;
      }
    } catch {
      // The server or its database can't be reached: ring from what this
      // device last knew rather than from nothing.
      serverLoaded.current = false;
      const cached = loadAlarmCache(store, userId);
      if (cached) {
        setAlarms(cached);
      }
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [userId, outbox]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Every list the server gave this page goes to the phone: load, create, edit,
  // toggle and delete all end in a new list. Unchanged lists aren't sent again.
  useEffect(() => {
    if (nativeSync && serverLoaded.current && !offline && !loading) {
      void nativeSync.sync(alarms);
    }
  }, [nativeSync, alarms, offline, loading]);

  // Back in the app: load again, so alarms set elsewhere (another device, the
  // server's own scheduling) reach the phone without waiting for a restart.
  useEffect(() => {
    if (!nativeSync) {
      return;
    }
    const visible = () => {
      if (document.visibilityState === "visible") {
        void loadData();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [nativeSync, loadData]);

  useEffect(() => {
    if (userId && !loading) {
      saveAlarmCache(browserStore(), userId, alarms);
    }
  }, [alarms, userId, loading]);

  const flushOutbox = useCallback(async () => {
    // Never while an alarm is ringing.
    if (!outbox || ringingRef.current || flushingRef.current) {
      return;
    }
    if (outbox.pending().length === 0) {
      setPendingSync(0);
      return;
    }
    flushingRef.current = true;
    try {
      const result = await outbox.flush((entry) => fetch(entry.path, {
        method: entry.method,
        headers: { "Content-Type": "application/json" },
        body: entry.body === undefined ? undefined : JSON.stringify(entry.body),
      }));
      // Once an alarm has nothing left to send, the server's copy is current.
      const stillPending = outbox.pendingAlarmIds();
      if (result.alarms.size > 0) {
        editAlarms((prev) => prev.map((a) => (
          !stillPending.has(a._id) && result.alarms.has(a._id) ? (result.alarms.get(a._id) as unknown as Alarm) : a
        )));
      }
      setOffline(result.stalled);
    }
    finally {
      flushingRef.current = false;
      setPendingSync(outbox.pending().length);
    }
  }, [outbox, editAlarms]);

  useEffect(() => {
    if (!outbox) {
      return;
    }
    void flushOutbox();
    const timer = setInterval(() => void flushOutbox(), 15_000);
    const online = () => void flushOutbox();
    window.addEventListener("online", online);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", online);
    };
  }, [outbox, flushOutbox]);

  // Rings from the alarm record alone; the server hears about it afterwards.
  const fireAlarm = useCallback((alarm: Alarm) => {
    ringingRef.current = true;
    // Marks the whole ring, from this instant until the ringing screen has
    // closed; the end-to-end test checks that no API call falls inside it.
    document.documentElement.dataset.ringing = "true";
    setRingingAlarm(alarm);
    editAlarms((prev) => prev.map((a) => (a._id === alarm._id ? { ...a, status: "ringing" } : a)));
  }, [editAlarms]);

  const markMissed = useCallback((alarm: Alarm) => {
    editAlarms((prev) => prev.map((a) => (a._id === alarm._id ? { ...a, status: "missed", enabled: false } : a)));
    outbox?.enqueue([{ alarmId: alarm._id, method: "PATCH", path: `/api/alarms/${alarm._id}`, body: { status: "missed", enabled: false } }]);
    setPendingSync(outbox?.pending().length ?? 0);
    void flushOutbox();
  }, [outbox, flushOutbox, editAlarms]);

  useEffect(() => {
    // The phone rings them; ringing here as well would ring twice.
    if (nativeSync) {
      return;
    }
    const interval = setInterval(() => {
      const now = Date.now();
      for (const alarm of alarms) {
        if (!alarm.enabled || alarm.status !== "scheduled") {
          continue;
        }
        if (firedIdsRef.current.has(alarm._id)) {
          continue;
        }
        const due = new Date(alarm.scheduledTime).getTime();
        if (now < due) {
          continue;
        }
        if (now - due <= 60000) {
          firedIdsRef.current.add(alarm._id);
          fireAlarm(alarm);
          break;
        }
        if (alarm.repeat?.type === "none") {
          firedIdsRef.current.add(alarm._id);
          markMissed(alarm);
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [alarms, fireAlarm, markMissed, nativeSync]);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    if (!taskTitle.trim()) {
      return;
    }
    const [dueDate, dueTime] = taskDue ? taskDue.split("T") : [undefined, undefined];
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: taskTitle, priority: taskPriority, dueDate, dueTime }),
    });
    const json = await res.json();
    if (json.ok) {
      editTasks((prev) => [json.data, ...prev]);
      setTaskTitle("");
      setTaskDue("");
      setTaskPriority("medium");
    }
  }

  async function toggleTask(task: Task) {
    const res = await fetch(`/api/tasks/${task._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: !task.completed }),
    });
    const json = await res.json();
    if (json.ok) {
      editTasks((prev) => prev.map((t) => (t._id === task._id ? json.data : t)));
    }
  }

  async function deleteTask(id: string) {
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) {
      editTasks((prev) => prev.filter((t) => t._id !== id));
    }
  }

  async function createAlarm(e: React.FormEvent) {
    e.preventDefault();
    if (!alarmLabel.trim()) {
      return;
    }
    const res = await fetch("/api/alarms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: alarmLabel,
        scheduledTime: new Date(alarmTime).toISOString(),
        wakeStrategy: alarmStrategy,
        intensity: alarmIntensity,
        verificationRequired: alarmVerify,
        verificationMethod: alarmVerify ? alarmMethods[0] ?? "math" : "none",
        verificationMethods: alarmVerify
          ? alarmMethods.length > 0
            ? alarmMethods
            : ["math"]
          : [],
      }),
    });
    const json = await res.json();
    if (json.ok) {
      editAlarms((prev) => [...prev, json.data].sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()));
      setAlarmLabel("");
    }
  }

  /** Changes an alarm on the server, then here; the phone follows from the new list. */
  async function updateAlarm(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/alarms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (json.ok) {
      editAlarms((prev) => prev.map((a) => (a._id === id ? json.data : a)).sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()));
    }
    return Boolean(json.ok);
  }

  function toggleAlarm(alarm: Alarm) {
    // Turning one back on arms it again, whatever its last ring left it as.
    return updateAlarm(alarm._id, alarm.enabled ? { enabled: false } : { enabled: true, status: "scheduled" });
  }

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState("");

  async function saveAlarmTime(e: React.FormEvent, alarm: Alarm) {
    e.preventDefault();
    if (await updateAlarm(alarm._id, { scheduledTime: new Date(editTime).toISOString(), status: "scheduled" })) {
      setEditingId(null);
    }
  }

  async function deleteAlarm(id: string) {
    const res = await fetch(`/api/alarms/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) {
      editAlarms((prev) => prev.filter((a) => a._id !== id));
    }
  }

  // The ring is over: its outcome takes effect on this device at once (a
  // snoozed alarm is armed again, a repeating one moves to its next time), and
  // the server is told afterwards through the outbox, which keeps trying if it
  // can't get through.
  function resolveAlarm(result: ResolveResult) {
    const alarm = ringingAlarm;
    setRingingAlarm(null);
    ringingRef.current = false;
    if (!alarm) {
      return;
    }
    const now = new Date();
    const local = result.snoozed ? snoozeLocally(alarm, now) : dismissLocally(alarm, now);
    if (local.status === "scheduled") {
      firedIdsRef.current.delete(alarm._id);
    }
    editAlarms((prev) => prev.map((a) => (a._id === alarm._id ? local : a)));
    outbox?.enqueue(syncCalls(alarm._id, {
      snoozed: result.snoozed,
      snoozedUntil: result.snoozed ? local.scheduledTime : undefined,
      responseMs: result.responseMs,
      timeOnTaskMs: result.timeOnTaskMs,
      // An alarm with no challenge has nothing to verify.
      challenged: resolveRingPlan(alarm).challenge.required,
      methods: result.methods,
      attempts: result.attempts,
      motion: result.motion,
      solved: result.solved,
      correctness: result.correctness,
      escalationLevel: result.escalationLevel,
      backups: result.backups.map((b) => ({ kind: b.kind, status: b.status })),
    }));
    setPendingSync(outbox?.pending().length ?? 0);
    // Sent by the effect below, once the ringing screen has actually closed.
  }

  // The ring is over only when the ringing screen has gone; send what it
  // queued after that, never in the same moment it is dismissed.
  useEffect(() => {
    if (!ringingAlarm) {
      delete document.documentElement.dataset.ringing;
      void flushOutbox();
    }
  }, [ringingAlarm, flushOutbox]);

  const pendingTasks = tasks.filter((t) => !t.completed).length;
  const upcomingAlarms = alarms.filter((a) => a.enabled && a.status === "scheduled").length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {ringingAlarm && <RingingOverlay key={ringingAlarm._id} alarm={ringingAlarm} onResolved={resolveAlarm} />}

      <header className="mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/20">
          <Moon className="h-6 w-6 text-indigo-300" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">SomniAI</h1>
          <p className="text-sm text-slate-400">
            Adaptive Circadian Intelligence - foundation build
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {session?.user && (
            <span className="hidden text-sm text-slate-300 sm:inline">
              {session.user.name || session.user.email}
            </span>
          )}
          <Link
            href="/analytics"
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
          >
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Analytics</span>
          </Link>
          <Link
            href="/simulator"
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Simulator</span>
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/sign-in" })}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </header>

      {(offline || pendingSync > 0) && (
        <p role="status" aria-label="Sync status" className="mb-6 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
          {offline && "Can't reach the server right now. Alarms still ring from this device. "}
          {pendingSync > 0 && `${pendingSync} alarm ${pendingSync === 1 ? "update is" : "updates are"} waiting to reach the server.`}
        </p>
      )}

      <BedtimeReminder userId={userId} />

      {/* The evening starts here: when you must be up, and what tonight takes. */}
      <WakePlanPanel userId={userId} onAlarmsChanged={loadData} />

      <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Pending tasks" value={pendingTasks} />
        <StatCard label="Total tasks" value={tasks.length} />
        <StatCard label="Upcoming alarms" value={upcomingAlarms} />
        <StatCard label="Total alarms" value={alarms.length} />
      </section>

      <InsightsPanel />

      <DataSourcesPanel />

      <SmartSchedulePanel onChange={loadData} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <AlarmClock className="h-5 w-5 text-indigo-300" /> Adaptive Alarms
          </h2>
          <NativeNotice native={native} status={nativeStatus} onRetry={() => void nativeSync?.sync(alarms)} />

          <form onSubmit={createAlarm} className="mb-5 space-y-3">
            <input value={alarmLabel} onChange={(e) => setAlarmLabel(e.target.value)} placeholder="Alarm label (e.g. Wake up for exam)"
className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400" />
<input type="datetime-local" value={alarmTime} onChange={(e) => setAlarmTime(e.target.value)} className="w-full rounded-lg
border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400" />
<div className="flex gap-2">
  <select value={alarmStrategy} onChange={(e) => setAlarmStrategy(e.target.value as WakeStrategy)} className="flex-1 rounded-lg
  border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400">
    <option value="gentle">Gentle</option>
    <option value="adaptive">Adaptive</option>
    <option value="aggressive">Aggressive</option>
  </select>
  <label className="flex items-center gap-2 text-sm text-slate-300">
    <input type="checkbox" checked={alarmVerify} onChange={(e) => setAlarmVerify(e.target.checked)} />
    Verify
  </label>
</div>
<div className="flex items-center gap-3">
  <span className="text-xs text-slate-400">Intensity</span>
  <input type="range" min={0} max={100} value={alarmIntensity} onChange={(e) => setAlarmIntensity(Number(e.target.value))} className="flex-1" />
  <span className="w-8 text-right text-xs text-slate-300">
    {alarmIntensity}
  </span>
</div>
{alarmVerify && (
  <div>
    <p className="mb-1.5 text-xs text-slate-400">
      Wake challenges (in order)
    </p>
    <div className="flex flex-wrap gap-2">
      {([
        ["math", "Math"],
        ["typing", "Typing"],
        ["shake", "Shake"],
        ["qr", "QR scan"],
      ] as const).map(([value, label]) => {
        const active = alarmMethods.includes(value);
        return (
          <button key={value} type="button" onClick={() => setAlarmMethods((prev) => prev.includes(value)
            ? prev.filter((m) => m !== value)
            : [...prev, value])} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${active
            ? "border-indigo-400 bg-indigo-500/20 text-indigo-200"
            : "border-white/10 bg-slate-900/60 text-slate-400 hover:text-slate-200"}`}>
            {label}
          </button>
        );
      })}
    </div>
  </div>
)}
<button type="submit" className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold
text-white transition hover:bg-indigo-400">
  <Plus className="h-4 w-4" /> Add alarm
</button>
</form>

<ul className="space-y-2">
  {alarms.length === 0 && (<li className="text-sm text-slate-500">No alarms yet.</li>)}
  {alarms.map((alarm) => (<li key={alarm._id} className="rounded-lg border border-white/5 bg-slate-900/40 px-3 py-2">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-white">{alarm.label}</p>
        <p className="text-xs text-slate-400">
          {new Date(alarm.scheduledTime).toLocaleString()} • {" "}
          <span className="capitalize">{alarm.wakeStrategy}</span> • {" "}
          {alarm.status}
          {" • "}
          <span title={resolveRingPlan(alarm).note}>
            {!alarm.ringPlan ? "plan: built on this device" : alarm.ringPlan.decidedBy === "ai" ? "plan: AI Brain" : "plan: rule-based"}
          </span>
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => void toggleAlarm(alarm)} aria-pressed={alarm.enabled} aria-label={`${alarm.enabled ? "Turn off" : "Turn on"} ${alarm.label}`}
          className={`rounded-full px-2 py-0.5 text-xs font-semibold transition ${alarm.enabled ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}`}>
          {alarm.enabled ? "On" : "Off"}
        </button>
        <button onClick={() => {
          setEditingId(editingId === alarm._id ? null : alarm._id);
          setEditTime(toLocalInputValue(new Date(alarm.scheduledTime)));
        }} className="text-xs text-slate-400 transition hover:text-indigo-300" aria-label={`Edit time of ${alarm.label}`}>
          Edit
        </button>
        <button onClick={() => deleteAlarm(alarm._id)} className="text-slate-500 transition hover:text-rose-400" aria-label="Delete alarm">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
    {editingId === alarm._id && (<form onSubmit={(e) => void saveAlarmTime(e, alarm)} className="mt-2 flex gap-2">
      <input type="datetime-local" value={editTime} onChange={(e) => setEditTime(e.target.value)} aria-label="New time"
        className="flex-1 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-400" />
      <button type="submit" className="rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-400">Save</button>
    </form>)}
    {alarm.decision?.rationale && (<details className="mt-2 text-xs">
      <summary className="cursor-pointer text-violet-300 transition hover:text-violet-200">
        Why this alarm?
      </summary>
      <p className="mt-1.5 text-slate-300">{alarm.decision.rationale}</p>
      {alarm.decision.attributions?.length ? (<div className="mt-1.5 flex flex-wrap gap-1.5">
        {alarm.decision.attributions.map((a, i) => (<span key={i} title={a.detail ?? `${a.feature}: ${a.value}`}
          className={`rounded-md border px-2 py-0.5 ${a.impact === "increase"
            ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
            : a.impact === "decrease"
            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
            : "border-white/10 bg-white/5 text-slate-300"}`}>
          <span className="opacity-70">{a.feature}:</span>{" "}
          {a.impact === "increase" ? "+" : a.impact === "decrease" ? "-" : ""}{" "}{a.value}
        </span>))}
      </div>) : null}
    </details>)}
  </li>))}
</ul>
</section>

<section className="rounded-2xl border border-white/10 bg-white/5 p-5">
  <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
    <ListTodo className="h-5 w-5 text-sky-300" /> Tasks
  </h2>

  <form onSubmit={createTask} className="mb-5 space-y-3">
    <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Task title (e.g. Submit ML assignment)"
    className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
    <div className="flex gap-2">
      <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value as Priority)}
      className="flex-1 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400">
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>
      <input type="datetime-local" value={taskDue} onChange={(e) => setTaskDue(e.target.value)}
      className="flex-1 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400" />
    </div>
    <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2
    text-sm font-semibold text-white transition hover:bg-sky-400">
      <Plus className="h-4 w-4" /> Add task
    </button>
  </form>

  <ul className="space-y-2">
    {tasks.length === 0 && (<li className="text-sm text-slate-500">No tasks yet.</li>)}
    {tasks.map((task) => (<li key={task._id} className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-900/40 px-3 py-2">
      <button onClick={() => toggleTask(task)} className="flex items-start gap-3 text-left">
        {task.completed ? (<CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" />) : (<Circle className="mt-0.5 h-5 w-5 text-slate-500" />)}
        <span className={`text-sm ${task.completed ? "text-slate-500 line-through" : "text-white"}`}>
          {task.title}
        </span>
        <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_COLORS[task.priority]}`}>
            {task.priority}
          </span>
          {task.aiPriority && task.aiPriority !== task.priority && (<span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_COLORS[task.aiPriority]}" title={`AI suggests ${task.aiPriority} priority`}>
            <Sparkles className="h-2.5 w-2.5" />
            {task.aiPriority}
          </span>)}
          {task.intent && task.intent !== "routine" && (<span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${INTENT_COLORS[task.intent]}`}>
            {INTENT_LABELS[task.intent]}
          </span>)}
          {task.emotion && task.emotion !== "neutral" && (<span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${EMOTION_COLORS[task.emotion]}`} title={typeof task.stressScore === "number" ? `Stress signal ${task.stressScore}/100` : undefined}>
            {task.emotion}
          </span>)}
        </span>
      </button>
      <button onClick={() => deleteTask(task._id)} className="text-slate-500 transition hover:text-rose-400" aria-label="Delete task">
        <Trash2 className="h-4 w-4" />
      </button>
    </li>))}
  </ul>
</section>
</div>

{loading && (<p className="mt-6 text-center text-sm text-slate-500">Loading...</p>)}
<p className="mt-8 text-center text-xs text-slate-600">
  Tip: set an alarm a minute from now to see the adaptive wake + verification flow.
</p>
</main>
);
}

function StatCard({ label, value }: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}

/** Where alarms ring from, in the app, and whether the phone has the latest list. */
function NativeNotice({ native, status, onRetry }: { native: NativeConnection | null; status: NativeSyncStatus; onRetry: () => void }) {
  if (!native || ("reason" in native && native.reason === "browser")) {
    return null;
  }
  if ("reason" in native) {
    return <p role="status" className="mb-4 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{native.reason} Until then, alarms ring only while this screen is open.</p>;
  }
  if (status.state === "failed") {
    return (
      <p role="alert" className="mb-4 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
        Couldn&apos;t update the alarms on this phone: {status.error}{" "}
        <button onClick={onRetry} className="underline">Try again</button>
      </p>
    );
  }
  return (
    <p role="status" className="mb-4 text-xs text-slate-400">
      {status.state === "synced" ? "Alarms ring from this phone, even with the app closed." : "Updating the alarms on this phone…"}
      {status.state === "synced" && status.skipped.length > 0 ? ` ${status.skipped.length} without a valid time weren't set.` : ""}
    </p>
  );
}
