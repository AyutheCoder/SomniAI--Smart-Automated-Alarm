// The Google Play release's material (prompt 7.5, play/README.md) held to Play's
// limits and to the code: the listing's lengths and wording, the graphics' sizes,
// and a declaration for every permission the manifest asks for.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRESCENT, NIGHT } from "../play/brand/mark.mjs";

const ROOT = join(__dirname, "..");
const LISTING = join(ROOT, "play", "listing", "en-US");
const GRAPHICS = join(LISTING, "graphics");
const SCREENSHOTS = join(GRAPHICS, "phoneScreenshots");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const text = (f: string) => readFileSync(join(LISTING, f), "utf8").trim();

/** Width, height and, for a PNG, whether it has an alpha channel. */
function imageInfo(buf: Buffer): { type: "png" | "jpeg"; width: number; height: number; alpha: boolean } {
  if (buf.toString("ascii", 1, 4) === "PNG") {
    const colourType = buf[25];
    return { type: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: colourType === 4 || colourType === 6 };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    // Walk the JPEG's segments to the frame header (SOF0-SOF15, not DHT/JPG/DAC).
    let i = 2;
    while (i < buf.length) {
      const marker = buf[i + 1];
      const length = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: "jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), alpha: false };
      }
      i += 2 + length;
    }
  }
  throw new Error("not a PNG or JPEG");
}

describe("the store listing", () => {
  it("fits Play's limits: title 30, short description 80, full description 4000 characters", () => {
    expect([...text("title.txt")].length).toBeLessThanOrEqual(30);
    expect([...text("short_description.txt")].length).toBeLessThanOrEqual(80);
    expect([...text("full_description.txt")].length).toBeLessThanOrEqual(4000);
  });

  it("makes none of the claims Play's metadata policy forbids in a title", () => {
    expect(text("title.txt")).not.toMatch(/\b(best|#1|top|free|new|sale|discount)\b/i);
    expect(text("title.txt")).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("claims only what production does", () => {
    const all = `${text("short_description.txt")}\n${text("full_description.txt")}`;
    // Texts to an emergency contact need a full Twilio account, and Calendar a registered Google redirect (DEPLOY.md).
    expect(all).not.toMatch(/\bSMS\b|text message|texts? your|Google Calendar|calendar/i);
    // The predictions are modest, and labelled so in the app (5.2).
    expect(all).toMatch(/not medical advice, and SomniAI is not a medical device/);
    expect(all).toMatch(/69 people/);
    // The bedtime check's eight checks, as Preflight.java names them.
    const preflight = read("android", "app", "src", "main", "java", "app", "somniai", "alarm", "alarms", "Preflight.java");
    for (const title of ["Alarms & reminders", "Notifications", "Alarm screen over the lock screen", "Battery optimisation", "Phone maker's battery manager", "Alarm volume", "Do Not Disturb"]) {
      expect(preflight).toContain(title);
    }
    expect(all).toMatch(/alarm permission, notifications, the alarm screen over the lock screen, battery optimisation, your phone maker's battery manager, alarm volume, Do Not Disturb and the battery/);
  });
});

describe("the listing's graphics", () => {
  it("has a 512 x 512 PNG icon and a 1024 x 500 feature graphic without alpha", () => {
    expect(imageInfo(readFileSync(join(GRAPHICS, "icon.png")))).toMatchObject({ type: "png", width: 512, height: 512 });
    expect(imageInfo(readFileSync(join(GRAPHICS, "featureGraphic.jpg")))).toEqual({ type: "jpeg", width: 1024, height: 500, alpha: false });
  });

  it("has 2 to 8 phone screenshots, each 320-3840 px, no side more than twice the other, no alpha", () => {
    const shots = existsSync(SCREENSHOTS) ? readdirSync(SCREENSHOTS).filter((f) => /\.(png|jpe?g)$/i.test(f)) : [];
    expect(shots.length, "run node scripts/play-screenshots.mjs on a phone").toBeGreaterThanOrEqual(2);
    expect(shots.length).toBeLessThanOrEqual(8);
    for (const f of shots) {
      const { width, height, alpha } = imageInfo(readFileSync(join(SCREENSHOTS, f)));
      expect(Math.min(width, height), f).toBeGreaterThanOrEqual(320);
      expect(Math.max(width, height), f).toBeLessThanOrEqual(3840);
      expect(Math.max(width, height) / Math.min(width, height), f).toBeLessThanOrEqual(2);
      expect(alpha, f).toBe(false);
    }
  });

  it("reads JPEG and PNG headers", () => {
    expect(() => imageInfo(Buffer.from("not an image"))).toThrow(/not a PNG or JPEG/);
  });
});

describe("SomniAI's own icon", () => {
  it("replaces the template's: the adaptive icon's background is the night colour, and the web icons draw the mark", () => {
    expect(read("android", "app", "src", "main", "res", "values", "ic_launcher_background.xml")).toContain(NIGHT);
    expect(existsSync(join(ROOT, "android", "app", "src", "main", "res", "drawable-v24", "ic_launcher_foreground.xml"))).toBe(false);
    for (const f of ["icon.svg", "icon-maskable.svg"]) {
      expect(read("public", "icons", f)).toContain(CRESCENT);
    }
  });
});

describe("Play declarations", () => {
  const manifest = read("android", "app", "src", "main", "AndroidManifest.xml");
  const declarations = read("play", "DECLARATIONS.md");
  // Permissions Play asks nothing about.
  const ORDINARY = new Set(["INTERNET", "RECEIVE_BOOT_COMPLETED", "POST_NOTIFICATIONS", "WAKE_LOCK", "VIBRATE", "FOREGROUND_SERVICE"]);

  it("cover every permission the app asks for that isn't ordinary", () => {
    const permissions = [...manifest.matchAll(/<uses-permission\s+android:name="android\.permission\.([\w.]+)"/g)].map((m) => m[1]);
    expect(permissions.length).toBeGreaterThan(5);
    for (const p of permissions.filter((p) => !ORDINARY.has(p))) {
      expect(declarations, `${p} needs a section in play/DECLARATIONS.md`).toContain(p.startsWith("health.") ? `android.permission.${p}` : p);
    }
  });

  it("declare every foreground service type, with the video Play asks for", () => {
    const types = [...manifest.matchAll(/android:foregroundServiceType="([^"]+)"/g)].flatMap((m) => m[1].split("|"));
    expect(types).toEqual(["systemExempted"]);
    for (const t of types) {
      expect(declarations).toContain(`\`${t}\``);
    }
    expect(declarations).toMatch(/link to a video/);
  });

  it("give the alarm-clock justification for exact alarms and the full-screen intent", () => {
    expect(declarations).toMatch(/\*\*Core functionality:\*\* Alarm clock/);
    expect(declarations).toMatch(/Yes: \*\*Alarm\*\*/);
  });

  it("point at production's public privacy policy and deletion page", () => {
    expect(declarations).toContain("https://somniai.vercel.app/privacy");
    expect(declarations).toContain("https://somniai.vercel.app/delete-account");
    expect(read("legal", "PLAY_DATA_SAFETY.md")).not.toContain("<your domain>");
  });
});
