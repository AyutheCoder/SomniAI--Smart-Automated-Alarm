// Wake buddy (prompt 3.2), in two real browser sessions: pairing takes both
// people, and either can end it. The alert itself is covered by
// tests/api/buddy.test.ts; its push needs Firebase and two phones
// (DEVICE_TESTS.md, 3.2).
import { expect, test } from "@playwright/test";
import { alarmRow, signUp } from "./helpers";

// Found in the two-device test: the form had no way to make an alarm critical,
// so a hand-made alarm could never alert a buddy.
test("the alarm form can make an alarm critical, which is what alerts a buddy", async ({ page }) => {
  await signUp(page);
  const form = page.locator("form", { has: page.getByPlaceholder(/Alarm label/) });
  const at = await page.evaluate(() => {
    const d = new Date(Date.now() + 3 * 3_600_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  for (const [label, critical] of [["Ordinary one", false], ["Exam", true]] as const) {
    await form.getByPlaceholder(/Alarm label/).fill(label);
    await form.locator('input[type="datetime-local"]').fill(at);
    await form.getByLabel("Critical: must not miss").setChecked(critical);
    await form.getByRole("button", { name: "Add alarm" }).click();
    await expect(alarmRow(page, label)).toContainText("scheduled");
  }
  const alarms = (await (await page.request.get("/api/alarms")).json()).data.items as
    { label: string; minConfidence: number; verificationRequired: boolean; ringPlan: { critical: boolean } }[];
  const byLabel = Object.fromEntries(alarms.map((a) => [a.label, a]));
  expect(byLabel.Exam).toMatchObject({ minConfidence: 85, verificationRequired: true, ringPlan: { critical: true } });
  expect(byLabel["Ordinary one"].ringPlan.critical).toBe(false);
});

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

test("an emergency contact needs their agreement, and can be removed", async ({ page }) => {
  await signUp(page);
  const form = page.getByRole("form", { name: "Emergency contact" });
  await form.getByLabel("Contact's name").fill("Mum");
  await form.getByLabel("Contact's number").fill("+91 98765 43210");
  await form.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByRole("region", { name: "Wake buddy" }).getByRole("alert")).toContainText("agreed");

  await form.getByLabel("They've agreed to get these texts from SomniAI.").check();
  await form.getByRole("button", { name: "Save contact" }).click();
  await expect(form.getByRole("button", { name: "Remove" })).toBeVisible();
  // No Twilio in the e2e server: the panel says texts wouldn't be sent, rather than pretend.
  await expect(form).toContainText("Texts aren't set up on this server yet");
  await page.reload();
  await expect(form.getByLabel("Contact's number")).toHaveValue("+919876543210");

  await form.getByRole("button", { name: "Remove" }).click();
  await expect(form.getByRole("button", { name: "Remove" })).toBeHidden();
});
