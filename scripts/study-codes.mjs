// Makes enrolment codes for the study (prompt 6.2), for the researchers.
//
//   node scripts/study-codes.mjs 20                  20 single-use codes
//   node scripts/study-codes.mjs 5 --uses 3 --days 30
//
// Reads MONGO_DB_URI (as the app does, from the environment or .env.local).
// Prints the codes once: only their SHA-256 hashes are stored, so they can't
// be recovered later, and a copy of the database doesn't reveal working ones.
// Only once an ethics committee has approved the study (DEVELOPMENT_PLAN 8.2).
//
// The format and hashing must match lib/studyServer.ts; lib/studyCodes.test.ts
// checks they do.

import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const STUDY_ID = "somni-wake-plan-1";
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function normaliseCode(code) {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

export function hashCode(code) {
  return createHash("sha256").update(`somni-study:${normaliseCode(code)}`).digest("hex");
}

export function newCode() {
  const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

async function main() {
  const count = Number(process.argv[2]);
  const uses = arg("--uses", 1);
  const days = arg("--days", null);
  if (!Number.isInteger(count) || count < 1 || count > 500 || !Number.isInteger(uses) || uses < 1) {
    console.error("usage: node scripts/study-codes.mjs <count 1-500> [--uses N] [--days N]");
    process.exit(2);
  }
  let uri = process.env.MONGO_DB_URI;
  if (!uri && existsSync(".env.local")) {
    uri = readFileSync(".env.local", "utf8").match(/^MONGO_DB_URI=(.*)$/m)?.[1]?.trim();
  }
  if (!uri) {
    console.error("MONGO_DB_URI is not set");
    process.exit(2);
  }
  const { MongoClient } = await import("mongodb");
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db();
    const now = new Date();
    await db.collection("studies").updateOne(
      { studyId: STUDY_ID },
      { $setOnInsert: { studyId: STUDY_ID, experiment: "wake_plan", seed: randomBytes(8).toString("hex"), withdrawn: 0, createdAt: now } },
      { upsert: true },
    );
    const codes = Array.from({ length: count }, newCode);
    await db.collection("studycodes").insertMany(codes.map((c) => ({
      studyId: STUDY_ID, codeHash: hashCode(c), uses: 0, maxUses: uses,
      expiresAt: days ? new Date(now.getTime() + days * 86_400_000) : null, createdAt: now,
    })));
    console.log(`${count} code(s) for ${STUDY_ID}, ${uses} use(s) each${days ? `, for ${days} days` : ""}. Shown once:`);
    for (const c of codes) {
      console.log(c);
    }
  }
  finally {
    await client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
