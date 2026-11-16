#!/usr/bin/env node
// A Google Play release of the Android app (prompt 7.5, play/README.md).
//
//   node scripts/release.mjs key     make the upload key, once (refuses if one exists)
//   node scripts/release.mjs build   the signed app bundle (.aab) against production, checked
//
// The upload key lives outside the repository, in ~/.somniai/, and its password
// in .env.deploy.local (ANDROID_UPLOAD_KEYSTORE, ANDROID_UPLOAD_PASSWORD), which
// git ignores and check-secrets watches. Google Play App Signing keeps the key
// that signs what users install; this one only proves an upload came from you,
// and Google can replace it if it's lost (play/README.md, "The upload key").
//
// Nothing here prints the password: keytool and Gradle read it from the
// environment (keytool's -storepass:env), never from the command line.
import { spawnSync, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findToolchain, gradle } from "./android.mjs";
import { androidServerUrl, parseEnv, readState } from "./deploy.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEPLOY_FILE = join(ROOT, ".env.deploy.local");
export const KEY_ALIAS = "upload";
export const AAB = join(ROOT, "android", "app", "build", "outputs", "bundle", "release", "app-release.aab");
const MERGED_MANIFESTS = join(ROOT, "android", "app", "build", "intermediates", "merged_manifests", "release");

/** Google Play's limit on versionCode. */
export const MAX_VERSION_CODE = 2_100_000_000;

/** The version code for a commit: how many commits lead to it, so each release is higher than the last. */
export function versionCodeFor(commitCount) {
  const n = Number(commitCount);
  if (!Number.isInteger(n) || n < 1 || n > MAX_VERSION_CODE) {
    throw new Error(`no version code from a commit count of ${commitCount}`);
  }
  return n;
}

/** What Gradle needs to sign, from .env.deploy.local; throws with what's missing. */
export function signingEnv(deploy, exists = existsSync) {
  const store = deploy.ANDROID_UPLOAD_KEYSTORE;
  const password = deploy.ANDROID_UPLOAD_PASSWORD;
  if (!store || !password) {
    throw new Error("no upload key in .env.deploy.local: run node scripts/release.mjs key first");
  }
  if (!exists(store)) {
    throw new Error(`the upload key isn't at ${store}: restore it from your backup (play/README.md), or, if it's lost, ask Google Play to reset it`);
  }
  return { SOMNIAI_UPLOAD_STORE: store, SOMNIAI_UPLOAD_PASSWORD: password };
}

/** Problems with a release build's merged manifest: debug-only parts, cleartext, debuggable. */
export function manifestProblems(xml) {
  const problems = [];
  if (/DebugAlarmReceiver|DebugPreflightScreen/.test(xml)) {
    problems.push("the debug-only receivers are in the release manifest");
  }
  if (/android:debuggable="true"/.test(xml)) {
    problems.push("the release is debuggable");
  }
  if (/android:usesCleartextTraffic="true"/.test(xml)) {
    problems.push("the release allows plain HTTP");
  }
  for (const p of ["USE_EXACT_ALARM", "USE_FULL_SCREEN_INTENT", "FOREGROUND_SERVICE_SYSTEM_EXEMPTED"]) {
    if (!xml.includes(`android.permission.${p}"`)) {
      problems.push(`the release lacks ${p}, which ringing needs`);
    }
  }
  return problems;
}

/** Problems with the packaged Capacitor config: it must load production over HTTPS. */
export function configProblems(json, expectedUrl) {
  const c = JSON.parse(json);
  const problems = [];
  if (c.server?.url !== expectedUrl) {
    problems.push(`the app loads ${c.server?.url ?? "nothing"}, not ${expectedUrl}`);
  }
  if (c.server?.cleartext) {
    problems.push("the app allows plain HTTP");
  }
  return problems;
}

/** SHA-256 and SHA-1 fingerprints from keytool's output. */
export function fingerprints(text) {
  return {
    sha256: /SHA256:\s*([0-9A-F:]{95})/.exec(text)?.[1] ?? null,
    sha1: /SHA1:\s*([0-9A-F:]{59})/.exec(text)?.[1] ?? null,
  };
}

function tool(t, name) {
  return join(t.jdk.home, "bin", process.platform === "win32" ? `${name}.exe` : name);
}

function keystoreFingerprints(t, store, password) {
  const res = spawnSync(tool(t, "keytool"), ["-list", "-v", "-keystore", store, "-storetype", "PKCS12", "-alias", KEY_ALIAS, "-storepass:env", "SOMNIAI_UPLOAD_PASSWORD"],
    { encoding: "utf8", env: { ...process.env, SOMNIAI_UPLOAD_PASSWORD: password } });
  if (res.status !== 0) {
    throw new Error(`keytool couldn't read the upload key: ${(res.stderr || res.stdout).split("\n")[0]}`);
  }
  return fingerprints(res.stdout);
}

