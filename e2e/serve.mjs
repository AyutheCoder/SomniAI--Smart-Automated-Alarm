#!/usr/bin/env node
// What the end-to-end flows run against: a throwaway in-memory MongoDB and
// `next dev` pointed at it. Started and stopped by Playwright (webServer in
// playwright.config.ts); not meant to be run by hand.
//
// Next only fills variables from .env.local that are not already set, so
// setting them here keeps the real database, a configured AI Brain and Google
// sign-in out of the tests entirely. An empty AI_BRAIN_URL counts as set.
import { spawn } from "node:child_process";
import { MongoMemoryServer } from "mongodb-memory-server";

const port = process.env.E2E_PORT ?? "3100";
const mongod = await MongoMemoryServer.create();

const env = {
  ...process.env,
  MONGO_DB_URI: mongod.getUri("somniai-e2e"),
  NEXTAUTH_URL: `http://localhost:${port}`,
  NEXTAUTH_SECRET: "e2e-only-secret-never-used-outside-tests",
  AI_BRAIN_URL: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  NEXT_PUBLIC_GOOGLE_ENABLED: "false",
  NEXT_TELEMETRY_DISABLED: "1",
};

const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", port], {
  env,
  stdio: "inherit",
});

let stopping = false;
async function stop(code) {
  if (stopping) {
    return;
  }
  stopping = true;
  next.kill();
  await mongod.stop();
  process.exit(code);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
next.on("exit", (code) => stop(code ?? 1));
