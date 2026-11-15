// No secret in the repository or the client bundle (prompt 7.1).
//
//   node scripts/check-secrets.mjs           tracked files, git history, and .next/static if built
//
// 1. Every value in .env.local (and the environment) whose name isn't
//    NEXT_PUBLIC_*, 8 characters or longer, is searched for in every tracked
//    file, in the whole git history, and in the built browser bundle
//    (.next/static). NEXT_PUBLIC_ values are meant for the browser.
// 2. Tracked files are scanned for the shapes of common credentials, so a key
//    pasted from somewhere else is caught even if .env.local never held it.
//
// Prints names and places, never a value. Exits 1 on any finding.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Credential shapes: [name, pattern]. */
export const SHAPES = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ["Google OAuth client secret", /GOCSPX-[A-Za-z0-9_-]{20,}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["Twilio account SID", /\bAC[0-9a-f]{32}\b/],
  ["Twilio API key SID", /\bSK[0-9a-f]{32}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Stripe secret key", /\bsk_live_[0-9A-Za-z]{20,}\b/],
  ["Slack token", /\bxox[abpr]-[0-9A-Za-z-]{10,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36}\b/],
  ["MongoDB URI with a password", /mongodb(?:\+srv)?:\/\/[^\s:/@"'`]+:[^\s@"'`]+@/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];

/** Placeholders and test values that look like secrets and aren't. */
// The Google Calendar fixtures' tokens are signed "fixture-..." with key id "fixture" (tests/fixtures/google-calendar).
const ALLOWED = [/e2e-only-secret-never-used-outside-tests/, /mongodb:\/\/user:pass@/, /\.fixture-[A-Za-z0-9_-]+$/];

export function secretValues(envText, env = {}) {
  const out = new Map();
  const add = (name, value) => {
    const v = (value ?? "").trim().replace(/^["']|["']$/g, "");
    // A connection string without a password in it (a local database) is an address, not a secret.
    const credentialFree = /^[a-z+]+:\/\//i.test(v) && !v.includes("@");
    if (!name.startsWith("NEXT_PUBLIC_") && v.length >= 8 && !credentialFree && !/^(true|false|localhost)$/i.test(v)) {
      out.set(name, v);
    }
  };
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) {
      add(m[1], m[2]);
    }
  }
  for (const [k, v] of Object.entries(env)) {
    if (/SECRET|TOKEN|PASSWORD|PRIVATE|_KEY|_SID|MONGO_DB_URI/.test(k)) {
      add(k, v);
    }
  }
  return out;
}

/** Credential shapes found in a text, by name. */
export function shapesIn(text) {
  return SHAPES.filter(([, re]) => re.test(text) && !ALLOWED.some((a) => {
    const m = text.match(re);
    return m && a.test(m[0]);
  })).map(([name]) => name);
}

function walk(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function main() {
  const findings = [];
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)
    .filter((f) => existsSync(f) && !/\.(joblib|png|jpg|jpeg|gif|ico|pdf|zip|jar|keystore|woff2?)$/i.test(f));
  const envText = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
  const secrets = secretValues(envText, process.env);

  for (const f of tracked) {
    const text = readFileSync(f, "utf8");
    for (const [name, value] of secrets) {
      if (text.includes(value)) {
        findings.push(`${name}'s value is in tracked file ${f}`);
      }
    }
    for (const shape of shapesIn(text)) {
      if (f !== "scripts/check-secrets.mjs" && !f.endsWith("check-secrets.test.ts")) {
        findings.push(`something shaped like a ${shape} is in tracked file ${f}`);
      }
    }
  }

  // The whole history: a secret committed once and deleted is still published.
  for (const [name, value] of secrets) {
    const hit = execFileSync("git", ["log", "--all", "--oneline", "-S", value, "--"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
    if (hit) {
      findings.push(`${name}'s value appears in git history (${hit.split("\n").length} commit(s))`);
    }
  }

  const bundle = walk(join(".next", "static")).filter((f) => /\.(js|css|html|json|map)$/.test(f));
  for (const f of bundle) {
    const text = readFileSync(f, "utf8");
    for (const [name, value] of secrets) {
      if (text.includes(value)) {
        findings.push(`${name}'s value is in the client bundle: ${f}`);
      }
    }
  }

  console.log(`check-secrets: ${secrets.size} secret value(s) from the environment, ${tracked.length} tracked files, `
    + `git history, ${bundle.length} client bundle file(s)${bundle.length ? "" : " (no build to check)"}.`);
  if (findings.length) {
    for (const f of findings) {
      console.log(`  FOUND: ${f}`);
    }
    process.exit(1);
  }
  console.log("check-secrets: clean.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