function key() {
  const t = findToolchain();
  const deploy = existsSync(DEPLOY_FILE) ? parseEnv(readFileSync(DEPLOY_FILE, "utf8")) : {};
  if (deploy.ANDROID_UPLOAD_KEYSTORE) {
    throw new Error(`an upload key is already set up (${deploy.ANDROID_UPLOAD_KEYSTORE}); a second wouldn't match the one Google Play knows`);
  }
  const dir = join(homedir(), ".somniai");
  const store = join(dir, "somniai-upload.p12");
  if (existsSync(store)) {
    throw new Error(`${store} already exists; add its path and password to .env.deploy.local rather than making another`);
  }
  mkdirSync(dir, { recursive: true });
  const password = randomBytes(24).toString("base64url");
  // RSA 4096, valid 30 years (Play needs at least 25 for keys it holds; the same here keeps uploads simple).
  const res = spawnSync(tool(t, "keytool"), ["-genkeypair", "-keystore", store, "-storetype", "PKCS12", "-alias", KEY_ALIAS,
    "-keyalg", "RSA", "-keysize", "4096", "-validity", "10950", "-dname", "CN=SomniAI upload key",
    "-storepass:env", "SOMNIAI_UPLOAD_PASSWORD", "-keypass:env", "SOMNIAI_UPLOAD_PASSWORD"],
  { encoding: "utf8", env: { ...process.env, SOMNIAI_UPLOAD_PASSWORD: password } });
  if (res.status !== 0) {
    throw new Error(`keytool failed: ${(res.stderr || res.stdout).split("\n")[0]}`);
  }
  appendFileSync(DEPLOY_FILE, `\n# Google Play upload key (prompt 7.5): back both up (play/README.md)\nANDROID_UPLOAD_KEYSTORE=${store}\nANDROID_UPLOAD_PASSWORD=${password}\n`);
  const fp = keystoreFingerprints(t, store, password);
  console.log(`Upload key made: ${store}`);
  console.log("Its password is in .env.deploy.local (ANDROID_UPLOAD_PASSWORD).");
  console.log(`  SHA-256 ${fp.sha256}`);
  console.log(`  SHA-1   ${fp.sha1}`);
  console.log("Back up the key file and the password now: play/README.md, \"The upload key\".");
}

function findFile(dir, name) {
  if (!existsSync(dir)) {
    return null;
  }
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      const found = findFile(p, name);
      if (found) {
        return found;
      }
    }
    else if (f === name) {
      return p;
    }
  }
  return null;
}

function build() {
  const t = findToolchain();
  if (t.missing.length > 0) {
    throw new Error("the Android toolchain is incomplete; run npm run android:doctor");
  }
  const deploy = existsSync(DEPLOY_FILE) ? parseEnv(readFileSync(DEPLOY_FILE, "utf8")) : {};
  const signing = signingEnv(deploy);
  const url = androidServerUrl(readState(join(ROOT, "deploy", "environments.json")));
  const commits = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim() !== "";
  const versionCode = versionCodeFor(commits);
  const versionName = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  if (dirty) {
    console.log("note: uncommitted changes are in this build; upload only a build of a pushed commit");
  }

  process.env.CAP_SERVER_URL = url;
  process.env.CAP_RELEASE = "1";
  Object.assign(process.env, signing);
  rmSync(AAB, { force: true });
  console.log(`Building SomniAI ${versionName} (${versionCode}) at ${commit} against ${url}`);
  const status = gradle([":app:bundleRelease", `-PsomniaiVersionCode=${versionCode}`, `-PsomniaiVersionName=${versionName}`], t);
  delete process.env.SOMNIAI_UPLOAD_PASSWORD;
  if (status !== 0 || !existsSync(AAB)) {
    throw new Error("the release build failed");
  }

  // What was built, checked rather than assumed.
  const problems = [];
  const manifest = findFile(MERGED_MANIFESTS, "AndroidManifest.xml");
  if (!manifest) {
    problems.push("no merged release manifest to check");
  }
  else {
    problems.push(...manifestProblems(readFileSync(manifest, "utf8")));
  }
  const out = mkdtempSync(join(tmpdir(), "somniai-aab-"));
  try {
    execFileSync(tool(t, "jar"), ["xf", AAB, "base/assets/capacitor.config.json", "base/manifest/AndroidManifest.xml"], { cwd: out });
    problems.push(...configProblems(readFileSync(join(out, "base", "assets", "capacitor.config.json"), "utf8"), url));
    const listing = execFileSync(tool(t, "jar"), ["tf", AAB], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    // Native libraries would need 16 KB page alignment (Play, Android 15+); the app has none.
    const native = listing.split(/\r?\n/).filter((f) => f.endsWith(".so"));
    if (native.length) {
      problems.push(`native libraries to check for 16 KB alignment: ${native.join(", ")}`);
    }
  }
  finally {
    rmSync(out, { recursive: true, force: true });
  }
  const verify = spawnSync(tool(t, "jarsigner"), ["-verify", AAB], { encoding: "utf8" });
  if (!/jar verified/.test(verify.stdout)) {
    problems.push(`the bundle's signature doesn't verify: ${verify.stdout.trim().split("\n")[0]}`);
  }
  const signer = fingerprints(execFileSync(tool(t, "keytool"), ["-printcert", "-jarfile", AAB], { encoding: "utf8" }));
  const own = keystoreFingerprints(t, signing.SOMNIAI_UPLOAD_STORE, signing.SOMNIAI_UPLOAD_PASSWORD);
  if (!signer.sha256 || signer.sha256 !== own.sha256) {
    problems.push("the bundle isn't signed with the upload key");
  }
  if (problems.length) {
    for (const p of problems) {
      console.error(`  PROBLEM: ${p}`);
    }
    throw new Error("the release bundle failed its checks; don't upload it");
  }
  console.log(`Release bundle: ${AAB}`);
  console.log(`  version ${versionName} (code ${versionCode}), ${Math.round(statSync(AAB).size / 1024)} KB, signed by the upload key (SHA-256 ${own.sha256})`);
  console.log(`  loads ${url} over HTTPS; no debug parts; no native libraries`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const command = process.argv[2];
    if (command === "key") {
      key();
    }
    else if (command === "build") {
      build();
    }
    else {
      console.error("usage: node scripts/release.mjs key|build");
      process.exit(2);
    }
  }
  catch (e) {
    console.error(`release: ${e.message}`);
    process.exit(1);
  }
}
