"use client";

import { useState } from "react";
import {
  AlarmClock,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { SKIP_EXPLANATIONS, type SkippedTask } from "@/lib/scheduler";

type AISource = "ai" | "fallback";
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

interface AlarmFactor {
  label: string;
  value: string;
}

interface AlarmPlan {
  label: string;
  scheduledTime: string;
  intensity: number;
  wakeStrategy: "gentle" | "adaptive" | "aggressive";
  verificationRequired: boolean;
  verificationMethods: string[];
  minConfidence: number;
  linkedTaskId?: string;
  taskTitle?: string;
  rationale: string;
  factors: AlarmFactor[];
  explanation: Explanation;
  confidence: number;
  smartWakeWindowMin: number;
}

interface LifecycleAction {
  alarmId: string;
  label: string;
  action: "pruned" | "decluttered" | "optimized";
  detail: string;
  explanation: Explanation;
}

interface LifecycleSummary {
  pruned: number;
  decluttered: number;
  optimized: number;
  actions: LifecycleAction[];
}

interface ScheduleResponse {
  mode: "assisted" | "autonomous";
  predictionSource: AISource;
  proposals: AlarmPlan[];
  skipped?: SkippedTask[];
  created: unknown[];
  maintenance?: LifecycleSummary;
}

/**
 * Explain an empty result instead of asserting nothing qualified.
 *
 * Every reason here is a task the user deliberately created and then didn't see
 * an alarm for, so the message names the task and what to change.
 */
function explainEmpty(skipped: SkippedTask[]): string {
  if (skipped.length === 0) {
    return "No tasks need a wake alarm in the next week.";
  }
  const undated = skipped.filter((s) => s.reason === "no-due-date");
  if (undated.length > 0) {
    const names = undated.slice(0, 2).map((s) => `"${s.title}"`).join(" and ");
    const more = undated.length > 2 ? ` and ${undated.length - 2} more` : "";
    return `${names}${more} ${undated.length === 1 ? "has" : "have"} no due date, so there's nothing to wake you for. Add a date, or put it in the title - "tomorrow", "monday", "at 9am".`;
  }
  const first = skipped[0];
  const others = skipped.length > 1 ? ` (and ${skipped.length - 1} other task${skipped.length > 2 ? "s" : ""})` : "";
  return `No alarms scheduled - "${first.title}"${others} ${SKIP_EXPLANATIONS[first.reason]}.`;
}

const STRATEGY_STYLES: Record<string, string> = {
  gentle: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
  adaptive: "border-sky-400/40 bg-sky-500/10 text-sky-200",
  aggressive: "border-rose-400/40 bg-rose-500/10 text-rose-200",
};

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

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SmartSchedulePanel({ onChange }: { onChange?: () => void }) {
  const [proposals, setProposals] = useState<AlarmPlan[]>([]);
  const [source, setSource] = useState<AISource | null>(null);
  const [maintenance, setMaintenance] = useState<LifecycleSummary | null>(null);
  const [loading, setLoading] = useState<"preview" | "create" | "tidy" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewed, setPreviewed] = useState(false);

  async function callSchedule(mode: "assisted" | "autonomous") {
    setLoading(mode === "assisted" ? "preview" : "create");
    setMessage(null);
    try {
      const res = await fetch("/api/ai/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, runMaintenance: mode === "autonomous" }),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessage(json.error || "Scheduling failed.");
        return;
      }
      const data = json.data as ScheduleResponse;
      setProposals(data.proposals);
      setSource(data.predictionSource);
      setPreviewed(true);
      if (mode === "autonomous") {
        setMaintenance(data.maintenance ?? null);
        setMessage(
          data.created.length > 0
            ? `Created ${data.created.length} alarm${data.created.length === 1 ? "" : "s"}.`
            : explainEmpty(data.skipped ?? [])
        );
        setProposals([]);
        setPreviewed(false);
        onChange?.();
      } else if (data.proposals.length === 0) {
        setMessage(explainEmpty(data.skipped ?? []));
      }
    } catch {
      setMessage("Could not reach the scheduler.");
    } finally {
      setLoading(null);
    }
  }

  async function runTidy() {
    setLoading("tidy");
    setMessage(null);
    try {
      const res = await fetch("/api/alarms/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessage(json.error || "Maintenance failed.");
        return;
      }
      const data = json.data as LifecycleSummary;
      setMaintenance(data);
      const total = data.pruned + data.decluttered + data.optimized;
      setMessage(
        total === 0
          ? "Alarms are already tidy."
          : `Tidied ${total} alarm${total === 1 ? "" : "s"} (removed ${data.pruned}, disabled ${data.decluttered}, tuned ${data.optimized}).`
      );
      onChange?.();
    } catch {
      setMessage("Could not reach maintenance.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <section className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <BrainCircuit className="h-5 w-5 text-violet-300" /> AI Alarm Scheduler
        </h2>
        {source && (
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-300">
            {source === "ai" ? "AI Brain" : "Rule-based"}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => callSchedule("assisted")}
            disabled={loading !== null}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
          >
            {loading === "preview" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Preview
          </button>
          <button
            type="button"
            onClick={() => callSchedule("autonomous")}
            disabled={loading !== null}
            className="flex items-center gap-1.5 rounded-xl border border-violet-400/40 bg-violet-500/20 px-3 py-2 text-sm text-violet-100 transition hover:bg-violet-500/30 disabled:opacity-50"
          >
            {loading === "create" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            Auto-schedule
          </button>
          <button
            type="button"
            onClick={runTidy}
            disabled={loading !== null}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
          >
            {loading === "tidy" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Tidy up
          </button>
        </div>
      </div>

      <p className="mb-4 text-sm text-slate-400">
        Generates wake alarms from your upcoming tasks, sized by importance and
        oversleep risk. <span className="text-slate-300">Preview</span> to review,{" "}
        <span className="text-slate-300">Auto-schedule</span> to let SomniAI set them.
      </p>

      {message && (
        <div className="mb-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
          {message}
        </div>
      )}

      {previewed && proposals.length > 0 && (
        <ul className="space-y-3">
          {proposals.map((p, i) => (
            <li
              key={p.linkedTaskId ?? `plan-${i}`}
              className="rounded-xl border border-white/10 bg-slate-900/40 p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <AlarmClock className="h-4 w-4 text-indigo-300" />
                <span className="font-medium text-white">{p.label}</span>
                <span className="flex items-center gap-1 text-sm text-slate-300">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {formatTime(p.scheduledTime)}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    STRATEGY_STYLES[p.wakeStrategy] ?? STRATEGY_STYLES.adaptive
                  }`}
                >
                  {p.wakeStrategy}
                </span>
                <span className="ml-auto text-xs text-slate-400">
                  {Math.round(p.confidence * 100)}% confidence
                </span>
              </div>
              <p className="mb-2 text-sm text-slate-300">{p.rationale}</p>
              <AttributionChips attributions={p.explanation?.attributions ?? []} />
            </li>
          ))}
        </ul>
      )}

      {maintenance && maintenance.actions.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-200">
            Lifecycle maintenance
          </h3>
          <ul className="space-y-1.5">
            {maintenance.actions.map((a) => (
              <li
                key={a.alarmId}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300"
              >
                <div>
                  <span className="font-medium text-slate-200">{a.label}</span>{" "}
                  {"\u2014"} {a.detail}
                </div>
                {a.explanation?.attributions?.length ? (
                  <div className="mt-1.5">
                    <AttributionChips attributions={a.explanation.attributions} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}