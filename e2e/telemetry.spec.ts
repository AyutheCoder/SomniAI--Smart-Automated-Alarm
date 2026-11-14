// Alarm telemetry from the browser (prompt 5.1): off until allowed, with the
// text in front of the user; then stop, download and delete. Recording itself
// is the phone's (WakeTelemetryTest, RingServiceTest, DEVICE_TESTS.md).

import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("telemetry is off until allowed, and can be stopped, downloaded and deleted", async ({ page }) => {
  await signUp(page, "E2E Telemetry");
  const panel = page.getByRole("region", { name: "Alarm telemetry" });
  await expect(panel).toContainText("off");
  await expect(panel).toContainText("Off. Nothing is recorded.");
  // What would be recorded is shown before anything is allowed.
  await expect(panel).toContainText("how many times you snoozed");
  await expect(panel).toContainText("Nothing is recorded until you allow it.");

  await panel.getByRole("button", { name: "Allow telemetry" }).click();
  await expect(panel.getByRole("status", { name: "Telemetry" })).toHaveText(
    "Telemetry is on. It starts with the next alarm that rings in the SomniAI Android app.");
  await expect(panel).toContainText("0 wakes recorded.");

  const download = page.waitForEvent("download");
  await panel.getByRole("link", { name: "Download everything" }).click();
  expect((await download).suggestedFilename()).toMatch(/^somniai-telemetry-\d{4}-\d{2}-\d{2}\.json$/);

  await panel.getByRole("button", { name: "Delete everything" }).click();
  await expect(panel).toContainText("Delete 0 recorded wakes? This can't be undone.");
  await panel.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(panel.getByRole("status", { name: "Telemetry" })).toHaveText("Deleted 0 recorded wakes.");

  await panel.getByRole("button", { name: "Stop recording" }).click();
  await expect(panel.getByRole("status", { name: "Telemetry" })).toHaveText(
    "Telemetry is off. Nothing more is recorded. What was already recorded stays until you delete it.");
});
