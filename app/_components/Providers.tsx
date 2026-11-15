"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { installErrorReporting } from "@/lib/errorReporter";

export function Providers({ children }: { children: React.ReactNode }) {
  // Error tracking (7.3): errors nothing on the page caught are reported.
  useEffect(() => installErrorReporting(), []);
  return <SessionProvider>{children}</SessionProvider>;
}
