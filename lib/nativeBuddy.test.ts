import { describe, expect, it, vi } from "vitest";
import { hasPush, registerPush } from "./nativeBuddy";
import { NativeSync } from "./nativeSync";

const TOKEN = "fcm-token-" + "x".repeat(40);
const sync = new NativeSync({ reconcile: async () => { throw new Error("unused"); } });

describe("this phone's push token for buddy alerts", () => {
  it("is asked for only from an app with plugin API 4", () => {
    expect(hasPush(null)).toBe(false);
    expect(hasPush({ reason: "browser" })).toBe(false);
    expect(hasPush({ sync, api: 3 })).toBe(false);
    expect(hasPush({ sync, api: 4 })).toBe(true);
  });

  it("is sent to the server", async () => {
    const post = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await registerPush({ pushToken: async () => ({ available: true, token: TOKEN }) }, post)).toEqual({ state: "registered" });
    expect(post).toHaveBeenCalledWith("/api/push/token", { token: TOKEN });
  });

  it("says why when the phone has none, and sends nothing", async () => {
    const post = vi.fn(async () => ({ ok: true, status: 200 }));
    const reason = "Push isn't set up in this build of the app (no Firebase configuration).";
    expect(await registerPush({ pushToken: async () => ({ available: false, reason }) }, post)).toEqual({ state: "unavailable", reason });
    expect(await registerPush({ pushToken: async () => { throw new Error("not implemented"); } }, post))
      .toEqual({ state: "unavailable", reason: "not implemented" });
    expect(post).not.toHaveBeenCalled();
  });

  it("reports a server that refused it or couldn't be reached", async () => {
    const plugin = { pushToken: async () => ({ available: true, token: TOKEN }) };
    expect(await registerPush(plugin, async () => ({ ok: false, status: 401 }))).toEqual({ state: "failed", reason: "The server said 401." });
    expect((await registerPush(plugin, async () => { throw new Error("offline"); })).state).toBe("failed");
  });
});
