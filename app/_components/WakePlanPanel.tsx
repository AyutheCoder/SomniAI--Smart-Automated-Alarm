"use client";

import { useEffect, useState } from "react";
import { AlarmClock, ArrowRight, BellRing, CalendarClock, Loader2, ShieldAlert, Target } from "lucide-react";
import type { WakePlan } from "@/lib/aiClient";
import { bedtimeBefore, clockTime, loadReminder, nextWakeAt, saveReminder, type BedtimeReminder } from "@/lib/bedtime";
import { browserStore } from "@/lib/outbox";
import { MODEL_CAVEAT, REGULARITY_LABEL, type ConfidenceText } from "@/lib/predictionCopy";
import PredictionOrigin from "./PredictionOrigin";

/** The planner has no fallback: a plan exists only when the AI Brain made it. */
const PLAN_CONFIDENCE: ConfidenceText = {
  label: "model estimate",
  detail: `${MODEL_CAVEAT} The percentages are the chance you wake close to your usual time.`,
};

/** How much it matters, and the alarm that goes with it. */
export const IMPORTANCE = [
  { value: 0.7, label: "Nice to have", strategy: "gentle", minConfidence: 70 },
  { value: 0.85, label: "Important", strategy: "adaptive", minConfidence: 75 },
  { value: 0.95, label: "Cannot miss", strategy: "aggressive", minConfidence: 85 },
] as const;

const BACKUP_DELAY_MIN = 10;

export const REMINDER_CHANGED = "somniai:bedtime-reminder-changed";

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

/** A shortfall in points, never "0%" for one that only rounds away. */
function gap(target: number, reached: number) {
  const points = (target - reached) * 100;
  return points < 0.5 ? "less than 1 point" : `${Math.round(points)} ${Math.round(points) === 1 ? "point" : "points"}`;
}

export type PlanKind = "bedtime" | "changes" | "unreachable";

/**
 * Which of the three answers a plan is, from the planner's own verdicts. Never
 * worked out again from the percentages: they are rounded, and a refused
 * target can round to the very number it was refused at.
 */
export function planKind(plan: WakePlan): PlanKind {
  if (!plan.reachesTarget) {
    return "unreachable";
  }
  return plan.feasible && plan.recommendedBedtime ? "bedtime" : "changes";
}

/** The bedtime to aim for: the planned one, or the bedtime step of a set of changes. */
export function plannedBedtimeHour(plan: WakePlan): number | null {
  if (plan.recommendedBedtimeHour != null) {
    return plan.recommendedBedtimeHour;
  }
  return plan.combinedPlan.find((s) => s.feature === "bedtime_hour")?.to ?? null;
}

