"use client";

import { useMemo, useState } from "react";
import { BrainCircuit } from "lucide-react";
import { isAnswer, makeProblem, SUMS } from "@/lib/mathChallenge";
import type { ChallengeProps } from "./types";

export default function MathChallenge({ onComplete }: ChallengeProps) {
  const startedAt = useMemo(() => Date.now(), []);
  const [problem, setProblem] = useState(() => makeProblem());
  const [solved, setSolved] = useState(0);
  const [input, setInput] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [note, setNote] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isAnswer(input, problem)) {
      if (solved + 1 >= SUMS) {
        onComplete({
          type: "math",
          passed: true,
          attempts,
          responseMs: Date.now() - startedAt,
          // Every answer given, right or wrong.
          interactions: attempts + SUMS,
          steps: SUMS,
        });
        return;
      }
      setSolved(solved + 1);
      setNote("Right. Next one.");
    } else {
      setAttempts((a) => a + 1);
      setNote("Incorrect — here's a new one.");
    }
    setProblem(makeProblem());
    setInput("");
  }

  return (
    <div>
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-sky-500/20">
        <BrainCircuit className="h-8 w-8 text-sky-300" />
      </div>
      <h3 className="text-lg font-semibold text-white">Solve to continue</h3>
      <p className="mt-1 text-sm text-slate-400">Sum {solved + 1} of {SUMS}</p>
      <p className="mt-4 text-3xl font-bold tracking-wider text-white">
        {problem.question} = ?
      </p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
        <input
          autoFocus
          inputMode="numeric"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-center text-2xl text-white outline-none focus:border-sky-400"
          placeholder="Answer"
        />
        {note && <p className={`text-sm ${note.startsWith("Right") ? "text-emerald-400" : "text-rose-400"}`}>{note}</p>}
        <button
          type="submit"
          className="rounded-xl bg-sky-500 px-6 py-3 font-semibold text-white transition hover:bg-sky-400"
        >
          Check answer
        </button>
      </form>
    </div>
  );
}
