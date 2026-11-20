import { expect, type Page } from "@playwright/test";
import { SUMS } from "../lib/mathChallenge";

/**
 * Against a deployed site (npm run e2e:staging, prompt 7.4), which has what
 * production has: an AI Brain, Google and Twilio. The local e2e server has
 * none of them on purpose, so each flow expects what its environment has.
 */
export const DEPLOYED = Boolean(process.env.E2E_BASE_URL);

/**
 * A GET of the test's own (the page's session, outside the page). Against a
 * deployed site, the request client reuses a kept-alive connection the host
 * may have closed while a flow waited a minute for its alarm; that shows as
 * ECONNRESET with nothing wrong in the app. A GET is safe to send again, so a
 * dropped connection is retried once; any other failure is the test's result.
 */
export async function getJson(page: Page, path: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let attempt = 0; ; attempt++) {
    try {
      return await (await page.request.get(path)).json();
    }
    catch (e) {
      if (attempt > 0 || !/ECONNRESET|socket hang up|EPIPE/.test(String(e))) {
        throw e;
      }
    }
  }
}

/** Signs up a new account and waits for the home page; returns its email address. */
export async function signUp(page: Page, name = "E2E Sleeper"): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Adaptive Alarms" })).toBeVisible({ timeout: 60_000 });
  return email;
}

/** The alarm's row in the list, which is the alarm history the page shows. */
export const alarmRow = (page: Page, label: string) => page.locator("li", { hasText: label });

// The ring, as alarm.spec.ts and failure-network.spec.ts drive it.
export const RING_TIMEOUT = 100_000; // due within a minute, polled every 3s, plus compile time
/** How long to wait for the page's background requests to reach the server. */
export const SERVER = { timeout: 30_000 };


export async function addAlarmOneMinuteAhead(page: Page, label: string, strategy?: "gentle" | "adaptive" | "aggressive") {
  // The browser's own clock and time zone, as the form uses them.
  const at = await page.evaluate(() => {
    const d = new Date(Date.now() + 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const form = page.locator("form", { has: page.getByPlaceholder(/Alarm label/) });
  await form.getByPlaceholder(/Alarm label/).fill(label);
  await form.locator('input[type="datetime-local"]').fill(at);
  if (strategy) {
    await form.locator("select").selectOption(strategy);
  }
  await form.getByRole("button", { name: "Add alarm" }).click();
  await expect(alarmRow(page, label)).toContainText("scheduled");
  // The plan says who made it: the AI Brain where there is one, else the rules.
  await expect(alarmRow(page, label)).toContainText(DEPLOYED ? "plan: AI Brain" : "plan: rule-based");
}

export async function waitForRingAndOpenChallenge(page: Page) {
  const verify = page.getByRole("button", { name: "I'm awake — verify" });
  const challenge = page.getByRole("button", { name: "Check answer" });
  // The ladder can move to the challenge on its own, so accept either view.
  await expect(verify.or(challenge)).toBeVisible({ timeout: RING_TIMEOUT });
  if (await verify.isVisible()) {
    await verify.click();
  }
  await expect(challenge).toBeVisible();
}

/** Reads the sum on screen ("4 × 7 + 6 × 9 = ?") and works out its answer. */
export async function readProblem(page: Page): Promise<number> {
  const text = await page.getByText(/^\d+ × \d+ \+ \d+ × \d+ = \?$/).textContent();
  const [, a, b, c, d] = /(\d+) × (\d+) \+ (\d+) × (\d+)/.exec(text ?? "") ?? [];
  expect(a, `could not read the sum from "${text}"`).toBeTruthy();
  return Number(a) * Number(b) + Number(c) * Number(d);
}

/** Solves every sum in a row; the alarm rings until the last. */
export async function solveSums(page: Page) {
  for (let sum = 1; sum <= SUMS; sum++) {
    await expect(page.getByText(`Sum ${sum} of ${SUMS}`)).toBeVisible();
    await page.getByPlaceholder("Answer").fill(String(await readProblem(page)));
    await page.getByRole("button", { name: "Check answer" }).click();
  }
}

export async function alarmStatus(page: Page, label: string): Promise<string | undefined> {
  const json = await getJson(page, "/api/alarms");
  return json.data.items.find((a: { label: string }) => a.label === label)?.status;
}
