// The legal texts (7.2): rendered safely, filled from the deployment, and
// saying what the code does. Numbers in the policy are checked against the
// constants that make them true, so changing one without the other fails here.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HOLDINGS } from "./accountData";
import { RATE, INVITE_TTL_MS } from "./buddy";
import { WINDOW_DAYS } from "./googleCalendar";
import { fill, PLACEHOLDERS, readLegal, type LegalDoc } from "./legal";
import { Markdown, safeHref, slug } from "./markdown";
import { POLICIES } from "./rateLimit";
import { coarse } from "./context/weather";

const DOCS: LegalDoc[] = ["PRIVACY", "TERMS", "DELETE_ACCOUNT"];
const html = (md: string) => renderToStaticMarkup(<Markdown source={md} />);
const java = (file: string) => readFileSync(`android/app/src/main/java/app/somniai/alarm/alarms/${file}`, "utf8");

describe("the Markdown renderer", () => {
  it("renders headings with anchors, paragraphs, lists, emphasis, code and links", () => {
    const out = html("# Title\n\n## Your account\n\nSome **bold** and *soft* `code`, [a link](/privacy).\nSame paragraph.\n\n- one\n- two\n  continued");
    expect(out).toContain('<h1 id="title"');
    expect(out).toContain('<h2 id="your-account"');
    expect(out).toMatch(/<strong[^>]*>bold<\/strong>/);
    expect(out).toContain("<em>soft</em>");
    expect(out).toMatch(/<code[^>]*>code<\/code>/);
    expect(out).toMatch(/<a href="\/privacy"[^>]*>a link<\/a>/);
    expect(out).toContain("Same paragraph.");
    expect(out).toMatch(/<li>one<\/li><li>two continued<\/li>/);
  });

  it("never lets a document inject markup or a script link", () => {
    const out = html("<script>alert(1)</script> [click](javascript:alert(1)) [x](//evil.example) <img src=x onerror=alert(1)>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain('href="//evil.example"');
    expect(safeHref("https://developers.google.com/terms")).not.toBeNull();
    expect(safeHref("mailto:someone@example.org")).not.toBeNull();
    expect(safeHref("/\\evil.example")).toBeNull();
    expect(slug("Who else receives data")).toBe("who-else-receives-data");
  });
});

describe("filling in the deployment's facts", () => {
  it("puts in what is set and marks what isn't, by name", () => {
    const out = fill("Run by {{OPERATOR}}; write to {{CONTACT}}. {{OPERATOR}} again.", { SOMNIAI_OPERATOR: "Example Ltd" });
    expect(out.markdown).toBe("Run by Example Ltd; write to [not set: SOMNIAI_CONTACT]. Example Ltd again.");
    expect(out.missing).toEqual(["SOMNIAI_CONTACT"]);
    expect(() => fill("{{SOMETHING_ELSE}}", {})).toThrow(/unknown placeholder/);
  });

  it("every document uses only known placeholders, and is complete when all are set", () => {
    const all = Object.fromEntries(Object.values(PLACEHOLDERS).map((v) => [v, `value of ${v}`]));
    for (const doc of DOCS) {
      const out = fill(readLegal(doc), all);
      expect(out.missing, doc).toEqual([]);
      expect(out.markdown, doc).not.toMatch(/\{\{|\[not set:/);
    }
  });
});

describe("the privacy policy", () => {
  const policy = readLegal("PRIVACY");
  const headings = [...policy.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1]);

  it("has a section for every kind of stored record (lib/accountData.ts), and for each topic it must cover", () => {
    for (const h of HOLDINGS) {
      expect(headings, `${h.name} -> "${h.policy}"`).toContain(h.policy);
    }
    for (const topic of ["Sleep", "Google Calendar", "Health Connect", "Screen time before bed", "Alarm telemetry", "Wake buddy"]) {
      expect(headings).toContain(topic);
    }
  });

  it("names every outside service the code sends data to", () => {
    for (const [name, code] of [["Open-Meteo", "lib/context/weather.ts"], ["Twilio", "lib/sms.ts"], ["Firebase Cloud Messaging", "lib/push.ts"]] as const) {
      expect(policy).toContain(name);
      expect(readFileSync(code, "utf8").length).toBeGreaterThan(0);
    }
    expect(readFileSync("lib/context/weather.ts", "utf8")).toContain("api.open-meteo.com");
    expect(readFileSync("lib/sms.ts", "utf8")).toContain("api.twilio.com");
    expect(readFileSync("lib/push.ts", "utf8")).toContain("fcm.googleapis.com");
    expect(policy).toContain("calendar.events.readonly");
    expect(readFileSync("lib/googleCalendar.ts", "utf8")).toContain("calendar.events.readonly");
    expect(policy).toContain("Limited Use");
  });

  it("states the numbers the code uses", () => {
    expect(policy).toContain(`last ${Number(java("HealthConnect.java").match(/static final int DAYS = (\d+);/)![1])} days`);
    expect(Number(java("ScreenNights.java").match(/WINDOW_MINUTES = (\d+);/)![1])).toBe(180);
    expect(policy).toContain("three hours before bed");
    expect(policy).toContain(`next ${WINDOW_DAYS} days`);
    expect(policy).toContain(`At most ${RATE.maxPerDay} a day, never two within ${RATE.minGapMinutes} minutes`);
    expect(INVITE_TTL_MS).toBe(24 * 3_600_000);
    expect(policy).toContain("an invite code after a day");
    // Counts are kept for their window and one more: at most twice the longest window.
    const longest = Math.max(...Object.values(POLICIES).map((p) => p.windowMs));
    expect(2 * longest).toBeLessThanOrEqual(2 * 3_600_000);
    expect(policy).toContain("after at most two hours");
    expect(coarse(0.149)).toBe(0.1);
    expect(policy).toContain("about 11 km");
    // Health Connect: the two read permissions the manifest asks for, and nothing to write.
    const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
    expect([...manifest.matchAll(/android\.permission\.health\.(\w+)/g)].map((m) => m[1]).sort()).toEqual(["READ_RESTING_HEART_RATE", "READ_SLEEP"]);
    expect(policy).toMatch(/\*\*sleep sessions\*\* and \*\*resting heart rate\*\*/);
    // No location permission in the app, as the policy says.
    expect(manifest).not.toMatch(/ACCESS_(FINE|COARSE)_LOCATION/);
    expect(policy).toContain("The Android app does not ask for your location at all.");
    // legal/PLAY_DATA_SAFETY.md declares no audio, photos or files: the app asks for none of them.
    expect(manifest).not.toMatch(/RECORD_AUDIO|CAMERA|READ_MEDIA|READ_EXTERNAL_STORAGE|READ_CONTACTS/);
  });
});
