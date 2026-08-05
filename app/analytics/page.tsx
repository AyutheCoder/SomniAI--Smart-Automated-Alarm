"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Line, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from "chart.js";
import {
  ArrowLeft,
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  BarChart3,
  BrainCircuit,
  Lightbulb,
  Moon,
  Sparkles,
  TrendingUp,
} from "lucide-react";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler
);

type TrendDirection = "improving" | "declining" | "steady";
type Tone = "positive" | "warning" | "neutral";

interface DailyPoint {
  date: string;
  weekday: string;
  durationHours: number | null;
  qualityScore: number | null;
  snoozeCount: number | null;
  wakeConfidence: number | null;
}

interface MetricTrend {
  key: string;
  label: string;
  current: number;
  previous: number;
  delta: number;
  direction: TrendDirection;
  betterWhenHigher: boolean;
}

interface WeeklyInsight {
  text: string;
  tone: Tone;
  basis: string;
}

interface WeeklyReport {
  range: {
    start: string;
    end: string;
  };
  nights: number;
  daily: DailyPoint[];
  trends: MetricTrend[];
  averages: {
    durationHours: number | null;
    qualityScore: number | null;
    snoozeCount: number | null;
    wakeConfidence: number | null;
  };
  insights: WeeklyInsight[];
}

interface RlAction {
  offsetMin: number;
  strategy: string;
  intensity: number;
}

type Impact = "increase" | "decrease" | "neutral";

interface Attribution {
  feature: string;
  value: string;
  impact: Impact;
  weight: number;
  detail?: string;
}

interface Explanation {
  summary: string;
  rationale: string;
  attributions: Attribution[];
  confidence?: number;
}

interface Personalization {
  updates: number;
  meanReward: number;
  summary: {
    preferredAction?: RlAction;
    explored?: number;
    totalArms?: number;
  } | null;
  explanation?: Explanation | null;
}

interface Coaching {
  sleepScore: number;
  reportSource: "ai" | "fallback";
  predictionSource: "ai" | "fallback";
}

interface WeeklyResponse {
  report: WeeklyReport;
  coaching: Coaching | null;
  personalization: Personalization;
  hasData: boolean;
}

const TONE_STYLES: Record<Tone, string> = {
  positive: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
  warning: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  neutral: "border-sky-400/40 bg-sky-500/10 text-sky-200",
};

function TrendArrow({ direction }: { direction: TrendDirection }) {
  if (direction === "improving")
    return <ArrowUpRight className="h-4 w-4 text-emerald-300" />;
  if (direction === "declining")
    return <ArrowDownRight className="h-4 w-4 text-rose-300" />;
  return <Minus className="h-4 w-4 text-slate-400" />;
}

function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-slate-400">{unit}</span>}
      </p>
    </div>
  );
}

const IMPACT_STYLES: Record<Impact, string> = {
  increase: "border-rose-400/30 bg-rose-500/10 text-rose-200",
  decrease: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  neutral: "border-white/10 bg-white/5 text-slate-300",
};

function impactArrow(impact: Impact): string {
  return impact === "increase" ? "\u2191" : impact === "decrease" ? "\u2193" : "\u2192";
}

function AttributionChips({ attributions }: { attributions: Attribution[] }) {
  if (!attributions || attributions.length === 0)
    return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {attributions.map((a, i) => (
        <span
          key={i}
          title={a.detail ?? `${a.feature}: ${a.value}`}
          className={`rounded-md border px-2 py-0.5 text-xs ${IMPACT_STYLES[a.impact]}`}
        >
          <span className="opacity-70">{a.feature}</span>{" "}
          <span className="font-medium">{impactArrow(a.impact)} {a.value}</span>
        </span>
      ))}
    </div>
  );
}

const chartCommon: ChartOptions<"line" | "bar"> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: { color: "#cbd5e1", boxWidth: 12, font: { size: 11 } },
    },
  },
  scales: {
    x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.05)" } },
    y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.05)" } },
  },
};

