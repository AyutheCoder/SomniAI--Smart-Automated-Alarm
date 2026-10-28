#!/usr/bin/env node
// `next dev` for testing on phones, with a local MongoDB that needs no
// install: mongodb-memory-server (as the e2e tests use), keeping its data in
// .data/mongo (gitignored) so accounts survive a restart.
//
//   npm run dev:phone
//
// Then, per phone or emulator: `adb reverse tcp:3000 tcp:3000`, and an app
// built with CAP_SERVER_URL=http://localhost:3000 (DEVICE_TESTS.md says when).
// Everything else (CRON_SECRET, Firebase, NEXTAUTH_SECRET) comes from
// .env.local as usual: Next fills only what isn't set here.
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { MongoMemoryServer } from "mongodb-memory-server";

const port = process.env.PORT ?? "3000";
const dbPath = ".data/mongo";
mkdirSync(dbPath, { recursive: true });
const mongod = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: "wiredTiger" } });
console.log(`dev-phone: MongoDB at ${mongod.getUri()} (data in ${dbPath})`);

const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", port], {
  env: {
    ...process.env,
    MONGO_DB_URI: mongod.getUri("somniai-phone"),
    // The phones reach this server as localhost through adb reverse.
    NEXTAUTH_URL: `http://localhost:${port}`,
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: "inherit",
});

let stopping = false;
async function stop(code) {
  if (stopping) {
    return;
  }
  stopping = true;
  next.kill();
  await mongod.stop({ doCleanup: false });
  process.exit(code);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
next.on("exit", (code) => stop(code ?? 1));
