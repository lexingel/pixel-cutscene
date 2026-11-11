import { expect, test } from "@playwright/test";
import { openFixture } from "./fixture";

test("dialogue: write the scene as text, apply, and the lines land one after another as bubbles and voice lines", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await page.getByTestId("drawer").getByRole("button", { name: "hero", exact: true }).click(); // hero 1, hero 2
  await page.getByRole("button", { name: "Dialogue" }).click();
  const dlg = page.getByRole("dialog", { name: "Dialogue" });
  await dlg.getByRole("button", { name: "Write as text" }).click();
  await dlg.getByLabel("Dialogue as text").fill("hero 1: We rest here.\nwizard: Boo");
  await dlg.getByRole("button", { name: "Back to the list" }).click();
  await expect(dlg.getByRole("alert")).toContainText('Line 2: nobody called "wizard"');
  await dlg.getByLabel("Dialogue as text").fill("hero 1: We rest here.\nhero 2: Something moves.");
  await dlg.getByRole("button", { name: "Back to the list" }).click();
  await expect(dlg.getByLabel("Line 2", { exact: true })).toHaveValue("Something moves.");
  await dlg.getByLabel("Line 2 is spoken").check();
  const t1 = Number(await dlg.getByLabel("Line 1 starts at").inputValue());
  const t2 = Number(await dlg.getByLabel("Line 2 starts at").inputValue());
  expect(t2).toBeGreaterThan(t1 + 2); // the second starts after the first is read
  await dlg.getByRole("button", { name: "Apply" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator(".track", { has: page.locator(".track-label[data-actor=hero1]") }).locator(".clip", { hasText: "We rest here." })).toHaveCount(1);
  await expect(page.locator(".clip.voice", { hasText: "Something moves." })).toHaveCount(1);
  await page.keyboard.press("Control+z"); // one undo step
  await expect(page.locator(".clip", { hasText: "We rest here." })).toHaveCount(0);
  await expect(page.locator(".clip.voice")).toHaveCount(0);
});