export default function AnalyticsPage() {
  const [data, setData] = useState<WeeklyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/analytics/weekly", { cache: "no-store" });
        const json = await res.json();
        if (!active) return;
        if (json.ok) {
          setData(json.data as WeeklyResponse);
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

  const report = data?.report;
  const labels = report?.daily.map((d) => d.weekday) ?? [];
  const durationData = {
    labels,
    datasets: [
      {
        label: "Sleep (h)",
        data: report?.daily.map((d) => d.durationHours) ?? [],
        borderColor: "#818cf8",
        backgroundColor: "rgba(129,140,248,0.18)",
        fill: true,
        tension: 0.35,
        spanGaps: true,
        yAxisID: "y",
      },
      {
        label: "Quality",
        data: report?.daily.map((d) => d.qualityScore) ?? [],
        borderColor: "#38bdf8",
        backgroundColor: "rgba(56,189,248,0.12)",
        fill: false,
        tension: 0.35,
        spanGaps: true,
        yAxisID: "y1",
      },
    ],
  };

  const durationOptions: ChartOptions<"line"> = {
    ...(chartCommon as ChartOptions<"line">),
    scales: {
      x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.05)" } },
      y: {
        position: "left",
        min: 0,
        max: 12,
        title: { display: true, text: "Hours", color: "#94a3b8" },
        ticks: { color: "#94a3b8" },
        grid: { color: "rgba(255,255,255,0.05)" },
      },
      y1: {
        position: "right",
        min: 0,
        max: 100,
        title: { display: true, text: "Quality", color: "#94a3b8" },
        ticks: { color: "#94a3b8" },
        grid: { drawOnChartArea: false },
      },
    },
  };

  const snoozeData = {
    labels,
    datasets: [
      {
        label: "Snoozes",
        data: report?.daily.map((d) => d.snoozeCount ?? 0) ?? [],
        backgroundColor: "#fbbf24",
        borderRadius: 6,
      },
    ],
  };

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
          <h1 className="text-2xl font-bold text-white">Weekly AI Report</h1>
          <p className="text-sm text-slate-400">
            Sleep trends, fatigue &amp; productivity insights, and learned personalization.
          </p>
        </div>
        {data?.coaching && (
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
              data.coaching.reportSource === "ai" || data.coaching.predictionSource === "ai"
                ? "border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-200"
                : "border-white/10 bg-white/5 text-slate-300"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {data.coaching.reportSource === "ai" || data.coaching.predictionSource === "ai"
              ? "AI Brain"
              : "Rule-based"}
          </span>
        )}
      </header>

      {loading && (
        <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-slate-400">
          Loading your weekly report…
        </p>
      )}

      {error && !loading && (
        <p className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6 text-rose-200">
          Couldn&apos;t load the weekly report. Please try again.
        </p>
      )}

      {!loading && !error && report && (
        <>
          {!data?.hasData && (
            <p className="mb-6 rounded-2xl border border-sky-400/30 bg-sky-500/10 p-4 text-sm text-sky-200">
              No sleep logged in the last 7 days. Use the{" "}
              <Link href="/simulator" className="underline">
                Behavior Simulator
              </Link>{" "}
              to generate data, then revisit this report.
            </p>
          )}

          <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Avg sleep"
              value={report.averages.durationHours?.toFixed(1) ?? "-"}
              unit="h"
            />
            <StatCard
              label="Avg quality"
              value={report.averages.qualityScore?.toString() ?? "-"}
            />
            <StatCard
              label="Avg snoozes"
              value={report.averages.snoozeCount?.toFixed(1) ?? "-"}
            />
            <StatCard
              label="Wake confidence"
              value={report.averages.wakeConfidence?.toString() ?? "-"}
            />
          </section>

          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Moon className="h-5 w-5 text-indigo-300" />
                <h2 className="text-lg font-semibold text-white">
                  Sleep &amp; quality
                </h2>
              </div>
              <div className="h-64">
                <Line data={durationData} options={durationOptions} />
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-amber-300" />
                <h2 className="text-lg font-semibold text-white">
                  Snooze burden
                </h2>
              </div>
              <div className="h-64">
                <Bar data={snoozeData} options={chartCommon as ChartOptions<"bar">} />
              </div>
            </section>
          </div>
        <section className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-300" />
              <h2 className="text-lg font-semibold text-white">
                Week-over-week trends
              </h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {report.trends.map((t) => (
                <div key={t.key} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-300">{t.label}</span>
                    <TrendArrow direction={t.direction} />
                  </div>
                  <p className="mt-2 text-2xl font-bold text-white">
                    {t.current}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {t.delta > 0 ? "+" : ""}
                    {t.delta} vs last week
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-yellow-300" />
              <h2 className="text-lg font-semibold text-white">
                Personalized insights
              </h2>
            </div>
            <ul className="space-y-3">
              {report.insights.map((ins, i) => (
                <li key={i} className={`rounded-xl border px-4 py-3 text-sm ${TONE_STYLES[ins.tone]}`}>
                  {ins.text}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-fuchsia-300" />
              <h2 className="text-lg font-semibold text-white">
                Learned personalization
              </h2>
            </div>
            {data && data.personalization.updates > 0 ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label="Feedback events" value={String(data.personalization.updates)} />
                <StatCard label="Mean reward" value={data.personalization.meanReward.toFixed(2)} />
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    Preferred strategy
                  </p>
                  <p className="mt-1 text-lg font-semibold capitalize text-white">
                    {data.personalization.summary?.preferredAction?.strategy ?? "adaptive"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    offset({data.personalization.summary?.preferredAction?.offsetMin ?? 0})
                    min · intensity({data.personalization.summary?.preferredAction?.intensity ?? 70})
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                The adaptive policy hasn&apos;t collected feedback yet. As you dismiss alarms, SomniAI learns your best wake strategy and shows its progress here.
              </p>
            )}
            {data?.personalization.explanation ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/40 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Why this strategy?
                </p>
                <p className="mb-2 text-sm text-slate-300">
                  {data.personalization.explanation.rationale}
                </p>
                <AttributionChips attributions={data.personalization.explanation.attributions} />
              </div>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}