// Your data (prompt 7.2): the policy and terms are public, everything can be
// downloaded, and deleting the account deletes it: afterwards it can't be
// signed into. That every record goes is tests/api/account.test.ts's job.

import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("the privacy policy, the terms and the deletion page are readable signed out", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "SomniAI privacy policy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Health Connect" })).toBeVisible();
  // This test server has no operator set: the page says so instead of hiding the gap.
  // (Next's route announcer is an alert too, an empty one.)
  await expect(page.getByRole("alert").filter({ hasText: "not set" })).toContainText("SOMNIAI_OPERATOR");
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "SomniAI terms of use" })).toBeVisible();
  await page.goto("/delete-account");
  await expect(page.getByRole("heading", { name: "Delete your SomniAI account" })).toBeVisible();
});

test("an account's data downloads as one file, and deleting the account deletes it", async ({ page }) => {
  const email = await signUp(page, "E2E Deleted");
  const made = await page.request.post("/api/alarms", { data: { label: "E2E doomed alarm", scheduledTime: new Date(Date.now() + 86_400_000).toISOString() } });
  expect(made.status()).toBe(201);
  await page.reload();

  const panel = page.getByRole("region", { name: "Your data" });
  await expect(panel).toContainText(`${email}: `);
  const download = page.waitForEvent("download");
  await panel.getByRole("link", { name: "Download all my data" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^somniai-data-\d{4}-\d{2}-\d{2}\.json$/);

  await panel.getByRole("button", { name: "Delete my account" }).click();
  await panel.getByLabel("Email to confirm").fill(email);
  await panel.getByLabel("Password to confirm").fill("not the password");
  await panel.getByRole("button", { name: "Delete everything, permanently" }).click();
  await expect(panel.getByRole("status", { name: "Account" })).toHaveText("That password isn't right.");

  await panel.getByLabel("Password to confirm").fill("e2e-password-123");
  await panel.getByRole("button", { name: "Delete everything, permanently" }).click();
  await expect(panel.getByRole("status", { name: "Account" })).toContainText("Your account and everything stored with it were deleted.");
  await expect(page).toHaveURL(/\/sign-in\?deleted=1/, { timeout: 30_000 });
  await expect(page.getByRole("status")).toHaveText("Your account and everything stored with it were deleted.");

  // It's gone: the old password signs nothing in. (Wait for the page's script first: a click
  // before it loads submits the bare form, which only reloads the page.)
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});
