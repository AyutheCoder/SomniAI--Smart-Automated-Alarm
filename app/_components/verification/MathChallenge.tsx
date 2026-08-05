"use client";

import { useMemo, useState } from "react";
import { BrainCircuit } from "lucide-react";
import type { ChallengeProps } from "./types";

function makeProblem() {
  const a = Math.floor(Math.random() * 8) + 6;
  const b = Math.floor(Math.random() * 8) + 6;
  return { question: `${a} × ${b}`, answer: a * b };
}

export default function MathChallenge({ onComplete }: ChallengeProps) {
  const startedAt = useMemo(() => Date.now(), []);
  const [problem, setProblem] = useState(makeProblem);
  const [input, setInput] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (Number(input) === problem.answer) {
      onComplete({
        type: "math",
        passed: true,
        attempts,
        responseMs: Date.now() - startedAt,
        interactions: attempts + 1,
      });
    } else {
      setAttempts((a) => a + 1);
      setError("Incorrect — try again.");
      setProblem(makeProblem());
      setInput("");
    }
  }

  return (
    <div>
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-sky-500/20">
        <BrainCircuit className="h-8 w-8 text-sky-300" />
      </div>
      <h3 className="text-lg font-semibold text-white">Solve to continue</h3>
      <p className="mt-4 text-4xl font-bold tracking-wider text-white">
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
        {error && <p className="text-sm text-rose-400">{error}</p>}
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