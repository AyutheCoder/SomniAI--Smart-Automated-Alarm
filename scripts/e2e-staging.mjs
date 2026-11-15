#!/usr/bin/env node
// The end-to-end flows against the deployed staging site (prompt 7.4, DEPLOY.md):
//   npm run e2e:staging
// Staging's address is in deploy/environments.json; its test key, which lifts
// the sign-up limit for these flows only, in .env.deploy.local. Never production.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const state = existsSync("deploy/environments.json") ? JSON.parse(readFileSync("deploy/environments.json", "utf8")) : {};
const url = state.staging?.app;
const key = existsSync(".env.deploy.local")
  ? readFileSync(".env.deploy.local", "utf8").match(/^STAGING_TEST_KEY=(.*)$/m)?.[1]?.trim()
  : undefined;
if (!url || !key) {
  console.error("e2e:staging: deploy staging first (node scripts/deploy.mjs all staging)");
  process.exit(2);
}
console.log(`e2e against ${url}`);
const res = spawnSync("npx", ["playwright", "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, E2E_BASE_URL: url, E2E_TEST_KEY: key },
});
process.exit(res.status ?? 1);
