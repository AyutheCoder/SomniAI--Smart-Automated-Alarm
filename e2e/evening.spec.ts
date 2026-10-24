// The evening flow in a real browser: pick a must-wake time and how much it
// matters, get a bedtime or an honest refusal, and act on it. The e2e server
// has no AI Brain, so each test supplies the planner's answer; the planner
// itself is tested against its own search in ai-brain/tests.
import { expect, test, type Page } from "@playwright/test";
import type { WakePlan } from "../lib/aiClient";
import { alarmRow, signUp } from "./helpers";

const BASE: WakePlan = {
  feasible: false, reachesTarget: false, targetReliability: 0.85, baselineReliability: 0.6,
  achievedReliability: 0.6, combinedReliability: 0.6, recommendedBedtime: null, recommendedBedtimeHour: null,
  currentBedtimeHour: 23.5, shiftMinutes: null, predictedSleepHours: null, combinedPlan: [],
  habitConstraints: [], levers: [], reliabilityCurve: [], summary: "",
};

/** Answers the planner with `plan`, and returns what the page asked it. */
async function plannerAnswers(page: Page, plan: WakePlan) {
  const asked: unknown[] = [];
  await page.route("**/api/ai/wake-plan", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { plan, source: "ai", features: {} } }),
    });
  });
  return asked;
}

test("infeasible: an honest refusal with the ceiling, the habit and a second alarm", async ({ page }) => {
  await signUp(page);
  const asked = await plannerAnswers(page, {
    ...BASE, targetReliability: 0.95, achievedReliability: 0.7, combinedReliability: 0.78,
    combinedPlan: [{ feature: "bedtime_hour", label: "Go to bed earlier", from: 23.5, to: 22, reliabilityGain: 0.08 }],
    habitConstraints: [{ feature: "alarm_response_ms", label: "Answer your first alarm", from: 19000, to: 5000, reliabilityGain: 0.28, horizon: "weeks" }],
  });

  const tonight = page.getByRole("region", { name: "Tonight" });
  await tonight.getByLabel("Must be up at").fill("06:30");
  await tonight.getByLabel("How important").selectOption({ label: "Cannot miss (95%)" });
  await tonight.getByRole("button", { name: "Plan my night" }).click();

  const refusal = tonight.getByRole("alert");
  await expect(refusal).toContainText("95% isn't reachable tonight.");
  await expect(refusal).toContainText("The most tonight's changes can reach is 78%, 17 points short.");
  await expect(refusal).toContainText("What holds it back is a habit, not tonight: answer your first alarm would be worth +28% on its own, over weeks.");
  await expect(refusal).toContainText("Set a second alarm, ideally on another device");
  expect(asked).toEqual([{ requiredReliability: 0.95, wakeTime: "06:30" }]);

  await refusal.getByRole("button", { name: "Add a backup alarm at 06:40" }).click();
  await expect(tonight.getByRole("status")).toContainText("Backup alarm set for 06:40.");
  await expect(alarmRow(page, "Backup for 06:30")).toContainText("scheduled");
});

test("feasible: the latest bedtime, a reminder that fires at it, and the alarm", async ({ page }) => {
  // A stand-in for the browser's notifications, recording what the page shows.
  await page.addInitScript(() => {
    const w = window as unknown as { __notifications: { title: string; body?: string }[] };
    w.__notifications = [];
    class RecordingNotification {
      static permission: NotificationPermission = "default";
      static async requestPermission() {
        RecordingNotification.permission = "granted";
        return "granted" as const;
      }
      constructor(title: string, options?: NotificationOptions) {
        w.__notifications.push({ title, body: options?.body });
      }
    }
    (window as unknown as { Notification: unknown }).Notification = RecordingNotification;
  });
  // A controllable clock, so the test can move to bedtime instead of waiting.
  await page.clock.install({ time: new Date() });
  await signUp(page);

  // Tonight, as the browser sees it: up in 8 hours, bedtime in 20 minutes,
  // in the planner's hours-past-the-previous-midnight form.
  const t = await page.evaluate(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const wake = new Date(now.getTime() + 8 * 3_600_000);
    wake.setSeconds(0, 0);
    const bed = new Date(now.getTime() + 20 * 60_000);
    bed.setSeconds(0, 0);
    const midnight = new Date(wake);
    midnight.setHours(0, 0, 0, 0);
    return {
      wakeTime: `${pad(wake.getHours())}:${pad(wake.getMinutes())}`,
      bedtime: `${pad(bed.getHours())}:${pad(bed.getMinutes())}`,
      bedtimeHour: (bed.getTime() - midnight.getTime()) / 3_600_000 + 24,
    };
  });
  await plannerAnswers(page, {
    ...BASE, feasible: true, reachesTarget: true, achievedReliability: 0.86, combinedReliability: 0.86,
    recommendedBedtime: t.bedtime, recommendedBedtimeHour: t.bedtimeHour, shiftMinutes: 60, predictedSleepHours: 7.5,
  });

  const tonight = page.getByRole("region", { name: "Tonight" });
  await tonight.getByLabel("Must be up at").fill(t.wakeTime);
  await tonight.getByRole("button", { name: "Plan my night" }).click();
  await expect(tonight).toContainText(new RegExp(`The latest bedtime that still reaches 85%:\\s*Asleep by\\s*${t.bedtime}`));
  await expect(tonight).not.toContainText("isn't reachable");

  await tonight.getByRole("button", { name: `Remind me at ${t.bedtime}` }).click();
  await expect(tonight.getByRole("status")).toContainText(`You'll get a notification at ${t.bedtime}`);
  await tonight.getByRole("button", { name: `Set my ${t.wakeTime} alarm` }).click();
  await expect(alarmRow(page, `Must be up at ${t.wakeTime}`)).toContainText("scheduled");

  // Nothing yet; then bedtime comes.
  await expect(page.getByRole("alert", { name: "Bedtime reminder" })).toHaveCount(0);
  await page.clock.fastForward(21 * 60_000);
  await expect(page.getByRole("alert", { name: "Bedtime reminder" }))
    .toContainText(`Time for bed: asleep by ${t.bedtime} for your ${t.wakeTime} wake.`);
  const shown = await page.evaluate(() => (window as unknown as { __notifications: unknown[] }).__notifications);
  expect(shown).toEqual([{ title: "Time for bed", body: `Asleep by ${t.bedtime} for your ${t.wakeTime} wake.` }]);
});
