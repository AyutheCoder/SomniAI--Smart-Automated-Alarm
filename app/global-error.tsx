"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/errorReporter";

/** The whole app failed to render, layout included (7.3). Its own <html>, as Next.js requires. */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    reportError(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ background: "#0b1020", color: "#cbd5e1", fontFamily: "system-ui, sans-serif", padding: "4rem 1rem", maxWidth: "28rem", margin: "0 auto" }}>
        <h1 style={{ color: "white", fontSize: "1.125rem" }}>SomniAI ran into a problem</h1>
        <p>It has been reported. Alarms on your phone ring as set: they don&apos;t need this page.</p>
        <p>In a browser, SomniAI&apos;s alarms ring only while its page is working, so try again now.</p>
        <button type="button" onClick={reset} style={{ marginTop: "1rem", padding: "0.5rem 1rem", borderRadius: "0.75rem", background: "#6366f1", color: "white", border: 0 }}>
          Try again
        </button>
      </body>
    </html>
  );
}
