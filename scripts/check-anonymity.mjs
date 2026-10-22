#!/usr/bin/env node
// Fails if any tracked file contains an author identifier.
//
// The paper is under double-blind review and this repository is public, so a
// name, e-mail, institution or GitHub username in a tracked file can
// deanonymise the submission. This has already happened once by accident.
//
// The identifiers themselves cannot live in the repository, so they are read
// from `.anonymity-terms.local` (gitignored, one term per line, # for
// comments). Without that file the check cannot run, and it says so rather than
// passing silently.
//
// Usage:  node scripts/check-anonymity.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const TERMS_FILE = ".anonymity-terms.local";

if (!existsSync(TERMS_FILE)) {
  console.error(
    `check-anonymity: ${TERMS_FILE} not found, so the check did NOT run.\n` +
      "Ask the project owners for it. It lists the identifiers to block, one per line.",
  );
  process.exit(2);
}

const terms = readFileSync(TERMS_FILE, "utf8")
  .split(/\r?\n/)
  .map((t) => t.trim())
  .filter((t) => t && !t.startsWith("#"));

if (terms.length === 0) {
  console.error(`check-anonymity: ${TERMS_FILE} is empty, so the check did NOT run.`);
  process.exit(2);
}

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => f !== "package-lock.json" && !/\.(pdf|png|jpe?g|ico|zip|pkl|joblib)$/i.test(f));

const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "i");

const hits = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(pattern);
    if (m) hits.push(`${file}:${i + 1}: "${m[1]}"`);
  });
}

if (hits.length) {
  console.error(`check-anonymity: ${hits.length} identifier(s) in tracked files:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-anonymity: clean (${files.length} tracked files, ${terms.length} terms).`);
