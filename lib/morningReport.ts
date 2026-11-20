// The morning report (prompt 3.4): after each alarm, which stage woke you, how
// long the wake check took, whether you kept to last night's plan, and your
// streak. Pure: the server gathers the facts (lib/wakeReportServer.ts), this
// turns them into the report, and reportLines words it in the reader's time
// zone so the web page and the phone's notification say the same thing.
//
// The report is also what the escalation profile learns from
// (levelsForProfile): one entry per ring, answered or not. A missed alarm
// counts as needing the whole ladder, because the whole ladder wasn't enough.

import { STAGE_LABELS, type EscalationLevel, type EscalationProfile, type WakeStage } from "./escalation";

export type WakeOutcome = "woke" | "missed";
/** gentle: up at levels 1-2; escalated: 3-4; full: 5; missed: not answered. */
export type ReportKind = "gentle" | "escalated" | "full" | "missed";
export type PlanStatus = "followed" | "not_followed" | "unknown" | "no_plan";

/** One ring as the server recorded it: the stored WakeReport. */
export interface RingRecord {
  alarmId: string;
  label: string;
  /** When this ring was due (snoozedFrom if snoozed, else scheduledTime). */
  ringAt: Date;
  outcome: WakeOutcome;
  /** The level the ring had reached when it ended; null if it never rang. */
  level: number | null;
  /** That level's name in the alarm's own ladder. */
  levelLabel: string | null;
  stage: WakeStage | null;
  /** False for a missed alarm no device rang (the page was closed, say). */
  rang: boolean;
  endedAt: Date | null;
  verification: {
    required: boolean;
    /** null: no check was taken (none required, or the alarm wasn't answered). */
    passed: boolean | null;
    seconds: number | null;
    steps: number | null;
    score: number | null;
    threshold: number | null;
  };
}

/** Last night's plan, if one was set: the bedtime chosen in the wake planner. */
export interface NightPlanFacts {
  bedtime: Date;
  wakeAt: Date;
}

/** Minutes past the planned bedtime that still count as keeping to it. */
export const PLAN_GRACE_MINUTES = 15;

export interface PlanVerdict {
  status: PlanStatus;
  plannedBedtime: string | null;
  /** When you went to bed, from a recorded (not simulated) sleep log. */
  bedtime: string | null;
  /** How late, past the planned bedtime, when not followed. */
  lateMinutes: number | null;
}

export interface MorningReport {
  alarmId: string;
  label: string;
  ringAt: string;
  outcome: WakeOutcome;
  kind: ReportKind;
  level: number | null;
  levelLabel: string | null;
  stage: WakeStage | null;
  rang: boolean;
  endedAt: string | null;
  verification: RingRecord["verification"];
  plan: PlanVerdict;
  streak: { count: number; best: number };
  profile: EscalationProfile;
}

export function reportKind(outcome: WakeOutcome, level: number | null): ReportKind {
  if (outcome === "missed") {
    return "missed";
  }
  const l = level ?? 1;
  return l >= 5 ? "full" : l >= 3 ? "escalated" : "gentle";
}

/** The stage a level belongs to in this alarm's ladder, with its name. */
export function stageFor(level: number, ladder: EscalationLevel[]): { label: string; stage: WakeStage } {
  const rung = ladder.find((l) => l.level === level);
  return rung
    ? { label: rung.label, stage: rung.stage }
    : { label: `Level ${level}`, stage: level >= 4 ? "challenge" : level === 3 ? "vibration" : "ramp" };
}

/**
 * Answered alarms in a row, counting back from the newest (`outcomes` is
 * newest first, this ring included), and the longest such run among them.
 */
