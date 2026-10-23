"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, ShieldCheck, Siren, Vibrate, Volume2, X } from "lucide-react";
import type { Alarm } from "@/lib/types";
import {
  startAlarm,
  stopAlarm,
  escalateAlarm,
  vibrate,
  startVibrationLoop,
  stopVibration,
  speak,
  notify,
} from "@/lib/clientAlarm";
import {
  levelForElapsed,
  STAGE_LABELS,
  type EscalationLevel,
} from "@/lib/escalation";
import {
  BACKUP_LABELS,
  describeOutcome,
  dispatchBackups,
  type BackupKind,
  type BackupOutcome,
} from "@/lib/backupAdapters";
import { accumulateWakeEvidence, meetsThreshold } from "@/lib/wakeConfidence";
import { resolveRingPlan } from "@/lib/ringPlan";
import {
  CHALLENGE_COMPONENTS,
  CHALLENGE_LABELS,
  type ChallengeResult,
  type ChallengeType,
} from "./verification";

export interface ResolveResult {
  confidence: number;
  snoozed: boolean;
  verified: boolean;
  responseMs: number;
  methods: ChallengeType[];
  attempts: number;
  motion?: number;
  /** Every challenge in the sequence was solved. */
  solved: boolean;
  /** Fraction of challenges solved, 0..1. */
  correctness: number;
  escalationLevel: number;
  /** What each backup channel really did, if the ladder reached them. */
  backups: BackupOutcome[];
}

interface RingingOverlayProps {
  alarm: Alarm;
  onResolved: (result: ResolveResult) => void;
}

type View = "ringing" | "challenge" | "result" | "done";

/**
 * Rings from the alarm record alone: its ring plan fixes the sound, the whole
 * escalation ladder and the challenge, so nothing here calls the server. An
 * alarm stored before plans existed gets one built on the device.
 */
