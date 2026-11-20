// The Android shell's configuration: which server it loads, and the rules
// that keep a release build on HTTPS. Read fresh per test, because the config
// reads its environment when imported.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapacitorConfig } from "@capacitor/cli";

async function load(env: Record<string, string | undefined>): Promise<CapacitorConfig> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    vi.stubEnv(k, v as string);
  }
  return (await import("../capacitor.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("capacitor.config.ts", () => {
  it("by default loads the dev server on this machine, as the emulator reaches it", async () => {
    const config = await load({ CAP_SERVER_URL: undefined, CAP_RELEASE: undefined });
    expect(config.appId).toBe("app.somniai.alarm");
    expect(config.server).toMatchObject({
      url: "http://10.0.2.2:3000",
      cleartext: true,
      allowNavigation: ["10.0.2.2:3000"],
      errorPath: "offline.html",
    });
  });

  it("turns plain HTTP off for an https server, and navigates only within it", async () => {
    const config = await load({ CAP_SERVER_URL: "https://somniai.example", CAP_RELEASE: "1" });
    expect(config.server).toMatchObject({ url: "https://somniai.example", cleartext: false, allowNavigation: ["somniai.example"] });
  });

  it("refuses a release build pointed at plain HTTP", async () => {
    await expect(load({ CAP_SERVER_URL: "http://192.168.1.20:3000", CAP_RELEASE: "1" }))
      .rejects.toThrow(/CAP_RELEASE=1 needs an https:\/\/ CAP_SERVER_URL/);
  });
});
