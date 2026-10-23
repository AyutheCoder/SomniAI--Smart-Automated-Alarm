import { defineConfig, devices } from "@playwright/test";

// A port of its own, so the flows never land on a `npm run dev` you have open.
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
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
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
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
