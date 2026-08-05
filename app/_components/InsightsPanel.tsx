"use client";

import { useEffect, useState } from "react";
import {
  AlarmClock,
  AlertTriangle,
  BatteryLow,
  BrainCircuit,
  Check,
  Info,
  Moon,
  Repeat,
  Sparkles,
  TrendingUp,
  VolumeX,
  type LucideIcon,
} from "lucide-react";

type Priority = "low" | "medium" | "high";
type AISource = "ai" | "fallback";

interface Recommendation {
  text: string;
  priority: Priority;
  icon?: string;
  basis?: string;
}

interface Insights {
  sleepScore: number;
  subScores: {
    duration: number;
    consistency: number;
    behavior: number;
  };
  recommendations: Recommendation[];
  prediction: {
    predictedSleepDuration: number;
    wakeupConsistency: number;
    wakeSuccessProbability: number;
    oversleepProbability: number;
    confidence: number;
  };
  reportSource: AISource;
  predictionSource: AISource;
  recentSleepHours: number | null;
  sleepGoalHours: number;
}

const ICONS: Record<string, LucideIcon> = {
  moon: Moon,
  repeat: Repeat,
  "alert-triangle": AlertTriangle,
  "battery-low": BatteryLow,
  "alarm-clock": AlarmClock,
  "volume-x": VolumeX,
  check: Check,
  info: Info,
};

const PRIORITY_STYLES: Record<Priority, string> = {
  high: "border-rose-400/40 bg-rose-500/10 text-rose-200",
  medium: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  low: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
};

function scoreColor(score: number): string {
  if (score >= 8) return "text-emerald-300";
  if (score >= 6) return "text-sky-300";
  if (score >= 4) return "text-amber-300";
  return "text-rose-300";
}

function SubScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    pct >= 80
      ? "bg-emerald-400"
      : pct >= 55
      ? "bg-sky-400"
      : pct >= 35
      ? "bg-amber-400"
      : "bg-rose-400";

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300">{Math.round(pct)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function InsightsPanel() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/recommendations", { cache: "no-store" });
        const json = await res.json();
        if (!active) return;
        if (json.ok) {
          setInsights(json.data as Insights);
        } else {
          setError(true);
        }
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const isLive =
    insights?.reportSource === "ai" || insights?.predictionSource === "ai";

  return (
    <section className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex items-center gap-2">
        <BrainCircuit className="h-5 w-5 text-fuchsia-300" />
        <h2 className="text-lg font-semibold text-white">Sleep Score &amp; Coaching</h2>
        <span
          className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
            isLive
              ? "border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-200"
              : "border-white/10 bg-white/5 text-slate-400"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {isLive ? "AI Brain" : "Rule-based"}
        </span>
      </div>

      {loading && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="h-28 animate-pulse rounded-xl bg-white/5" />
          <div className="h-28 animate-pulse rounded-xl bg-white/5 sm:col-span-2" />
        </div>
      )}

      {!loading && error && (
        <p className="text-sm text-slate-400">
          Insights are unavailable right now. They will appear once your sleep data is ready.
        </p>
      )}

      {!loading && insights && (
        <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
          <div className="flex flex-col gap-4 sm:flex-row lg:flex-col">
            <div className="flex min-w-[140px] flex-col items-center justify-center rounded-xl border border-white/10 bg-slate-900/40 p-4">
              <span className="text-xs uppercase tracking-wide text-slate-400">Sleep Score</span>
              <span className={`text-5xl font-bold ${scoreColor(insights.sleepScore)}`}>
                {insights.sleepScore.toFixed(1)}
              </span>
              <span className="text-xs text-slate-500">out of 10</span>
            </div>

            <div className="flex flex-1 flex-col justify-center gap-2.5">
              <SubScoreBar label="Duration" value={insights.subScores.duration} />
              <SubScoreBar label="Consistency" value={insights.subScores.consistency} />
              <SubScoreBar label="Behavior" value={insights.subScores.behavior} />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <Metric
                icon={Moon}
                label="Predicted sleep"
                value={`${insights.prediction.predictedSleepDuration.toFixed(1)} h`}
              />
              <Metric
                icon={TrendingUp}
                label="Wake success"
                value={`${Math.round(insights.prediction.wakeSuccessProbability * 100)}%`}
              />
              <Metric
                icon={Repeat}
                label="Consistency"
                value={`${Math.round(insights.prediction.wakeupConsistency)}%`}
              />
            </div>

            <div className="space-y-2">
              {insights.recommendations.length === 0 && (
                <p className="text-sm text-slate-400">
                  No recommendations — your routine looks great.
                </p>
              )}
              {insights.recommendations.map((rec, i) => {
                const Icon = (rec.icon && ICONS[rec.icon]) || Info;
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-3 rounded-xl border border-white/10 bg-slate-900/40 p-3`}
                  >
                    <span
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                        PRIORITY_STYLES[rec.priority]
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200">{rec.text}</p>
                      {rec.basis && (
                        <p className="mt-0.5 text-xs text-slate-500">{rec.basis}</p>
                      )}
                    </div>
                    <span
                      className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        PRIORITY_STYLES[rec.priority]
                      }`}
                    >
                      {rec.priority}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  );
}