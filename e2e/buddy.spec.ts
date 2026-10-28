// Wake buddy (prompt 3.2), in two real browser sessions: pairing takes both
// people, and either can end it. The alert itself is covered by
// tests/api/buddy.test.ts; its push needs Firebase and two phones
// (DEVICE_TESTS.md, 3.2).
import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("two people pair with consent on both sides, and either can unpair", async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await signUp(alice, "Alice");
  await signUp(bob, "Bob");

  const aliceBuddy = alice.getByRole("region", { name: "Wake buddy" });
  const bobBuddy = bob.getByRole("region", { name: "Wake buddy" });
  await aliceBuddy.getByRole("button", { name: "Get a code" }).click();
  const code = (await aliceBuddy.getByLabel("Invite code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  // Bob asks: his consent. Nothing is paired yet.
  await bobBuddy.getByLabel("Have someone's code?").fill(code.toLowerCase());
  await bobBuddy.getByRole("button", { name: "Ask to pair" }).click();
  await expect(bobBuddy).toContainText("Waiting for Alice to accept.");
  await expect(bobBuddy).not.toContainText("is your wake buddy");

  // Alice accepts: hers. Now they are buddies, both ways.
  await alice.reload();
  const request = aliceBuddy.getByRole("group", { name: "Request from Bob" });
  await expect(request).toContainText("Bob wants to be your wake buddy.");
  await request.getByRole("button", { name: "Accept" }).click();
  await expect(aliceBuddy).toContainText("Bob is your wake buddy, and you are theirs.");
  await bob.reload();
  await expect(bobBuddy).toContainText("Alice is your wake buddy, and you are theirs.");
  // In a browser there is no phone to alert, and the panel says so.
  await expect(bobBuddy.getByRole("status", { name: "Alerts on this phone" })).toContainText("open it there");

  // Bob unpairs; Alice sees it at once.
  bob.once("dialog", (d) => void d.accept());
  await bobBuddy.getByRole("button", { name: "Unpair" }).click();
  await expect(bobBuddy.getByRole("button", { name: "Get a code" })).toBeVisible();
  await alice.reload();
  await expect(aliceBuddy).not.toContainText("is your wake buddy");
});