/** "22.25" -> "22:15", "24.5" -> "00:30". */
function hourLabel(hour: number) {
  const minutes = Math.round(hour * 60);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export interface PlanActions {
  onRemind?: () => void;
  onSetAlarm?: () => void;
  onSetBackup?: () => void;
  busy?: boolean;
}

export default function WakePlanPanel({ userId, onAlarmsChanged }: { userId: string | null; onAlarmsChanged?: () => void }) {
  const [wakeTime, setWakeTime] = useState("06:30");
  const [required, setRequired] = useState(0.85);
  const [plan, setPlan] = useState<WakePlan | null>(null);
  const [planFor, setPlanFor] = useState<{ wakeTime: string; required: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reminder, setReminder] = useState<BedtimeReminder | null>(null);

  useEffect(() => {
    if (userId) {
      setReminder(loadReminder(browserStore(), userId));
    }
  }, [userId]);

  async function run() {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/ai/wake-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiredReliability: required, wakeTime }),
      });
      const json = await res.json();
      if (json.ok) {
        setPlan(json.data.plan);
        setPlanFor({ wakeTime, required });
      }
      else {
        setError(json.error ?? "Could not build a plan.");
        setPlan(null);
      }
    }
    catch {
      setError("Could not reach the planner.");
      setPlan(null);
    }
    finally {
      setLoading(false);
    }
  }

  async function remind() {
    if (!plan || !planFor || !userId) {
      return;
    }
    const now = new Date();
    const wakeAt = nextWakeAt(planFor.wakeTime, now);
    const hour = plannedBedtimeHour(plan);
    const bedtime = hour === null ? null : bedtimeBefore(wakeAt, hour);
    if (!bedtime) {
      setNotice("This plan has no bedtime before your wake time to remind you of.");
      return;
    }
    if (bedtime.getTime() <= now.getTime()) {
      setNotice(`Your planned bedtime, ${clockTime(bedtime)}, has already passed. Going to sleep now still helps.`);
      return;
    }
    const next: BedtimeReminder = { at: bedtime.toISOString(), wakeAt: wakeAt.toISOString() };
    saveReminder(browserStore(), userId, next);
    setReminder(next);
    window.dispatchEvent(new Event(REMINDER_CHANGED));
    let permission: NotificationPermission | "unsupported" = "unsupported";
    if (typeof Notification !== "undefined") {
      permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    }
    setNotice(permission === "granted"
      ? `You'll get a notification at ${clockTime(bedtime)}, while a SomniAI tab is open.`
      : `Notifications are off for this site, so the reminder will appear on this page at ${clockTime(bedtime)} if it is open.`);
  }

  function cancelReminder() {
    if (userId) {
      saveReminder(browserStore(), userId, null);
      window.dispatchEvent(new Event(REMINDER_CHANGED));
    }
    setReminder(null);
    setNotice("");
  }

  async function setAlarm(backup: boolean) {
    if (!planFor) {
      return;
    }
    const level = IMPORTANCE.find((c) => c.value === planFor.required) ?? IMPORTANCE[1];
    const wakeAt = nextWakeAt(planFor.wakeTime, new Date());
    const at = backup ? new Date(wakeAt.getTime() + BACKUP_DELAY_MIN * 60_000) : wakeAt;
    setBusy(true);
    try {
      const res = await fetch("/api/alarms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: backup ? `Backup for ${planFor.wakeTime}` : `Must be up at ${planFor.wakeTime}`,
          scheduledTime: at.toISOString(),
          wakeStrategy: backup ? "aggressive" : level.strategy,
          verificationRequired: true,
          verificationMethod: "math",
          minConfidence: backup ? 85 : level.minConfidence,
        }),
      });
      const json = await res.json();
      setNotice(json.ok
        ? `${backup ? "Backup alarm" : "Alarm"} set for ${clockTime(at)}.`
        : json.error ?? "Could not set the alarm.");
      if (json.ok) {
        onAlarmsChanged?.();
      }
    }
    catch {
      setNotice("Could not reach the server to set the alarm.");
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Tonight" className="mb-8 rounded-2xl border border-emerald-400/20 bg-slate-900/60 p-5">
      <div className="mb-1 flex items-center gap-2">
        <Target className="h-5 w-5 text-emerald-300" />
        <h2 className="text-lg font-semibold text-white">Tonight</h2>
        <span className="ml-auto rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
          Wake planner
        </span>
      </div>
      <p className="mb-4 text-sm text-slate-400">
        Tell it when you must be up and how much it matters. It works backwards
        through the wake-time regularity model to the latest bedtime that still gets
        you there, or tells you plainly that tonight can&apos;t. The percentages are
        the chance you wake close to your usual time, not a promise that you will be
        up at a set time.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Must be up at</span>
          <input
            type="time"
            value={wakeTime}
            onChange={(e) => setWakeTime(e.target.value)}
            className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">How important</span>
          <select
            value={required}
            onChange={(e) => setRequired(Number(e.target.value))}
            className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
          >
            {IMPORTANCE.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label} ({pct(c.value)})
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
          Plan my night
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {error}
        </p>
      )}

      {plan && planFor && (
        <WakePlanView
          plan={plan}
          wakeTime={planFor.wakeTime}
          actions={{ onRemind: remind, onSetAlarm: () => setAlarm(false), onSetBackup: () => setAlarm(true), busy }}
        />
      )}

      {notice && <p role="status" className="mt-3 text-sm text-emerald-200">{notice}</p>}
      {reminder && (
        <p className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <BellRing className="h-3.5 w-3.5" />
          {reminder.shownAt ? "Bedtime reminder shown" : `Bedtime reminder set for ${clockTime(new Date(reminder.at))}`}
          <button type="button" onClick={cancelReminder} className="underline decoration-dotted hover:text-slate-200">
            {reminder.shownAt ? "Clear" : "Cancel"}
          </button>
        </p>
      )}
    </section>
  );
}

