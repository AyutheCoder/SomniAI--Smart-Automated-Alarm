"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/errorReporter";

/** A page that failed to render (7.3): said plainly, reported, and one press from trying again. */
export default function PageError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    reportError(error);
  }, [error]);
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-sm text-slate-300">
      <h1 className="mb-3 text-lg font-semibold text-white">This page ran into a problem</h1>
      <p className="mb-2">It has been reported. Alarms on your phone ring as set: they don&apos;t need this page.</p>
      <p className="mb-6">In a browser, SomniAI&apos;s alarms ring only while its page is working, so try again now.</p>
      <button type="button" onClick={reset} className="rounded-xl bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400">
        Try again
      </button>
    </main>
  );
}
