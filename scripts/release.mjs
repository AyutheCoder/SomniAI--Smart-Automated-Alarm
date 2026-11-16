#!/usr/bin/env node
// A release of the Android app (prompt 7.5, play/README.md).
//
//   node scripts/release.mjs key                 make the upload key, once (refuses if one exists)
//   node scripts/release.mjs build --apk         the signed app (.apk) against production, checked
//   node scripts/release.mjs distribute [notes]  send it to the testers by Firebase App Distribution
//   node scripts/release.mjs build               the signed bundle (.aab) for Google Play, checked
//
// The tester chose Firebase App Distribution (free) over Google Play's US$25 fee
// (7.5); the Play bundle and its listing stay ready in play/.
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
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findToolchain, gradle } from "./android.mjs";
import { androidServerUrl, parseEnv, readState } from "./deploy.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEPLOY_FILE = join(ROOT, ".env.deploy.local");
export const KEY_ALIAS = "upload";
export const AAB = join(ROOT, "android", "app", "build", "outputs", "bundle", "release", "app-release.aab");
export const APK = join(ROOT, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
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

/** The signer's SHA-256 from `apksigner verify --print-certs`, in keytool's form (AB:CD:…). */
export function apksignerSha256(text) {
  const hex = /Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})/i.exec(text)?.[1];
  return hex ? hex.toUpperCase().match(/../g).join(":") : null;
}

/** The testers' addresses from FIREBASE_TESTERS (comma-separated); throws if there are none or one isn't an address. */
export function testerList(value) {
  const list = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) {
    throw new Error("no testers: put FIREBASE_TESTERS=you@example.com,friend@example.com in .env.deploy.local");
  }
  for (const e of list) {
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e)) {
      throw new Error(`"${e}" in FIREBASE_TESTERS isn't an e-mail address`);
    }
  }
  return list;
}

/** The Firebase app id for a package, from google-services.json. */
export function firebaseAppId(googleServicesJson, pkg) {
  const client = JSON.parse(googleServicesJson).client?.find((c) => c.client_info?.android_client_info?.package_name === pkg);
  const id = client?.client_info?.mobilesdk_app_id;
  if (!id) {
    throw new Error(`google-services.json has no Firebase app for ${pkg}`);
  }
  return id;
}

