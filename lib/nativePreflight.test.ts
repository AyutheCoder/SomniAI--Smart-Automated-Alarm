import { describe, expect, it, vi } from "vitest";
import { hasPreflight, preflightLine, shareBedtime } from "./nativePreflight";
import { NativeSync } from "./nativeSync";

const sync = new NativeSync({ reconcile: async () => { throw new Error("unused"); } });

describe("the bedtime check from the page", () => {
  it("is offered only by an app with plugin API 3", () => {
    expect(hasPreflight(null)).toBe(false);
    expect(hasPreflight({ reason: "browser" })).toBe(false);
    expect(hasPreflight({ sync, api: 2 })).toBe(false);
    expect(hasPreflight({ sync, api: 3 })).toBe(true);
    expect(hasPreflight({ sync, api: 4 })).toBe(true);
  });

  it("passes the planned bedtime to the phone, and clears it", async () => {
    const setBedtime = vi.fn(async ({ at }: { at: string | null }) => ({ bedtime: at }));
    expect(await shareBedtime("2026-10-28T16:45:00.000Z", { setBedtime }, () => true)).toBe("shared");
    expect(await shareBedtime(null, { setBedtime }, () => true)).toBe("shared");
    expect(setBedtime.mock.calls.map((c) => c[0])).toEqual([{ at: "2026-10-28T16:45:00.000Z" }, { at: null }]);
  });

  it("does nothing in a browser, and says so for an app without the check", async () => {
    const setBedtime = vi.fn(async () => { throw new Error("not implemented"); });
    expect(await shareBedtime("2026-10-28T16:45:00.000Z", { setBedtime }, () => false)).toBe("not_native");
    expect(setBedtime).not.toHaveBeenCalled();
    expect(await shareBedtime("2026-10-28T16:45:00.000Z", { setBedtime }, () => true)).toBe("unsupported");
  });

  it("words the summary", () => {
    expect(preflightLine(0)).toBe("Tonight's alarm check: all clear.");
    expect(preflightLine(1)).toBe("Tonight's alarm check: 1 setting could stop your alarm.");
    expect(preflightLine(3)).toBe("Tonight's alarm check: 3 settings could stop your alarm.");
  });
});
