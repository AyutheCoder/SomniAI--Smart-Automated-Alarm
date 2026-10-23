// The core promise, end to end in a real browser: an alarm set a minute ahead
// rings, and only a correct answer turns it off.
import { expect, test, type Page } from "@playwright/test";

const RING_TIMEOUT = 100_000; // due within a minute, polled every 3s, plus compile time
/** How long to wait for the page's background requests to reach the server. */
const SERVER = { timeout: 30_000 };

async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("E2E Sleeper");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Adaptive Alarms" })).toBeVisible({ timeout: 60_000 });
}

/** The alarm's row in the list, which is the alarm history the page shows. */
const alarmRow = (page: Page, label: string) => page.locator("li", { hasText: label });

async function addAlarmOneMinuteAhead(page: Page, label: string, strategy?: "gentle" | "adaptive" | "aggressive") {
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
}

async function waitForRingAndOpenChallenge(page: Page) {
  const verify = page.getByRole("button", { name: "I'm awake — verify" });
  const challenge = page.getByRole("button", { name: "Check answer" });
  // The ladder can move to the challenge on its own, so accept either view.
  await expect(verify.or(challenge)).toBeVisible({ timeout: RING_TIMEOUT });
  if (await verify.isVisible()) {
    await verify.click();
  }
  await expect(challenge).toBeVisible();
}

async function readProblem(page: Page): Promise<number> {
  const text = await page.getByText(/^\d+ × \d+ = \?$/).textContent();
  const [, a, b] = /(\d+) × (\d+)/.exec(text ?? "") ?? [];
  expect(a, `could not read the maths problem from "${text}"`).toBeTruthy();
  return Number(a) * Number(b);
}

async function alarmStatus(page: Page, label: string): Promise<string | undefined> {
  const res = await page.request.get("/api/alarms");
  const json = await res.json();
  return json.data.items.find((a: { label: string }) => a.label === label)?.status;
}

test("an alarm a minute ahead rings, and solving the maths turns it off", async ({ page }) => {
  const label = `Exam ${Date.now()}`;
  await signUp(page);
  await addAlarmOneMinuteAhead(page, label);

  await waitForRingAndOpenChallenge(page);
  await page.getByPlaceholder("Answer").fill(String(await readProblem(page)));
  await page.getByRole("button", { name: "Check answer" }).click();

  await expect(page.getByText("You're awake — good morning!")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check answer" })).toBeHidden({ timeout: 15_000 });

  // The overlay closes at once; the verify and dismiss requests follow it.
  // Once they land, the server (not the page) has the alarm as verified, and
  // the history shows it, including after a reload.
  await expect.poll(() => alarmStatus(page, label), SERVER).toBe("verified");
  await expect(alarmRow(page, label)).toContainText("verified");
  await page.reload();
  await expect(alarmRow(page, label)).toContainText("verified");
});

test("a wrong answer does not turn the alarm off, and unset backups say so", async ({ page }) => {
  const label = `Flight ${Date.now()}`;
  await signUp(page);
  // Aggressive reaches the backup level 40s into the ring.
  await addAlarmOneMinuteAhead(page, label, "aggressive");

  await waitForRingAndOpenChallenge(page);
  const wrong = (await readProblem(page)) + 1;
  await page.getByPlaceholder("Answer").fill(String(wrong));
  await page.getByRole("button", { name: "Check answer" }).click();

  await expect(page.getByText("Incorrect — try again.")).toBeVisible();
  // The alarm rings without waiting on the server; wait for the fire to land.
  await expect.poll(() => alarmStatus(page, label), SERVER).toBe("ringing");
  // Still ringing a while later: the challenge is up and nothing was dismissed.
  await page.waitForTimeout(5_000);
  await expect(page.getByRole("button", { name: "Check answer" })).toBeVisible();
  expect(await alarmStatus(page, label)).toBe("ringing");

  const events = await (await page.request.get("/api/events")).json();
  const types = events.data.items.map((e: { type: string }) => e.type);
  expect(types).toContain("alarm_fire");
  expect(types).not.toContain("dismiss");
  expect(types).not.toContain("verify_pass");

  // Still unanswered at the last level: the backups are tried, and since none
  // is set up, each one says exactly that and nothing claims to have fired.
  const backups = page.getByRole("region", { name: "Backup channels" });
  await expect(backups.getByRole("listitem")).toHaveText(
    ["Second device: not set up", "Smartwatch: not set up", "Emergency contact: not set up"],
    { timeout: 60_000 },
  );
  await expect(page.getByText(/\bsent\b|activated|triggered/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check answer" })).toBeVisible();
});
