"use client";

import { useState } from "react";
import { Target, ArrowRight, TriangleAlert, CalendarClock, Loader2 } from "lucide-react";
import type { WakePlan } from "@/lib/aiClient";

const RELIABILITY_CHOICES = [
  { value: 0.7, label: "Nice to have" },
  { value: 0.85, label: "Important" },
  { value: 0.95, label: "Cannot miss" },
];

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

export default function WakePlanPanel() {
  const [wakeTime, setWakeTime] = useState("06:30");
  const [required, setRequired] = useState(0.85);
  const [plan, setPlan] = useState<WakePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/wake-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiredReliability: required, wakeTime }),
      });
      const json = await res.json();
      if (json.ok) {
        setPlan(json.data.plan);
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

  const met = plan?.reachesTarget ?? false;

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
      <div className="mb-1 flex items-center gap-2">
        <Target className="h-5 w-5 text-emerald-300" />
        <h2 className="text-lg font-semibold text-white">Wake Planner</h2>
        <span className="ml-auto rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
          Reverse forecast
        </span>
      </div>
      <p className="mb-4 text-sm text-slate-400">
        Tell it when you must be up and how sure you need to be. It works backwards
        through your sleep model to the latest bedtime that still gets you there.
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
            {RELIABILITY_CHOICES.map((c) => (
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
          className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
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

      {plan && (
        <div className="mt-5 space-y-4">
          <div
            className={`rounded-xl border p-4 ${
              met
                ? "border-emerald-400/30 bg-emerald-500/10"
                : "border-amber-400/30 bg-amber-500/10"
            }`}
          >
            <div className="flex items-start gap-2">
              {!met && <TriangleAlert className="mt-0.5 h-4 w-4 flex-none text-amber-300" />}
              <p className={`text-sm ${met ? "text-emerald-100" : "text-amber-100"}`}>
                {plan.summary}
              </p>
            </div>

            {plan.recommendedBedtime && (
              <div className="mt-3 flex items-center gap-3 text-white">
                <span className="text-sm text-slate-400">Asleep by</span>
                <span className="text-3xl font-semibold tabular-nums">
                  {plan.recommendedBedtime}
                </span>
                {plan.predictedSleepHours != null && (
                  <span className="text-sm text-slate-400">
                    ≈ {plan.predictedSleepHours} h sleep
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              ["Tonight as-is", plan.baselineReliability],
              ["With the plan", plan.combinedReliability],
              ["You asked for", plan.targetReliability],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                <div className="text-xs text-slate-400">{label as string}</div>
                <div className="text-xl font-semibold tabular-nums text-white">
                  {pct(value as number)}
                </div>
              </div>
            ))}
          </div>

          {plan.combinedPlan.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                Do tonight
              </h3>
              <ul className="space-y-1.5">
                {plan.combinedPlan.map((s) => (
                  <li
                    key={s.feature}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-200"
                  >
                    <ArrowRight className="h-3.5 w-3.5 flex-none text-emerald-300" />
                    <span className="flex-1">{s.label}</span>
                    <span className="tabular-nums text-emerald-300">
                      +{pct(s.reliabilityGain)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.habitConstraints.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                What actually limits you (takes weeks)
              </h3>
              <ul className="space-y-1.5">
                {plan.habitConstraints.map((h) => (
                  <li
                    key={h.feature}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-300"
                  >
                    <span className="flex-1">{h.label}</span>
                    <span className="tabular-nums text-sky-300">+{pct(h.reliabilityGain)}</span>
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
