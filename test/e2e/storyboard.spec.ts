import { expect, test } from "@playwright/test";
import { openFixture } from "./fixture";

test("storyboard: shot pictures in order, an arrow moves a shot with its contents, a click jumps there", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  const ruler = page.locator(".track.ruler .lane");
  const rb = (await ruler.boundingBox())!;
  await ruler.click({ position: { x: rb.width * 0.4, y: rb.height / 2 } });
  await page.getByRole("button", { name: /\+ Shot/ }).click();
  await page.getByRole("menuitem", { name: "Cut here" }).click();
  await page.getByRole("button", { name: "Storyboard" }).click();
  const dlg = page.getByRole("dialog", { name: "Storyboard" });
  await expect(dlg.locator(".sb-card")).toHaveCount(2);
  await expect(dlg.locator(".sb-card").first()).toContainText("0.0s–2.0s");
  await page.screenshot({ path: "test-results/g3-storyboard.png" });
  await dlg.getByRole("button", { name: /later$/ }).first().click();
  await expect(dlg.locator(".sb-card").first()).toContainText("0.0s–3.0s"); // the long shot now comes first
  await dlg.locator(".sb-card").nth(1).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByTestId("timecode")).toContainText("00:03.00");
  await page.keyboard.press("Control+z");
  await page.getByRole("button", { name: "Storyboard" }).click();
  await expect(dlg.locator(".sb-card").first()).toContainText("0.0s–2.0s"); // one undo step puts it back
});
