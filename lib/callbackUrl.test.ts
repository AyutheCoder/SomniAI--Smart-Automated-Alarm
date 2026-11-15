import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "./callbackUrl";

const ORIGIN = "https://app.example";

describe("where sign-in goes afterwards", () => {
  it("follows a place on this site, given as a path or as the middleware's full address", () => {
    expect(safeCallbackUrl("/analytics", ORIGIN)).toBe("/analytics");
    expect(safeCallbackUrl("/alarms?id=1#top", ORIGIN)).toBe("/alarms?id=1#top");
    expect(safeCallbackUrl("https://app.example/analytics?x=1", ORIGIN)).toBe("/analytics?x=1");
  });

  it.each([
    ["a script", "javascript:fetch('/api/buddy')"],
    ["a script in another case, with spaces", "  JavaScript:alert(1)"],
    ["a data URL", "data:text/html,<script>alert(1)</script>"],
    ["another site", "https://evil.example/phish"],
    ["another site, protocol-relative", "//evil.example/phish"],
    ["another site, backslashed", "/\\evil.example/phish"],
    ["the same host on another scheme", "http://app.example/analytics"],
    ["the same host on another port", "https://app.example:8443/"],
  ])("goes home instead of to %s", (_what, raw) => {
    expect(safeCallbackUrl(raw, ORIGIN)).toBe("/");
  });

  it("goes home with no callback at all", () => {
    expect(safeCallbackUrl(null, ORIGIN)).toBe("/");
    expect(safeCallbackUrl("", ORIGIN)).toBe("/");
  });
});

describe("what the sign-in page says when Google is refused", () => {
  it("has a message for each refusal the sign-in callback sends back", async () => {
    const { GOOGLE_REFUSED, GOOGLE_REFUSED_PATH } = await import("./googleSignIn");
    for (const path of Object.values(GOOGLE_REFUSED_PATH)) {
      const code = new URL(path, ORIGIN).searchParams.get("error")!;
      expect(GOOGLE_REFUSED[code]).toMatch(/\w/);
    }
  });
});
