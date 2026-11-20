import { describe, expect, it, vi } from "vitest";
import { isChunkLoadError, reloadForChunkError, RELOAD_GAP_MS, shouldReload } from "./chunkReload";

const chunkError = Object.assign(new Error("Loading chunk 8974 failed. (error: https://x/_next/static/chunks/app/page.js)"), { name: "ChunkLoadError" });

function fakeWindow(stored: string | null = null) {
  const data = new Map<string, string>(stored === null ? [] : [["somniai.chunkReloadAt", stored]]);
  return {
    sessionStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as unknown as Storage,
    location: { reload: vi.fn() } as unknown as Location,
  };
}

describe("a part of the page that failed to load", () => {
  it("is told apart from other errors", () => {
    expect(isChunkLoadError(chunkError)).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'granted')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it("reloads the page once, and not again within a minute (no loop if reloading doesn't help)", () => {
    const win = fakeWindow();
    expect(reloadForChunkError(chunkError, win, 1_000_000)).toBe(true);
    expect(win.location.reload).toHaveBeenCalledOnce();
    expect(reloadForChunkError(chunkError, win, 1_000_000 + 5_000)).toBe(false);
    expect(shouldReload(chunkError, 1_000_000, 1_000_000 + RELOAD_GAP_MS + 1)).toBe(true);
  });

  it("leaves every other error to the page's own message and button", () => {
    const win = fakeWindow();
    expect(reloadForChunkError(new TypeError("x is undefined"), win)).toBe(false);
    expect(win.location.reload).not.toHaveBeenCalled();
  });
});
