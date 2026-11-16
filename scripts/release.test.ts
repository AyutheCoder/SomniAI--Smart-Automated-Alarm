import { describe, expect, it } from "vitest";
import {
  apksignerSha256, configProblems, firebaseAppId, fingerprints, manifestProblems, MAX_VERSION_CODE, serviceAccount, signingEnv,
  testerList, versionCodeFor,
} from "./release.mjs";

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

describe("Firebase App Distribution (the tester's choice over Google Play's fee)", () => {
  it("reads the APK's signer from apksigner in keytool's form, to compare with the upload key", () => {
    const hex = SHA256.replace(/:/g, "").toLowerCase();
    const out = `Signer #1 certificate DN: CN=SomniAI upload key\nSigner #1 certificate SHA-256 digest: ${hex}\nSigner #1 certificate SHA-1 digest: abc`;
    expect(apksignerSha256(out)).toBe(SHA256);
    expect(apksignerSha256("DOES NOT VERIFY")).toBeNull();
  });

  it("takes testers as comma-separated addresses, and refuses none or a non-address", () => {
    expect(testerList(" a@example.com, b@example.org ,")).toEqual(["a@example.com", "b@example.org"]);
    expect(() => testerList(undefined)).toThrow(/FIREBASE_TESTERS/);
    expect(() => testerList("a@example.com,not an address")).toThrow(/isn't an e-mail address/);
  });

  it("finds the app's Firebase id for its package in google-services.json", () => {
    const json = JSON.stringify({ client: [
      { client_info: { mobilesdk_app_id: "1:1:android:other", android_client_info: { package_name: "com.other" } } },
      { client_info: { mobilesdk_app_id: "1:1:android:somni", android_client_info: { package_name: "app.somniai.alarm" } } },
    ] });
    expect(firebaseAppId(json, "app.somniai.alarm")).toBe("1:1:android:somni");
    expect(() => firebaseAppId(JSON.stringify({ client: [] }), "app.somniai.alarm")).toThrow(/no Firebase app/);
  });

  it("makes the service-account key from .env.local's Firebase settings, with real line breaks in the key", () => {
    const key = serviceAccount({ FIREBASE_PROJECT_ID: "p", FIREBASE_CLIENT_EMAIL: "sa@p.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: "-----BEGIN-----\\nabc\\n-----END-----" });
    expect(key).toMatchObject({ type: "service_account", project_id: "p", client_email: "sa@p.iam.gserviceaccount.com" });
    expect(key.private_key).toBe("-----BEGIN-----\nabc\n-----END-----");
    expect(() => serviceAccount({ FIREBASE_PROJECT_ID: "p" })).toThrow(/FIREBASE_CLIENT_EMAIL/);
  });
});
