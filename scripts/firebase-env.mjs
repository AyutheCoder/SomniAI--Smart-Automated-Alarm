#!/usr/bin/env node
// Copies a Firebase service-account key into .env.local as the three values
// lib/push.ts reads, without ever printing the key (BUDDY.md, step 3):
//
//   node scripts/firebase-env.mjs path/to/service-account.json
//
// Existing FIREBASE_* lines are replaced; everything else is kept.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("usage: node scripts/firebase-env.mjs path/to/service-account.json");
  process.exit(1);
}
let key;
try {
  key = JSON.parse(readFileSync(file, "utf8"));
}
catch {
  console.error("firebase-env: that file isn't JSON. It should be the key Firebase downloaded (Project settings > Service accounts).");
  process.exit(1);
}
if (key.type !== "service_account" || !key.project_id || !key.client_email || !key.private_key) {
  console.error("firebase-env: that isn't a service-account key (it needs type, project_id, client_email and private_key).");
  process.exit(1);
}

const lines = existsSync(".env.local") ? readFileSync(".env.local", "utf8").split(/\r?\n/) : [];
const kept = lines.filter((l) => !/^FIREBASE_(PROJECT_ID|CLIENT_EMAIL|PRIVATE_KEY)=/.test(l));
while (kept.length && kept[kept.length - 1] === "") {
  kept.pop();
}
kept.push(
  "",
  "# Wake-buddy push (BUDDY.md). Written by scripts/firebase-env.mjs.",
  `FIREBASE_PROJECT_ID=${key.project_id}`,
  `FIREBASE_CLIENT_EMAIL=${key.client_email}`,
  // One line, "\n" for the line breaks, quoted: lib/push.ts turns them back.
  `FIREBASE_PRIVATE_KEY="${key.private_key.replace(/\r?\n/g, "\\n")}"`,
  "",
);
writeFileSync(".env.local", kept.join("\n"));
console.log(`firebase-env: .env.local now has the push credentials for project ${key.project_id} (the key itself isn't shown).`);
console.log("firebase-env: keep the downloaded key file somewhere safe outside this folder, or delete it. Restart npm run dev.");
