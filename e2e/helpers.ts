import { expect, type Page } from "@playwright/test";

export async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("E2E Sleeper");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Adaptive Alarms" })).toBeVisible({ timeout: 60_000 });
}

/** The alarm's row in the list, which is the alarm history the page shows. */
export const alarmRow = (page: Page, label: string) => page.locator("li", { hasText: label });
