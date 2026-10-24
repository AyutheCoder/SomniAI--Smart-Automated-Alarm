// The core promise, end to end in a real browser: an alarm set a minute ahead
// rings, and only a correct answer turns it off.
import { expect, test, type Page } from "@playwright/test";
import { forbiddenWordingIn } from "../lib/predictionCopy";
import { alarmRow, signUp } from "./helpers";

const RING_TIMEOUT = 100_000; // due within a minute, polled every 3s, plus compile time
/** How long to wait for the page's background requests to reach the server. */
const SERVER = { timeout: 30_000 };


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
  // No AI Brain in the e2e server, so the plan is rule-based and says so.
  await expect(alarmRow(page, label)).toContainText("plan: rule-based");
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

  // A new user with no location permission: nothing is connected, and the
  // page says so rather than showing made-up context.
  const sources = page.getByRole("region", { name: "Data sources" }).getByRole("listitem");
  await expect(sources).toHaveText([
    /Sleep log\s*not connected\s*No nights logged yet/,
    /Weather\s*not connected\s*Not connected: allow location for live weather\s*Use my location/,
    /Calendar\s*not connected\s*Not connected/,
    /Wearable\s*not connected\s*Not connected/,
  ]);

  // Predictions name what they measure, where they came from, and how far to
  // trust them; nothing on the page claims more.
  const insights = page.getByRole("region", { name: "Sleep score and coaching" });
  await expect(insights).toContainText("Wake-time regularity", { timeout: 30_000 });
  await expect(insights).toContainText("Predictions from Fallback rules · rough estimate.");
  await expect(insights).toContainText("Coaching from Fallback rules · rule-based advice.");
  expect(forbiddenWordingIn(await page.locator("body").innerText())).toEqual([]);

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
  // Still ringing a while later: the challenge is up and nothing was dismissed.
  await page.waitForTimeout(5_000);
  await expect(page.getByRole("button", { name: "Check answer" })).toBeVisible();
  await expect(alarmRow(page, label)).toContainText("ringing");

  // Since 1.4 the server is told nothing while the alarm rings (it used to get
  // a "fire" call here): its record is untouched and it has no events at all,
  // so certainly no dismissal or passed wake check.
  expect(await alarmStatus(page, label)).toBe("scheduled");
  const events = await (await page.request.get("/api/events")).json();
  expect(events.data.items).toEqual([]);

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

test("with the database down at ring time, the alarm still rings and is dismissed, then syncs", async ({ page }) => {
  const label = `Interview ${Date.now()}`;
  // Records each fetch/XHR to /api, with whether the ringing screen was on
  // screen at that exact moment. Installed before any page script runs.
  await page.addInitScript(() => {
    const w = window as unknown as { __apiCalls: { path: string; ringing: boolean }[] };
    w.__apiCalls = [];
    const note = (url: string) => {
      const path = new URL(url, location.href).pathname;
      if (path.startsWith("/api/")) {
        w.__apiCalls.push({
          path,
          ringing: document.documentElement.dataset.ringing === "true" || document.querySelector("[data-ringing]") !== null,
        });
      }
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      note(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return realFetch(input, init);
    };
    const realOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      note(String(url));
      return (realOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;
  });
  await signUp(page);
  await addAlarmOneMinuteAhead(page, label);

  // The database goes down. Every API route then answers 503, as the routes do
  // when Mongo is unreachable; sign-in uses a token, not the database, so it
  // keeps working.
  const dataApi = (url: URL) => /^\/api\/(?!auth\/)/.test(url.pathname);
  await page.route(dataApi, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: "The database is unavailable. Please try again shortly." }),
  }));

  // Even a reload during the outage still knows the alarm, from this device.
  await page.reload();
  const sync = page.getByRole("status", { name: "Sync status" });
  await expect(sync).toContainText("Can't reach the server right now. Alarms still ring from this device.");
  await expect(alarmRow(page, label)).toContainText("scheduled");

  await waitForRingAndOpenChallenge(page);
  await page.getByPlaceholder("Answer").fill(String(await readProblem(page)));
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText("You're awake — good morning!")).toBeVisible();
  await expect(page.locator("[data-ringing]")).toHaveCount(0, { timeout: 15_000 });

  // Every API call the page made, and whether the ringing screen was up at
  // that moment: none may have been, and the outcome is only sent afterwards.
  const calls = await page.evaluate(() => (window as unknown as { __apiCalls: { path: string; ringing: boolean }[] }).__apiCalls);
  const duringRing = calls.filter((c) => c.ringing && !c.path.startsWith("/api/auth/"));
  expect(duringRing, "API calls made while the alarm was ringing").toEqual([]);
  await expect.poll(async () => (await page.evaluate(() =>
    (window as unknown as { __apiCalls: { path: string }[] }).__apiCalls.map((c) => c.path))).some((p) => p.endsWith("/fire")))
    .toBe(true);

  // Dismissed on the device; the server is still unreachable, so the outcome waits.
  await expect(alarmRow(page, label)).toContainText("dismissed");
  await expect(sync).toContainText(/alarm updates? (is|are) waiting to reach the server/);

  // The database is back: the waiting updates go through on their own, and
  // the server, which scores the wake check itself, records it as verified.
  await page.unroute(dataApi);
  await expect.poll(() => alarmStatus(page, label), { timeout: 45_000 }).toBe("verified");
  await expect(alarmRow(page, label)).toContainText("verified", { timeout: 20_000 });
  await expect(sync).toBeHidden();
});

test("an alarm set while the alarm list is still loading survives the late load", async ({ page }) => {
  const label = `Dentist ${Date.now()}`;
  await signUp(page);

  // Let the page's next alarm-list load reach the server now, but hold its
  // answer back, as a slow network would. (Holding the request instead would
  // let the server answer after the new alarm exists, which is no race.)
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heldOnce = false;
  await page.route("**/api/alarms", async (route) => {
    if (route.request().method() === "GET" && !heldOnce) {
      heldOnce = true;
      const answer = await route.fetch();
      await held;
      await route.fulfill({ response: answer });
      return;
    }
    await route.continue();
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Adaptive Alarms" })).toBeVisible();

  // Set an alarm while that load is still out.
  await addAlarmOneMinuteAhead(page, label);
  expect(heldOnce).toBe(true);

  // The old answer arrives after the new alarm. The alarm must stay.
  const loaded = page.waitForResponse((r) => r.url().endsWith("/api/alarms") && r.request().method() === "GET");
  release();
  await loaded;
  await page.waitForTimeout(2_000);
  await expect(alarmRow(page, label)).toContainText("scheduled");
});
