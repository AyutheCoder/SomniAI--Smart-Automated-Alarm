// The page's side of error tracking (prompt 7.3): errors nothing caught, and
// those the error boundaries caught, are sent to POST /api/errors. Each
// distinct error once per page load and at most MAX_PER_PAGE in all, so a
// loop that throws doesn't flood the server. Sending never throws and never
// waits: a report that can't be sent (offline, signed out) is dropped.

export const MAX_PER_PAGE = 10;

export interface BrowserReport {
  kind: string;
  message: string;
  stack?: string;
  where?: string;
}

type Send = (r: BrowserReport) => void;

const defaultSend: Send = (r) => {
  try {
    void fetch("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(r),
      keepalive: true,
    }).catch(() => {});
  }
  catch {
    // fetch itself missing or refusing: nothing to do.
  }
};

export function browserReport(err: unknown, where?: string): BrowserReport {
  if (err instanceof Error) {
    return { kind: err.name || "Error", message: err.message, stack: err.stack, where };
  }
  return { kind: typeof err, message: typeof err === "string" ? err : String(err), where };
}

export class ErrorReporter {
  private seen = new Set<string>();
  private sent = 0;

  constructor(private send: Send = defaultSend) {}

  /** Returns whether it was sent (false: a repeat, or the page's allowance is used up). */
  report(err: unknown, where?: string): boolean {
    const r = browserReport(err, where);
    const key = `${r.kind}|${r.message}|${r.where ?? ""}`;
    if (this.seen.has(key) || this.sent >= MAX_PER_PAGE) {
      return false;
    }
    this.seen.add(key);
    this.sent++;
    this.send(r);
    return true;
  }
}

let shared: ErrorReporter | null = null;
const page = () => (typeof window === "undefined" ? undefined : window.location.pathname);

/** For the error boundaries: report what they caught. */
export function reportError(err: unknown): void {
  (shared ??= new ErrorReporter()).report(err, page());
}

/** Listens for errors nothing caught. Returns a function that stops listening. */
export function installErrorReporting(win: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const onError = (e: ErrorEvent) => reportError(e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => reportError(e.reason);
  win.addEventListener("error", onError as EventListener);
  win.addEventListener("unhandledrejection", onRejection as EventListener);
  return () => {
    win.removeEventListener("error", onError as EventListener);
    win.removeEventListener("unhandledrejection", onRejection as EventListener);
  };
}