export function streakOf(outcomes: WakeOutcome[]): { count: number; best: number } {
  let count = 0;
  while (count < outcomes.length && outcomes[count] === "woke") {
    count++;
  }
  let best = 0;
  let run = 0;
  for (const o of outcomes) {
    run = o === "woke" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { count, best };
}

/**
 * Whether you kept to last night's plan. Without a plan there's nothing to
 * keep to; without a recorded bedtime SomniAI can't tell, and says so rather
 * than guess.
 */
export function planVerdict(plan: NightPlanFacts | null, bedtime: Date | null): PlanVerdict {
  if (!plan) {
    return { status: "no_plan", plannedBedtime: null, bedtime: null, lateMinutes: null };
  }
  const planned = plan.bedtime.toISOString();
  if (!bedtime) {
    return { status: "unknown", plannedBedtime: planned, bedtime: null, lateMinutes: null };
  }
  const late = Math.round((bedtime.getTime() - plan.bedtime.getTime()) / 60_000);
  return late <= PLAN_GRACE_MINUTES
    ? { status: "followed", plannedBedtime: planned, bedtime: bedtime.toISOString(), lateMinutes: null }
    : { status: "not_followed", plannedBedtime: planned, bedtime: bedtime.toISOString(), lateMinutes: late };
}

/**
 * The levels the escalation profile learns from, newest first: the level each
 * answered ring took, and the top of the ladder for a ring nobody answered.
 * A missed alarm that never rang says nothing about how hard you are to wake
 * (a closed page, a dead phone), so it is left out.
 */
export function levelsForProfile(rings: Pick<RingRecord, "outcome" | "level" | "rang">[]): number[] {
  return rings.flatMap((r) => {
    if (r.outcome === "missed") {
      return r.rang ? [5] : [];
    }
    const l = r.level ?? 1;
    return l >= 1 && l <= 5 ? [l] : [];
  });
}

export function buildMorningReport(
  ring: RingRecord,
  plan: PlanVerdict,
  /** Outcomes of this user's rings, newest first, ending with this one or older. */
  outcomes: WakeOutcome[],
  profile: EscalationProfile,
): MorningReport {
  return {
    alarmId: ring.alarmId,
    label: ring.label,
    ringAt: ring.ringAt.toISOString(),
    outcome: ring.outcome,
    kind: reportKind(ring.outcome, ring.level),
    level: ring.level,
    levelLabel: ring.levelLabel,
    stage: ring.stage,
    rang: ring.rang,
    endedAt: ring.endedAt ? ring.endedAt.toISOString() : null,
    verification: ring.verification,
    plan,
    streak: streakOf(outcomes),
    profile,
  };
}

export interface ReportLines {
  title: string;
  stage: string;
  verification: string;
  plan: string;
  streak: string;
  profile: string;
}

/** A 24-hour clock time in `timeZone`; throws RangeError for an unknown zone. */
export function clockIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(at);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function duration(seconds: number): string {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** The report in words, with times in the reader's zone. */
export function reportLines(r: MorningReport, timeZone: string): ReportLines {
  const at = (iso: string) => clockIn(new Date(iso), timeZone);
  const levelName = r.level === null ? "" : `level ${r.level} of 5, ${r.levelLabel ?? `Level ${r.level}`}`;

  let stage: string;
  if (r.kind === "missed") {
    stage = !r.rang
      ? "Missed: it didn't ring on any device that reported back."
      : `Missed: nothing stopped it. It rang until ${r.endedAt ? at(r.endedAt) : "it gave up"} and reached ${levelName}.`;
  }
  else {
    const stageName = r.stage ? STAGE_LABELS[r.stage] : "";
    stage = r.kind === "gentle"
      ? `Gentle wake: you were up at ${levelName}.`
      : r.kind === "full"
        ? `Fully escalated: it took ${levelName}.`
        : `Escalated: you were up at ${levelName} (${stageName.toLowerCase()}).`;
  }

  const v = r.verification;
  const verification = r.outcome === "missed"
    ? "No wake check: the alarm wasn't answered."
    : !v.required
      ? "No wake check on this alarm."
      : v.passed === true
        ? `Wake check passed in ${v.seconds === null ? "an unrecorded time" : duration(v.seconds)}${v.steps && v.steps > 1 ? ` (${plural(v.steps, "answer")})` : ""}.`
        : v.passed === false
          ? `Wake check not passed (score ${v.score ?? "?"}, needed ${v.threshold ?? "?"})${v.seconds === null ? "" : ` after ${duration(v.seconds)}`}.`
          : "The wake check's result never reached the server.";

  const p = r.plan;
  const plan = p.status === "no_plan"
    ? "No plan was set for last night."
    : p.status === "unknown"
      ? `Last night's plan: bed by ${at(p.plannedBedtime!)}. No bedtime was recorded, so SomniAI can't tell whether you kept to it.`
      : p.status === "followed"
        ? `Last night's plan: bed by ${at(p.plannedBedtime!)}. You were in bed at ${at(p.bedtime!)}: plan kept.`
        : `Last night's plan: bed by ${at(p.plannedBedtime!)}. You were in bed at ${at(p.bedtime!)}, ${plural(p.lateMinutes!, "minute")} late.`;

  const streak = r.outcome === "missed"
    ? `Streak reset: this alarm wasn't answered.${r.streak.best > 0 ? ` Your best is ${plural(r.streak.best, "alarm")} in a row.` : ""}`
    : `Streak: ${plural(r.streak.count, "alarm")} answered in a row${r.streak.best > r.streak.count ? ` (best ${r.streak.best})` : ""}.`;

  const pr = r.profile;
  const pace = pr.paceFactor < 1 ? "sooner" : pr.paceFactor > 1 ? "more gently" : "at the usual pace";
  const profile = pr.samples < 3
    ? `Escalation profile: learning, ${pr.samples} of the 3 alarms it needs before it changes your ladder.`
    : `Escalation profile, from ${plural(pr.samples, "alarm")}: you usually wake at level ${pr.typicalLevel}, so your alarms now climb ${pace}.`;

  return { title: `${r.label}, ${at(r.ringAt)}`, stage, verification, plan, streak, profile };
}
