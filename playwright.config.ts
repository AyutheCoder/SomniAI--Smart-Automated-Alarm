import { defineConfig, devices } from "@playwright/test";

// A port of its own, so the flows never land on a `npm run dev` you have open.
const PORT = 3100;

// Against a deployed site instead (prompt 7.4, DEPLOY.md): E2E_BASE_URL is the
// staging address, and E2E_TEST_KEY the staging-only key that exempts these
// flows from the sign-up limit (one address signs up every flow's user).
// Production is never a target: it has no such key, and real people use it.
const REMOTE = process.env.E2E_BASE_URL?.replace(/\/+$/, "");

export default defineConfig({
  testDir: "e2e",
  // The developer simulator exists only under `next dev` (prompt 4.4): nothing to test on a deployed site.
  testIgnore: REMOTE ? ["simulator.spec.ts"] : [],
  // Compiles every API route before the flows start; see e2e/warmup.ts.
  globalSetup: "./e2e/warmup.ts",
  // Each flow waits for a real alarm to come due, up to a minute. On CI the
  // two run side by side as separate users. Locally they run one at a time:
  // on an 8 GB machine two browsers plus `next dev` swapped badly enough to
  // leave sign-in pending for over 40 seconds.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  // A flow takes about two minutes: up to one waiting for the alarm, the
  // rest sign-up and the dev server compiling pages on first visit.
  timeout: 240_000,
  expect: { timeout: 15_000 },
  // A flow that needs a retry is flaky, and flaky is not done.
  retries: 0,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    baseURL: REMOTE ?? `http://localhost:${PORT}`,
    headless: true,
    trace: "retain-on-failure",
    extraHTTPHeaders: REMOTE && process.env.E2E_TEST_KEY ? { "x-somniai-test-key": process.env.E2E_TEST_KEY } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: REMOTE ? undefined : {
    command: "node e2e/serve.mjs",
    url: `http://localhost:${PORT}/sign-in`,
    env: { E2E_PORT: String(PORT) },
    // Never reuse a server that is already up: it could be pointed at Atlas.
    reuseExistingServer: false,
    // First start downloads MongoDB (once) and compiles pages on demand.
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
