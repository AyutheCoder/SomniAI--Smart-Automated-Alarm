"use client";

import { useMemo, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import type { ChallengeProps } from "./types";

const PHRASES = [
  "the early bird catches the worm",
  "rise and shine it is morning",
  "a new day full of possibility",
  "wake up and seize the day",
  "good mornings make good days",
];

export default function TypingChallenge({ onComplete }: ChallengeProps) {
  const startedAt = useMemo(() => Date.now(), []);
  const phrase = useMemo(() => PHRASES[Math.floor(Math.random() * PHRASES.length)], []);
  const [input, setInput] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState("");
  const keystrokes = useRef(0);

  const normalised = input.trim().replace(/\s+/g, " ").toLowerCase();
  const matches = normalised === phrase;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (matches) {
      onComplete({
        type: "typing",
        passed: true,
        attempts,
        responseMs: Date.now() - startedAt,
        interactions: keystrokes.current,
      });
    } else {
      setAttempts((a) => a + 1);
      setError("Doesn't match yet — type it exactly.");
    }
  }

  return (
    <div>
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/20">
        <Keyboard className="h-8 w-8 text-violet-300" />
      </div>
      <h3 className="text-lg font-semibold text-white">Type the phrase</h3>
      <p className="mt-4 select-none rounded-xl border border-white/10 bg-slate-800/60 px-4 py-3 text-lg font-medium text-violet-200">
        {phrase}
      </p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
        <input
          autoFocus
          value={input}
          onChange={(e) => {
            keystrokes.current += 1;
            setInput(e.target.value);
            setError("");
          }}
          className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-center text-lg text-white outline-none focus:border-violet-400"
          placeholder="Type here…"
        />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={!matches}
          className="rounded-xl bg-violet-500 px-6 py-3 font-semibold text-white transition hover:bg-violet-400 disabled:opacity-50"
        >
          Confirm
        </button>
      </form>
    </div>
  );
}