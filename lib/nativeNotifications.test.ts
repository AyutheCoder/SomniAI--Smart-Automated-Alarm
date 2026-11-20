import { describe, expect, it, vi } from "vitest";
import { allowNotifications, ensureNotifications, NOTIFICATIONS_OFF } from "./nativeNotifications";

function plugin(enabled: boolean, afterAsking = enabled) {
  return {
    notificationStatus: vi.fn(async () => ({ enabled })),
    requestNotifications: vi.fn(async () => ({ enabled: afterAsking })),
    openPreflight: vi.fn(async () => undefined),
  };
}

describe("notifications for the phone's alarms (found on the POCO, 7.5)", () => {
  it("asks Android when they're off on a fresh install, and reports what it allowed", async () => {
    const p = plugin(false, true);
    expect(await ensureNotifications(p, true)).toBe("on");
    expect(p.requestNotifications).toHaveBeenCalledOnce();
  });

  it("doesn't ask when they're already on, or when it mayn't", async () => {
    const on = plugin(true);
    expect(await ensureNotifications(on, true)).toBe("on");
    expect(on.requestNotifications).not.toHaveBeenCalled();
    const off = plugin(false);
    expect(await ensureNotifications(off, false)).toBe("off");
    expect(off.requestNotifications).not.toHaveBeenCalled();
  });

  it("says unknown rather than warn when the app can't tell", async () => {
    const p = { ...plugin(false), notificationStatus: vi.fn(async () => { throw new Error("not implemented"); }) };
    expect(await ensureNotifications(p, true)).toBe("unknown");
  });

  it("sends a refusal to Settings through the bedtime check's screen", async () => {
    const refused = plugin(false, false);
    expect(await allowNotifications(refused)).toBe("off");
    expect(refused.openPreflight).toHaveBeenCalledOnce();
    const allowed = plugin(false, true);
    expect(await allowNotifications(allowed)).toBe("on");
    expect(allowed.openPreflight).not.toHaveBeenCalled();
  });

  it("explains what's at stake in the warning", () => {
    expect(NOTIFICATIONS_OFF).toMatch(/ring without showing its screen/);
    expect(NOTIFICATIONS_OFF).toMatch(/no way to stop it/);
  });
});
