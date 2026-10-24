// The app's alarm list and the phone's native schedule, end to end against the
// real server. A stand-in for the phone is put where Capacitor looks for the
// native bridge (window.androidBridge, window.Capacitor.PluginHeaders and
// nativePromise), so the page's own code runs unchanged: it keeps a schedule
// the way the plugin's reconcile does and records every call.
import { expect, test, type Page } from "@playwright/test";
import { alarmRow, signUp } from "./helpers";

type Phone = {
  calls: { id: string; hour: number; minute: number; enabled: boolean }[][];
  schedule: Record<string, { hour: number; minute: number; enabled: boolean }>;
};

/** Pretends to be the Android app. api 0 means a build from before 2.5, without version(). */
async function asPhone(page: Page, api = 2) {
  await page.addInitScript((api: number) => {
    const w = window as unknown as Record<string, unknown>;
    const phone: Phone = JSON.parse(sessionStorage.getItem("fake-phone") ?? '{"calls":[],"schedule":{}}');
    w.__phone = phone;
    const save = () => sessionStorage.setItem("fake-phone", JSON.stringify(phone));
    w.androidBridge = { postMessage: () => {} };
    const methods = ["reconcile", ...(api > 0 ? ["version"] : [])].map((name) => ({ name, rtype: "promise" }));
    w.Capacitor = {
      PluginHeaders: [{ name: "SomniAlarm", methods }],
      nativePromise: async (plugin: string, method: string, options: { alarms?: Phone["calls"][number] }) => {
        if (plugin !== "SomniAlarm") {
          throw new Error(`no ${plugin}`);
        }
        if (method === "version") {
          return { api };
        }
        const list = options.alarms ?? [];
        phone.calls.push(list);
        const removed = Object.keys(phone.schedule).filter((id) => !list.some((a) => a.id === id));
        removed.forEach((id) => delete phone.schedule[id]);
        list.forEach((a) => {
          phone.schedule[a.id] = { hour: a.hour, minute: a.minute, enabled: a.enabled };
        });
        save();
        return { put: list.map((a) => a.id), removed, unchanged: [], keptHistory: [], past: [], exactAlarm: { state: "granted", permission: null, sdk: 36 } };
      },
    };
  }, api);
}

const phoneOf = (page: Page) => page.evaluate(() => (window as unknown as { __phone: Phone }).__phone);

async function serverAlarm(page: Page, label: string) {
  const json = await (await page.request.get("/api/alarms")).json();
  return json.data.items.find((a: { label: string }) => a.label === label) as { _id: string; enabled: boolean; scheduledTime: string } | undefined;
}

/** A time in the browser's own zone, as the form takes it. */
async function inMinutes(page: Page, minutes: number) {
  return page.evaluate((m) => {
    const d = new Date(Date.now() + m * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return { input: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`, hour: d.getHours(), minute: d.getMinutes() };
  }, minutes);
}

async function addAlarm(page: Page, label: string, at: string) {
  const form = page.locator("form", { has: page.getByPlaceholder(/Alarm label/) });
  await form.getByPlaceholder(/Alarm label/).fill(label);
  await form.locator('input[type="datetime-local"]').fill(at);
  await form.getByRole("button", { name: "Add alarm" }).click();
  await expect(alarmRow(page, label)).toContainText("scheduled");
}

test("create, turn off and on, edit and delete all reach the phone, and a restart reconciles", async ({ page }) => {
  await asPhone(page);
  await signUp(page);
  await expect(page.getByText("Alarms ring from this phone")).toBeVisible({ timeout: 30_000 });

  const at = await inMinutes(page, 120);
  await addAlarm(page, "Gym", at.input);
  const id = (await serverAlarm(page, "Gym"))!._id;
  await expect.poll(async () => (await phoneOf(page)).schedule[id]).toEqual({ hour: at.hour, minute: at.minute, enabled: true });

  await page.getByRole("button", { name: "Turn off Gym" }).click();
  await expect(page.getByRole("button", { name: "Turn on Gym" })).toBeVisible();
  expect((await serverAlarm(page, "Gym"))!.enabled).toBe(false);
  await expect.poll(async () => (await phoneOf(page)).schedule[id]?.enabled).toBe(false);

  await page.getByRole("button", { name: "Turn on Gym" }).click();
  await expect.poll(async () => (await phoneOf(page)).schedule[id]?.enabled).toBe(true);

  const later = await inMinutes(page, 180);
  await page.getByRole("button", { name: "Edit time of Gym" }).click();
  await alarmRow(page, "Gym").getByLabel("New time").fill(later.input);
  await alarmRow(page, "Gym").getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await phoneOf(page)).schedule[id]).toEqual({ hour: later.hour, minute: later.minute, enabled: true });
  expect(new Date((await serverAlarm(page, "Gym"))!.scheduledTime).getHours()).toBe(later.hour);

  // App start: the page loads the server's list and hands it over again.
  const callsBefore = (await phoneOf(page)).calls.length;
  await page.reload();
  await expect(page.getByText("Alarms ring from this phone")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await phoneOf(page)).calls.length).toBeGreaterThan(callsBefore);
  expect((await phoneOf(page)).calls.at(-1)!.map((a) => a.id)).toEqual([id]);

  // The same list again (another render, no change) isn't sent twice.
  const settled = (await phoneOf(page)).calls.length;
  await page.waitForTimeout(2_000);
  expect((await phoneOf(page)).calls.length).toBe(settled);

  await alarmRow(page, "Gym").getByRole("button", { name: "Delete alarm" }).click();
  await expect(alarmRow(page, "Gym")).toHaveCount(0);
  await expect.poll(async () => Object.keys((await phoneOf(page)).schedule)).toEqual([]);
});

test("in the app, a due alarm rings from the phone only, never also in the page", async ({ page }) => {
  test.setTimeout(240_000);
  await asPhone(page);
  await signUp(page);
  await addAlarm(page, "Due now", (await inMinutes(page, 1)).input);
  // Past the due minute, plus the page's 3 s check, with room for compiling.
  await page.waitForTimeout(100_000);
  await expect(page.getByRole("button", { name: "I'm awake — verify" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check answer" })).toHaveCount(0);
});

test("an app built before this change is left alone, and says alarms ring only with the screen open", async ({ page }) => {
  await asPhone(page, 0);
  await signUp(page);
  await expect(page.getByText(/built before alarms synced to the phone/)).toBeVisible({ timeout: 30_000 });
  await addAlarm(page, "Old app", (await inMinutes(page, 120)).input);
  await page.waitForTimeout(2_000);
  expect((await phoneOf(page)).calls).toEqual([]);
});