/** A service-account key file's contents from .env.local's Firebase settings (the server's own). */
export function serviceAccount(local) {
  for (const k of ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"]) {
    if (!local[k]) {
      throw new Error(`${k} isn't in .env.local`);
    }
  }
  return {
    type: "service_account",
    project_id: local.FIREBASE_PROJECT_ID,
    client_email: local.FIREBASE_CLIENT_EMAIL,
    // .env files keep the key's line breaks as \n.
    private_key: local.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    token_uri: "https://oauth2.googleapis.com/token",
  };
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

/** What `build` made, kept beside it so `distribute` sends only a checked build of a pushed commit. */
const INFO = (file) => `${file}.json`;

/**
 * The release, against production. `apk`: an APK for Firebase App Distribution
 * (the tester's choice in 7.5, instead of Google Play's fee); otherwise the app
 * bundle Google Play takes.
 */
function build(apk) {
  const t = findToolchain();
  if (t.missing.length > 0) {
    throw new Error("the Android toolchain is incomplete; run npm run android:doctor");
  }
  const file = apk ? APK : AAB;
  const kind = apk ? "app" : "bundle";
  const deploy = existsSync(DEPLOY_FILE) ? parseEnv(readFileSync(DEPLOY_FILE, "utf8")) : {};
  const signing = signingEnv(deploy);
  const url = androidServerUrl(readState(join(ROOT, "deploy", "environments.json")));
  const commits = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim() !== "";
  const versionCode = versionCodeFor(commits);
  const versionName = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  if (dirty) {
    console.log("note: uncommitted changes are in this build; it can't be distributed (commit and push first)");
  }

  process.env.CAP_SERVER_URL = url;
  process.env.CAP_RELEASE = "1";
  Object.assign(process.env, signing);
  rmSync(file, { force: true });
  rmSync(INFO(file), { force: true });
  console.log(`Building SomniAI ${versionName} (${versionCode}) at ${commit} against ${url}`);
  const task = apk ? ":app:assembleRelease" : ":app:bundleRelease";
  const status = gradle([task, `-PsomniaiVersionCode=${versionCode}`, `-PsomniaiVersionName=${versionName}`], t);
  delete process.env.SOMNIAI_UPLOAD_PASSWORD;
  if (status !== 0 || !existsSync(file)) {
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
  const config = apk ? "assets/capacitor.config.json" : "base/assets/capacitor.config.json";
  const out = mkdtempSync(join(tmpdir(), "somniai-release-"));
  try {
    execFileSync(tool(t, "jar"), ["xf", file, config], { cwd: out });
    problems.push(...configProblems(readFileSync(join(out, ...config.split("/")), "utf8"), url));
    const listing = execFileSync(tool(t, "jar"), ["tf", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    // Native libraries would need 16 KB page alignment (Android 15+); the app has none.
    const native = listing.split(/\r?\n/).filter((f) => f.endsWith(".so"));
    if (native.length) {
      problems.push(`native libraries to check for 16 KB alignment: ${native.join(", ")}`);
    }
  }
  finally {
    rmSync(out, { recursive: true, force: true });
  }
  const own = keystoreFingerprints(t, signing.SOMNIAI_UPLOAD_STORE, signing.SOMNIAI_UPLOAD_PASSWORD);
  let signedBy = null;
  if (apk) {
    // APKs from minSdk 26 carry only the v2/v3 signature schemes, which apksigner checks (jarsigner can't).
    const res = spawnSync(apksigner(t), ["verify", "--print-certs", file], { encoding: "utf8", shell: process.platform === "win32" });
    signedBy = res.status === 0 ? apksignerSha256(res.stdout) : null;
    if (res.status !== 0) {
      problems.push(`the app's signature doesn't verify: ${(res.stderr || res.stdout).trim().split("\n")[0]}`);
    }
  }
  else {
    const verify = spawnSync(tool(t, "jarsigner"), ["-verify", file], { encoding: "utf8" });
    if (!/jar verified/.test(verify.stdout)) {
      problems.push(`the bundle's signature doesn't verify: ${verify.stdout.trim().split("\n")[0]}`);
    }
    signedBy = fingerprints(execFileSync(tool(t, "keytool"), ["-printcert", "-jarfile", file], { encoding: "utf8" })).sha256;
  }
  if (!signedBy || signedBy !== own.sha256) {
    problems.push(`the ${kind} isn't signed with the upload key`);
  }
  if (problems.length) {
    for (const p of problems) {
      console.error(`  PROBLEM: ${p}`);
    }
    throw new Error(`the release ${kind} failed its checks; don't distribute it`);
  }
  writeFileSync(INFO(file), JSON.stringify({ commit, dirty, versionCode, versionName, url, sha256: own.sha256 }, null, 2));
  console.log(`Release ${kind}: ${file}`);
  console.log(`  version ${versionName} (code ${versionCode}), ${Math.round(statSync(file).size / 1024)} KB, signed by the upload key (SHA-256 ${own.sha256})`);
  console.log(`  loads ${url} over HTTPS; no debug parts; no native libraries`);
}

function apksigner(t) {
  const dir = join(t.sdk, "build-tools", t.sdkParts.buildTools);
  return join(dir, process.platform === "win32" ? "apksigner.bat" : "apksigner");
}

/** The Firebase CLI, pinned (a version over two weeks old when chosen, 2026-11-16). */
export const FIREBASE_CLI = "firebase-tools@15.34.0";

/**
 * Sends the checked release APK to the testers in FIREBASE_TESTERS through
 * Firebase App Distribution. Signs in as the Firebase service account already
 * in .env.local (the server's push sender), through a key file that exists only
 * while the upload runs.
 */
function distribute(notes) {
  if (!existsSync(APK) || !existsSync(INFO(APK))) {
    throw new Error("no checked release app: run node scripts/release.mjs build --apk first");
  }
  const info = JSON.parse(readFileSync(INFO(APK), "utf8"));
  const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (info.dirty || info.commit !== head) {
    throw new Error(`the app was built from ${info.commit}${info.dirty ? " with uncommitted changes" : ""}, not ${head}: commit, push and build again`);
  }
  if (!execFileSync("git", ["branch", "-r", "--contains", head], { cwd: ROOT, encoding: "utf8" }).trim()) {
    throw new Error(`commit ${head} isn't on GitHub yet: push first, so every tester build is a published commit`);
  }
  const deploy = existsSync(DEPLOY_FILE) ? parseEnv(readFileSync(DEPLOY_FILE, "utf8")) : {};
  const testers = testerList(deploy.FIREBASE_TESTERS);
  const local = parseEnv(readFileSync(join(ROOT, ".env.local"), "utf8"));
  const appId = firebaseAppId(readFileSync(join(ROOT, "android", "app", "google-services.json"), "utf8"), "app.somniai.alarm");
  const dir = mkdtempSync(join(tmpdir(), "somniai-firebase-"));
  const keyFile = join(dir, "service-account.json");
  try {
    writeFileSync(keyFile, JSON.stringify(serviceAccount(local)), { mode: 0o600 });
    // In a file: Windows' shell would split notes with spaces into separate arguments.
    const notesFile = join(dir, "release-notes.txt");
    writeFileSync(notesFile, `SomniAI ${info.versionName} (${info.versionCode}), ${info.commit}. ${notes || "Test build."}`);
    console.log(`Sending SomniAI ${info.versionName} (${info.versionCode}) to ${testers.length} tester(s)…`);
    const upload = (env) => spawnSync("npx", ["--yes", FIREBASE_CLI, "appdistribution:distribute", APK,
      "--app", appId, "--testers", testers.join(","), "--release-notes-file", notesFile],
    { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32", env });
    // The CLI prints the console and tester links; nothing secret is in its output.
    const show = (r) => console.log(`${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter((l) => l.trim() && !/npm warn/.test(l)).slice(-12).join("\n"));
    let res = upload({ ...process.env, GOOGLE_APPLICATION_CREDENTIALS: keyFile });
    if (res.status !== 0 && /403|does not have permission/i.test(`${res.stdout}${res.stderr}`)) {
      // The server's push account may lack App Distribution's role (seen in 7.5): then
      // upload as the project's owner, signed in once with `firebase login`.
      console.log("  the server's Firebase account can't upload test builds; trying your own Firebase login");
      const { GOOGLE_APPLICATION_CREDENTIALS: _unused, ...env } = process.env;
      void _unused;
      res = upload(env);
      if (res.status !== 0 && /authenticate|firebase login/i.test(`${res.stdout}${res.stderr}`)) {
        show(res);
        throw new Error(`sign in to Firebase once, in a terminal: npx ${FIREBASE_CLI} login  (then run this again)`);
      }
    }
    show(res);
    if (res.status !== 0) {
      throw new Error("Firebase refused the upload (above)");
    }
  }
  finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const command = process.argv[2];
    if (command === "key") {
      key();
    }
    else if (command === "build") {
      build(process.argv.includes("--apk"));
    }
    else if (command === "distribute") {
      distribute(process.argv.slice(3).join(" "));
    }
    else {
      console.error("usage: node scripts/release.mjs key | build [--apk] | distribute [release notes]");
      process.exit(2);
    }
  }
  catch (e) {
    console.error(`release: ${e.message}`);
    process.exit(1);
  }
}
