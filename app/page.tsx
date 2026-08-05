"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlarmClock, BarChart3, CheckCircle2, Circle, ListTodo, LogOut, Moon, Plus, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import type { Alarm, Priority, Task, WakeStrategy } from "@/lib/types";
import RingingOverlay, { type ResolveResult } from "./_components/RingingOverlay";
import InsightsPanel from "./_components/InsightsPanel";
import SmartSchedulePanel from "./_components/SmartSchedulePanel";
import WakePlanPanel from "./_components/WakePlanPanel";

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

  const loadData = useCallback(async () => {
    try {
      const [tRes, aRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/alarms"),
      ]);
      const tJson = await tRes.json();
      const aJson = await aRes.json();
      if (tJson.ok) {
        setTasks(tJson.data.items);
      }
      if (aJson.ok) {
        setAlarms(aJson.data.items);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const fireAlarm = useCallback(async (alarm: Alarm) => {
    setRingingAlarm(alarm);
    try {
      const res = await fetch(`/api/alarms/${alarm._id}/fire`, { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        setAlarms((prev) => prev.map((a) => (a._id === alarm._id ? json.data : a)));
      }
    } catch {
    }
  }, []);

  const markMissed = useCallback(async (alarm: Alarm) => {
    try {
      const res = await fetch(`/api/alarms/${alarm._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "missed", enabled: false }),
      });
      const json = await res.json();
      if (json.ok) {
        setAlarms((prev) => prev.map((a) => (a._id === alarm._id ? json.data : a)));
      }
    } catch {
    }
  }, []);

  useEffect(() => {
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
  }, [alarms, fireAlarm, markMissed]);

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
      setTasks((prev) => [json.data, ...prev]);
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
      setTasks((prev) => prev.map((t) => (t._id === task._id ? json.data : t)));
    }
  }

  async function deleteTask(id: string) {
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) {
      setTasks((prev) => prev.filter((t) => t._id !== id));
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
      setAlarms((prev) => [...prev, json.data].sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()));
      setAlarmLabel("");
    }
  }

  async function deleteAlarm(id: string) {
    const res = await fetch(`/api/alarms/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) {
      setAlarms((prev) => prev.filter((a) => a._id !== id));
    }
  }

  async function resolveAlarm(result: ResolveResult) {
    const alarm = ringingAlarm;
    setRingingAlarm(null);
    if (!alarm) {
      return;
    }
    if (result.snoozed) {
      const res = await fetch(`/api/alarms/${alarm._id}/snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snoozeMinutes: 5, responseMs: result.responseMs }),
      });
      const json = await res.json();
      if (json.ok) {
        firedIdsRef.current.delete(alarm._id);
        setAlarms((prev) => prev.map((a) => (a._id === alarm._id ? json.data : a)));
      }
    } else {
      await fetch(`/api/alarms/${alarm._id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confidence: result.confidence,
          methods: result.methods,
          responseMs: result.responseMs,
          attempts: result.attempts,
          motion: result.motion,
          // The server re-scores from these rather than trusting `confidence`.
          solved: result.solved,
          correctness: result.correctness,
        }),
      });
      if (result.escalationLevel >= 5) {
        await fetch(`/api/alarms/${alarm._id}/escalate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            level: result.escalationLevel,
            backups: [
              "secondaryAlarm",
              "smartwatch",
              "smartLight",
              "smartSpeaker",
              "emergencyContact",
            ],
          }),
        });
      }
      const res = await fetch(`/api/alarms/${alarm._id}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confidence: result.confidence,
          responseMs: result.responseMs,
          verified: result.verified,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        if (json.data.enabled && json.data.status === "scheduled") {
          firedIdsRef.current.delete(alarm._id);
        }
        setAlarms((prev) => prev.map((a) => (a._id === alarm._id ? json.data : a)));
      }
    }
  }

  const pendingTasks = tasks.filter((t) => !t.completed).length;
  const upcomingAlarms = alarms.filter((a) => a.enabled && a.status === "scheduled").length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {ringingAlarm && <RingingOverlay alarm={ringingAlarm} onResolved={resolveAlarm} />}

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

      <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Pending tasks" value={pendingTasks} />
        <StatCard label="Total tasks" value={tasks.length} />
        <StatCard label="Upcoming alarms" value={upcomingAlarms} />
        <StatCard label="Total alarms" value={alarms.length} />
      </section>

      <InsightsPanel />

      <WakePlanPanel />

      <SmartSchedulePanel onChange={loadData} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <AlarmClock className="h-5 w-5 text-indigo-300" /> Adaptive Alarms
          </h2>

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
        </p>
      </div>
      <button onClick={() => deleteAlarm(alarm._id)} className="text-slate-500 transition hover:text-rose-400" aria-label="Delete alarm">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
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