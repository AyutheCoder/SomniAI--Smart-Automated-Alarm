import { describe, expect, it, vi } from "vitest";
import { cancelNightPlan, saveNightPlan } from "./nightPlan";

describe("tonight's plan, sent to the account", () => {
  it("sends the bedtime and the wake it's for, and says whether it was kept", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    expect(await saveNightPlan({ at: "2026-11-13T17:00:00.000Z", wakeAt: "2026-11-14T01:30:00.000Z" }, send)).toBe("saved");
    expect(send).toHaveBeenCalledWith("/api/night-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bedtime: "2026-11-13T17:00:00.000Z", wakeAt: "2026-11-14T01:30:00.000Z" }),
    });
    expect(await saveNightPlan({ at: "x", wakeAt: "y" }, vi.fn(async () => ({ ok: false })))).toBe("failed");
    expect(await saveNightPlan({ at: "x", wakeAt: "y" }, vi.fn(async () => { throw new Error("offline"); }))).toBe("failed");
  });

  it("cancels it", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    expect(await cancelNightPlan(send)).toBe("saved");
    expect(send).toHaveBeenCalledWith("/api/night-plans", { method: "DELETE" });
    expect(await cancelNightPlan(vi.fn(async () => { throw new Error("offline"); }))).toBe("failed");
  });
});
