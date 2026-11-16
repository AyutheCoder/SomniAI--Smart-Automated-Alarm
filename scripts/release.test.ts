import { describe, expect, it } from "vitest";
import { configProblems, fingerprints, manifestProblems, MAX_VERSION_CODE, signingEnv, versionCodeFor } from "./release.mjs";

const SHA256 = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).toUpperCase().padStart(2, "0")).join(":");
const SHA1 = Array.from({ length: 20 }, (_, i) => (i * 11 % 256).toString(16).toUpperCase().padStart(2, "0")).join(":");

const RELEASE_MANIFEST = `<manifest>
  <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
  <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED" />
  <application><service android:name=".alarms.RingService" android:foregroundServiceType="systemExempted" /></application>
</manifest>`;

describe("release version codes", () => {
  it("are the commit count, so every upload is higher than the last", () => {
    expect(versionCodeFor("116")).toBe(116);
    expect(versionCodeFor(117)).toBeGreaterThan(versionCodeFor(116));
  });

  it("refuse what Play can't take", () => {
    for (const bad of ["0", "-3", "1.5", "abc", "", String(MAX_VERSION_CODE + 1)]) {
      expect(() => versionCodeFor(bad)).toThrow(/no version code/);
    }
  });
});

describe("signing", () => {
  it("passes the key's path and password to Gradle through the environment", () => {
    expect(signingEnv({ ANDROID_UPLOAD_KEYSTORE: "/keys/upload.p12", ANDROID_UPLOAD_PASSWORD: "pw" }, () => true))
      .toEqual({ SOMNIAI_UPLOAD_STORE: "/keys/upload.p12", SOMNIAI_UPLOAD_PASSWORD: "pw" });
  });

  it("stops without a key, and says how to get one back when the file is gone", () => {
    expect(() => signingEnv({}, () => true)).toThrow(/release\.mjs key/);
    expect(() => signingEnv({ ANDROID_UPLOAD_KEYSTORE: "/keys/upload.p12" }, () => true)).toThrow(/release\.mjs key/);
    expect(() => signingEnv({ ANDROID_UPLOAD_KEYSTORE: "/gone.p12", ANDROID_UPLOAD_PASSWORD: "pw" }, () => false))
      .toThrow(/restore it from your backup/);
  });

  it("reads keytool's fingerprints", () => {
    const out = `Certificate fingerprints:\n\t SHA1: ${SHA1}\n\t SHA256: ${SHA256}\nSignature algorithm name: SHA384withRSA`;
    expect(fingerprints(out)).toEqual({ sha256: SHA256, sha1: SHA1 });
    expect(fingerprints("nothing here")).toEqual({ sha256: null, sha1: null });
  });
});

describe("the release bundle's checks", () => {
  it("pass a release manifest with what ringing needs", () => {
    expect(manifestProblems(RELEASE_MANIFEST)).toEqual([]);
  });

  it("catch the debug-only parts, debuggable, plain HTTP and a missing alarm permission", () => {
    const bad = RELEASE_MANIFEST
      .replace("<application>", '<application android:debuggable="true" android:usesCleartextTraffic="true"><receiver android:name=".alarms.DebugAlarmReceiver" />')
      .replace("android.permission.USE_FULL_SCREEN_INTENT", "android.permission.VIBRATE");
    expect(manifestProblems(bad)).toEqual([
      "the debug-only receivers are in the release manifest",
      "the release is debuggable",
      "the release allows plain HTTP",
      "the release lacks USE_FULL_SCREEN_INTENT, which ringing needs",
    ]);
  });

  it("require the packaged app to load production over HTTPS", () => {
    const url = "https://somniai.vercel.app";
    expect(configProblems(JSON.stringify({ server: { url, cleartext: false } }), url)).toEqual([]);
    expect(configProblems(JSON.stringify({ server: { url: "http://10.0.2.2:3000", cleartext: true } }), url)).toEqual([
      `the app loads http://10.0.2.2:3000, not ${url}`,
      "the app allows plain HTTP",
    ]);
    expect(configProblems(JSON.stringify({}), url)).toEqual([`the app loads nothing, not ${url}`]);
  });
});
