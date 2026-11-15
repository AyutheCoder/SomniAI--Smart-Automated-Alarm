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

  // Context through the dev-only API: everything made up is labelled simulated. Its first call
  // waits behind next dev rebuilding after the dev-only page compiled (the route itself answers
  // in under 3 s cold, 0.3 s warm), so up to a minute.
  await page.getByRole("button", { name: "Generate (simulated)" }).click();
  await expect(page.getByText("Context snapshot saved")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("simulated", { exact: true }).first()).toBeVisible();

  // And the app's own panel says it isn't used for predictions.
  await page.goto("/");
  const wearable = page.getByRole("region", { name: "Data sources" }).getByRole("listitem").filter({ hasText: "Wearable" });
  // Opening the dev-only /simulator makes next dev rebuild shared modules, and each API route the
  // home page calls then compiles again on its next request; on a slow machine that passes 15 s.
  await expect(wearable).toContainText("Simulated: not used for predictions", { timeout: 60_000 });
});