/** A plan's result; separate so its text can be tested. Plans only come from the AI Brain. */
export function WakePlanView({ plan, wakeTime, actions = {} }: { plan: WakePlan; wakeTime: string; actions?: PlanActions }) {
  const kind = planKind(plan);
  const reached = kind === "bedtime" ? plan.achievedReliability : plan.combinedReliability;
  const habit = plan.habitConstraints[0];
  const bedtimeHour = plannedBedtimeHour(plan);
  const backupAt = (() => {
    const [h, m] = wakeTime.split(":").map(Number);
    const total = (h * 60 + m + BACKUP_DELAY_MIN) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  })();

  return (
    <div data-plan={kind} className="mt-5 space-y-4">
      <PredictionOrigin what="Plan" origin="ai" confidence={PLAN_CONFIDENCE} />

      {kind === "bedtime" && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
          <p className="text-sm text-emerald-100">The latest bedtime that still reaches {pct(plan.targetReliability)}:</p>
          <p className="mt-1 flex items-baseline gap-3 text-white">
            <span className="text-sm text-slate-300">Asleep by</span>
            <span className="text-3xl font-semibold tabular-nums">{plan.recommendedBedtime}</span>
          </p>
          <p className="mt-1 text-sm text-slate-300">
            {plan.shiftMinutes != null && plan.shiftMinutes > 5
              ? `${plan.shiftMinutes} min earlier than your usual bedtime.`
              : "Your usual bedtime already gets you there."}
            {plan.predictedSleepHours != null && ` About ${plan.predictedSleepHours.toFixed(1)} h of sleep.`}
          </p>
        </div>
      )}

      {kind === "changes" && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
          <p className="text-sm text-emerald-100">
            Bedtime alone tops out at {pct(plan.achievedReliability)}. The smallest set of changes that
            reaches {pct(plan.targetReliability)} takes you to {pct(plan.combinedReliability)}:
          </p>
          <StepList steps={plan.combinedPlan} />
        </div>
      )}

      {kind === "unreachable" && (
        <div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
          <p className="flex items-center gap-2 font-semibold text-amber-100">
            <ShieldAlert className="h-4 w-4" />
            {pct(plan.targetReliability)} isn&apos;t reachable tonight.
          </p>
          <p className="mt-2 text-sm text-amber-100">
            The most tonight&apos;s changes can reach is {pct(plan.combinedReliability)}, {gap(plan.targetReliability, plan.combinedReliability)} short.
          </p>
          {habit && (
            <p className="mt-1 text-sm text-amber-100">
              What holds it back is a habit, not tonight: {habit.label.toLowerCase()} would be worth
              +{pct(habit.reliabilityGain)} on its own, over {habit.horizon ?? "weeks"}.
            </p>
          )}
          <p className="mt-2 text-sm font-medium text-white">
            Set a second alarm, ideally on another device, so one failure can&apos;t make you miss it.
          </p>
          <button
            type="button"
            onClick={actions.onSetBackup}
            disabled={actions.busy}
            className="mt-2 flex items-center gap-2 rounded-lg border border-amber-300/40 px-3 py-1.5 text-sm text-amber-100 transition hover:bg-amber-500/20 disabled:opacity-60"
          >
            <AlarmClock className="h-4 w-4" /> Add a backup alarm at {backupAt}
          </button>
          {plan.combinedPlan.length > 0 && (
            <>
              <p className="mt-3 text-xs uppercase tracking-wider text-amber-200/80">The closest tonight can get</p>
              <StepList steps={plan.combinedPlan} />
            </>
          )}
        </div>
      )}

      <p className="-mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">{REGULARITY_LABEL}</p>
      <div className="grid grid-cols-3 gap-3 text-center">
        {([
          ["Tonight as-is", plan.baselineReliability],
          [kind === "unreachable" ? "Best tonight" : "With the plan", reached],
          ["You asked for", plan.targetReliability],
        ] as const).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
            <div className="text-xs text-slate-400">{label}</div>
            <div className="text-xl font-semibold tabular-nums text-white">{pct(value)}</div>
          </div>
        ))}
      </div>

      {plan.habitConstraints.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            What actually limits you (takes weeks)
          </h3>
          <ul className="space-y-1.5">
            {plan.habitConstraints.map((h) => (
              <li key={h.feature} className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
                <span className="flex-1">{h.label}</span>
                <span className="tabular-nums text-sky-300">+{pct(h.reliabilityGain)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {bedtimeHour !== null && (
          <button
            type="button"
            onClick={actions.onRemind}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100 transition hover:bg-white/10"
          >
            <BellRing className="h-4 w-4" /> Remind me at {hourLabel(bedtimeHour)}
          </button>
        )}
        <button
          type="button"
          onClick={actions.onSetAlarm}
          disabled={actions.busy}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100 transition hover:bg-white/10 disabled:opacity-60"
        >
          <AlarmClock className="h-4 w-4" /> Set my {wakeTime} alarm
        </button>
      </div>
    </div>
  );
}

function StepList({ steps }: { steps: WakePlan["combinedPlan"] }) {
  return (
    <ol className="mt-2 space-y-1.5">
      {steps.map((s) => (
        <li key={s.feature} className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
          <ArrowRight className="h-3.5 w-3.5 flex-none text-emerald-300" />
          <span className="flex-1">{s.label}</span>
          <span className="tabular-nums text-emerald-300">+{pct(s.reliabilityGain)}</span>
        </li>
      ))}
    </ol>
  );
}