export default function RingingOverlay({ alarm, onResolved }: RingingOverlayProps) {
  const ringPlan = useMemo(() => resolveRingPlan(alarm), [alarm]);
  const plan = ringPlan.escalation;
  const methods = ringPlan.challenge.methods;
  const verifyRequired = ringPlan.challenge.required;
  const minConfidence = ringPlan.challenge.minConfidence;
  const { intensity, strategy } = ringPlan.sound;

  const [view, setView] = useState<View>("ringing");
  const [level, setLevel] = useState<EscalationLevel>(plan[0]);
  const [methodIndex, setMethodIndex] = useState(0);
  // Channels being tried, then what each one actually did.
  const [backupsTrying, setBackupsTrying] = useState<BackupKind[]>([]);
  const [backups, setBackups] = useState<BackupOutcome[]>([]);
  const backupsRef = useRef<BackupOutcome[]>([]);
  const [results, setResults] = useState<ChallengeResult[]>([]);
  const [confidence, setConfidence] = useState(0);
  const [retryNote, setRetryNote] = useState("");
  const startedAt = useMemo(() => Date.now(), []);
  const levelRef = useRef(1);
  const lastSpokeRef = useRef(0);
  const backupsFiredRef = useRef(false);

  // The page keys this overlay by alarm id, so these primitives are fixed for
  // the life of one ring and the sound starts exactly once.
  useEffect(() => {
    startAlarm({ intensity, strategy });
    vibrate(strategy);
    speak(`Time to wake up. ${alarm.label}`);
    notify("⏰ SomniAI alarm", alarm.label);
    return () => {
      stopAlarm();
      stopVibration();
    };
  }, [intensity, strategy, alarm.label]);

  // Not awaited by anything that rings: the alarm keeps going while channels
  // are tried, and the panel shows each one's real outcome as it arrives.
  const fireBackups = useCallback((kinds: EscalationLevel["backup"]) => {
    if (backupsFiredRef.current || !kinds.length) return;
    backupsFiredRef.current = true;
    setBackupsTrying(kinds);
    void dispatchBackups(kinds, {
      alarmLabel: alarm.label,
      text: `SomniAI: "${alarm.label}" has been ringing and has not been answered.`,
    }).then((outcomes) => {
      backupsRef.current = outcomes;
      setBackups(outcomes);
      setBackupsTrying([]);
    });
  }, [alarm.label]);

  // Elapsed time is measured from startedAt and the current level lives in a
  // ref, so restarting the timer when the plan changes (a profile arriving
  // mid-ring) loses nothing and never re-fires a level already reached.
  useEffect(() => {
    const timer = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      const next = levelForElapsed(secs, plan);
      if (next.level !== levelRef.current) {
        levelRef.current = next.level;
        setLevel(next);
        escalateAlarm(next.volumeFactor);
        if (next.vibrate) {
          startVibrationLoop(strategy);
        }
        if (next.backup.length > 0) {
          fireBackups(next.backup);
        }
        if (next.requireVerification && verifyRequired) {
          speak("Complete the challenge to turn off the alarm.");
          lastSpokeRef.current = secs;
          setView((v) => (v === "ringing" ? "challenge" : v));
        }
        else {
          speak(`${next.label}. Please wake up.`);
          lastSpokeRef.current = secs;
        }
      }
      if (secs - lastSpokeRef.current >= 15 && secs > 0) {
        speak(`Wake up. ${alarm.label}`);
        lastSpokeRef.current = secs;
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [startedAt, plan, verifyRequired, alarm.label, strategy, fireBackups]);

  const finish = useCallback((result: {
    snoozed: boolean;
    verified: boolean;
    confidence: number;
    collected: ChallengeResult[];
  }) => {
    stopAlarm();
    stopVibration();
    const elapsed = Date.now() - startedAt;
    const totalAttempts = result.collected.reduce((s, r) => s + r.attempts, 0);
    const motion = result.collected.find((r) => r.motion !== undefined)?.motion;
    const solvedCount = result.collected.filter((r) => r.passed).length;
    setView("done");
    onResolved({
      confidence: result.confidence,
      snoozed: result.snoozed,
      verified: result.verified,
      responseMs: elapsed,
      methods,
      attempts: totalAttempts,
      motion,
      // Raw outcome travels with the score so the server can re-derive
      // confidence itself instead of taking the client's word for it.
      solved: result.collected.length > 0 && solvedCount === result.collected.length,
      correctness: result.collected.length ? solvedCount / result.collected.length : 0,
      escalationLevel: levelRef.current,
      backups: backupsRef.current,
    });
  }, [methods, onResolved, startedAt]);

  function beginChallenge() {
    setRetryNote("");
    setResults([]);
    setMethodIndex(0);
    setView("challenge");
  }

  const evaluate = useCallback((collected: ChallengeResult[]) => {
    const passedAll = collected.every((r) => r.passed);
    // Evidence accumulates across the whole challenge sequence, so two
    // confirmations read as stronger than one and an early failure still counts.
    const { score } = accumulateWakeEvidence(collected.map((r) => ({
      solved: r.passed,
      responseMs: r.responseMs,
      attempts: r.attempts,
      motion: r.motion,
      interactions: r.interactions,
    })));
    setConfidence(score);
    if (passedAll && meetsThreshold(score, minConfidence)) {
      setView("result");
      speak("Verified. Good morning.");
      setTimeout(() => finish({
        snoozed: false,
        verified: true,
        confidence: score,
        collected,
      }), 1600);
    }
    else {
      const top = plan[plan.length - 1];
      levelRef.current = top.level;
      setLevel(top);
      escalateAlarm(top.volumeFactor);
      startVibrationLoop(strategy);
      fireBackups(top.backup);
      setRetryNote(`Confidence ${score}% is below the ${minConfidence}% needed - let's try again.`);
      speak("That wasn't convincing enough. Try again.");
      setResults([]);
      setMethodIndex(0);
      setView("challenge");
    }
  }, [minConfidence, plan, strategy, finish, fireBackups]);

  function handleChallengeComplete(result: ChallengeResult) {
    const collected = [...results, result];
    setResults(collected);
    if (methodIndex + 1 < methods.length) {
      setMethodIndex((i) => i + 1);
    }
    else {
      evaluate(collected);
    }
  }

  function snooze() {
    finish({ snoozed: true, verified: false, confidence: 0, collected: results });
  }

  const ActiveChallenge = CHALLENGE_COMPONENTS[methods[methodIndex]] ?? CHALLENGE_COMPONENTS["math"];
  return (
    <div data-ringing="" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-indigo-500/30 bg-slate-900/80 p-8 text-center shadow-2xl">

        <div className="mb-2 flex items-center gap-1.5">
          {plan.map((l) => (
            <div key={l.level} className={`h-1.5 flex-1 rounded-full transition-colors ${l.level <= level.level
              ? level.level >= 5
                ? "bg-rose-500"
                : "bg-indigo-400"
              : "bg-slate-700"}`} />
          ))}
        </div>
        <p className="mb-6 text-xs font-medium uppercase tracking-wide text-slate-400">
          Level {level.level}/5 · {level.label}
        </p>

        {view === "ringing" && (
          <>
            <div className="mx-auto mb-6 flex h-24 w-24 animate-pulse-ring items-center justify-center rounded-full bg-indigo-500/20">
              {level.stage === "ramp" ? (<AlarmClock className="h-12 w-12 text-indigo-300" />) : (<Vibrate className="h-12 w-12 text-rose-300" />)}
            </div>
            <h2 className="text-2xl font-bold text-white">{alarm.label}</h2>
            <p className="mt-2 flex items-center justify-center gap-2 text-sm text-slate-400">
              <Volume2 className="h-4 w-4" />
              <span className="capitalize">{strategy}</span> · Intensity {intensity}%
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-indigo-300">
              {STAGE_LABELS[level.stage]}s
            </p>
            <div className="mt-8 flex flex-col gap-3">
              <button onClick={beginChallenge} className="rounded-xl bg-indigo-500 px-6 py-3 font-semibold text-white transition hover:bg-indigo-400">
                {verifyRequired ? "I'm awake — verify" : "Dismiss"}
              </button>
              <button onClick={snooze} className="rounded-xl border border-slate-600 px-6 py-3 text-slate-300 transition hover:bg-slate-800">
                Snooze (5 min)
              </button>
            </div>
          </>
        )}

        {view === "challenge" && (
          <>
            {!verifyRequired ? (
              <DismissNow onDismiss={() => finish({
                snoozed: false,
                verified: true,
                confidence: 100,
                collected: [],
              })} />
            ) : (
              <>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Challenge {methodIndex + 1} of {methods.length} · {CHALLENGE_LABELS[methods[methodIndex]]}
                </p>
                {retryNote && (
                  <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                    {retryNote}
                  </p>
                )}
                <ActiveChallenge key={`${methodIndex}-${results.length}`} onComplete={handleChallengeComplete} />
                <button type="button" onClick={snooze} className="mt-5 text-sm text-slate-500 transition hover:text-slate-300">
                  Snooze instead (5 min)
                </button>
              </>
            )}
          </>
        )}

        {view === "result" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20">
              <ShieldCheck className="h-10 w-10 text-emerald-300" />
            </div>
            <p className="text-2xl font-bold text-white">{confidence}%</p>
            <p className="text-sm text-slate-400">Wake Confidence Score</p>
            <p className="text-emerald-300">You&apos;re awake — good morning!</p>
          </div>
        )}

        {view === "done" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <X className="h-10 w-10 text-emerald-400" />
            <p className="text-white">Alarm resolved.</p>
          </div>
        )}

        {(backupsTrying.length > 0 || backups.length > 0) && view !== "done" && view !== "result" && (
          <section aria-label="Backup channels" className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-left">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-300">
              <Siren className="h-4 w-4" /> Backup channels
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {backups.length === 0
                ? backupsTrying.map((kind) => (
                  <li key={kind} className="text-rose-200/80">{BACKUP_LABELS[kind]}: trying…</li>
                ))
                : backups.map((b) => (
                  <li
                    key={b.kind}
                    data-status={b.status}
                    title={b.status === "delivered" ? undefined : b.reason}
                    className={b.status === "delivered" ? "text-emerald-300" : "text-slate-400"}
                  >
                    {b.label}: {describeOutcome(b)}
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function DismissNow({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="py-4">
      <p className="text-white">No verification required for this alarm.</p>
      <button onClick={onDismiss} className="mt-5 rounded-xl bg-indigo-500 px-6 py-3 font-semibold text-white transition hover:bg-indigo-400">
        Dismiss alarm
      </button>
    </div>
  );
}