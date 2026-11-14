// The developer simulator (prompt 4.4) exists only under `next dev`, which is
// what the e2e server runs. Production builds don't have it: `npm run verify`
// fails if one does, and tests/simulator-guard.test.ts checks no production
// module imports a simulator. Here: it still works where it's meant to.

import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("the developer simulator opens under next dev, and labels what it makes up", async ({ page }) => {
  await signUp(page, "E2E Developer");
  await expect(page.getByRole("link", { name: "Simulator" })).toBeVisible();

  await page.goto("/simulator");
  await expect(page.getByRole("heading", { name: "Behavior Simulator" })).toBeVisible();

  // Context through the dev-only API: everything made up is labelled simulated.
  await page.getByRole("button", { name: "Generate (simulated)" }).click();
  await expect(page.getByText("Context snapshot saved")).toBeVisible();
  await expect(page.getByText("simulated", { exact: true }).first()).toBeVisible();

  // And the app's own panel says it isn't used for predictions.
  await page.goto("/");
  const wearable = page.getByRole("region", { name: "Data sources" }).getByRole("listitem").filter({ hasText: "Wearable" });
  await expect(wearable).toContainText("Simulated: not used for predictions");
});
