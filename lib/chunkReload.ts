// A part of the page's code that failed to load (prompt 7.4, seen on staging):
// a ChunkLoadError, after a dropped connection on a weak network, or when a
// tab opened before a deploy asks for a file the new deploy doesn't have.
// Reloading fetches the page afresh and nearly always fixes it, so the error
// pages do that once by themselves instead of asking. Never twice within
// RELOAD_GAP_MS: if a reload didn't help, the page says so and offers its button.

export const RELOAD_GAP_MS = 60_000;
const KEY = "somniai.chunkReloadAt";

export function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown } | null;
  return e?.name === "ChunkLoadError" || /Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(String(e?.message ?? ""));
}

/** Whether to reload now, given when the page last reloaded for this. */
export function shouldReload(error: unknown, lastReloadAt: number | null, now: number): boolean {
  return isChunkLoadError(error) && (lastReloadAt === null || now - lastReloadAt > RELOAD_GAP_MS);
}

/** Reloads the page if the error calls for it; returns whether it did. */
export function reloadForChunkError(error: unknown, win: Pick<Window, "sessionStorage" | "location"> = window, now = Date.now()): boolean {
  let last: number | null = null;
  try {
    const raw = win.sessionStorage.getItem(KEY);
    last = raw === null ? null : Number(raw);
  }
  catch {
    return false; // Without storage the guard can't hold: the button, not a loop.
  }
  if (!shouldReload(error, last, now)) {
    return false;
  }
  try {
    win.sessionStorage.setItem(KEY, String(now));
  }
  catch {
    return false;
  }
  win.location.reload();
  return true;
}
