import { describe, expect, it } from "vitest";
import { open, seal } from "./secretBox";

const SECRET = "test-server-secret";

describe("stored secrets", () => {
  it("open with the same server secret and purpose, and never show the plain text", () => {
    const sealed = seal("1//refresh-token", "calendar", SECRET);
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain("refresh-token");
    expect(open(sealed, "calendar", SECRET)).toBe("1//refresh-token");
    expect(seal("1//refresh-token", "calendar", SECRET)).not.toBe(sealed);
  });

  it("don't open with another secret or purpose, or once altered", () => {
    const sealed = seal("1//refresh-token", "calendar", SECRET);
    expect(open(sealed, "calendar", "another-secret")).toBeNull();
    expect(open(sealed, "other-purpose", SECRET)).toBeNull();
    const altered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect(open(altered, "calendar", SECRET)).toBeNull();
    expect(open("not sealed", "calendar", SECRET)).toBeNull();
  });

  it("refuse to store anything without a server secret", () => {
    expect(() => seal("x", "calendar", "")).toThrow("NEXTAUTH_SECRET is not set");
  });
});
