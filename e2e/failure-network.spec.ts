// Failure mode 3 of 3 (prompt 7.3), in a real browser: the network is lost
// mid-request. Each of the ring's results reaches the server, which records
// it, and then the connection drops before the answer comes back. The alarm
// must ring and stop regardless, the page must say its updates are waiting,
// and once the network is back the outbox's resends must not record the ring
// twice (lib/idempotency.ts).
import { expect, test } from "@playwright/test";
import { addAlarmOneMinuteAhead, alarmStatus, SERVER, signUp, solveSums, waitForRingAndOpenChallenge } from "./helpers";

test("network lost mid-request: the alarm rings and stops, the page says so, and nothing is recorded twice", async ({ page }) => {
  const label = `Lost ${Date.now()}`;
  await signUp(page, "E2E Lost Network");
  await addAlarmOneMinuteAhead(page, label);

  // From here on, the first send of every ring result is done by the server and its answer lost.
  const lost = new Set<string>();
  await page.route(/\/api\/alarms\/[^/]+\/(fire|verify|escalate|dismiss|snooze)$/, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!lost.has(path)) {
      lost.add(path);
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await waitForRingAndOpenChallenge(page);
  await solveSums(page);
  await expect(page.getByText("You're awake — good morning!")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check answer" })).toBeHidden({ timeout: 15_000 });

  // The page says what's going on rather than failing quietly or crashing.
  await expect(page.getByRole("status", { name: "Sync status" })).toContainText(/waiting to reach the server|Can't reach the server right now/);

  // The outbox retries (every 15 s); this time the answers arrive.
  await expect.poll(() => alarmStatus(page, label), { timeout: 60_000 }).toBe("verified");
  await expect(page.getByRole("status", { name: "Sync status" })).toBeHidden(SERVER);
  expect(lost.size).toBeGreaterThan(0);

  // Every result the server did twice-asked is recorded once.
  const alarms = await (await page.request.get("/api/alarms")).json();
  const id = alarms.data.items.find((a: { label: string }) => a.label === label)._id;
  for (const type of ["alarm_fire", "dismiss"]) {
    const events = await (await page.request.get(`/api/events?type=${type}&limit=500`)).json();
    const mine = events.data.items.filter((e: { meta?: { alarmId?: string } }) => e.meta?.alarmId === id);
    expect(mine, `${type} events for the alarm`).toHaveLength(1);
  }
});

test("an answer the page can't use breaks only its panel: said, reported, and the alarms keep working", async ({ page }) => {
  // The telemetry summary comes back mangled (a half-delivered or wrong answer).
  await page.route("**/api/telemetry", (route) => (route.request().method() === "GET"
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: {} }) })
    : route.continue()));
  const reported = page.waitForRequest((r) => r.url().endsWith("/api/errors") && r.method() === "POST");
  await signUp(page, "E2E Broken Panel");

  const broken = page.getByRole("alert", { name: "Alarm telemetry failed" });
  await expect(broken).toContainText("Alarm telemetry ran into a problem and couldn't be shown. It has been reported.");
  const report = JSON.parse((await reported).postData() ?? "{}");
  expect(report).toMatchObject({ kind: "TypeError" });

  // Everything else still works: an alarm can be set, and the other panels are there.
  await addAlarmOneMinuteAhead(page, `Still works ${Date.now()}`);
  await expect(page.getByRole("region", { name: "Your data" })).toBeVisible();
});
