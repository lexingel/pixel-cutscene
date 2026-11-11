import { expect, test } from "@playwright/test";
import { openFixture } from "./fixture";

test("+ Shot: a dissolve between two shots and a hit-stop on the Time row, both editable and undoable", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  const ruler = page.locator(".track.ruler .lane");
  const rb = (await ruler.boundingBox())!;
  await ruler.click({ position: { x: rb.width * 0.4, y: rb.height / 2 } }); // the playhead to 40% of the scene
  const shot = page.getByRole("button", { name: /\+ Shot/ });
  await shot.click();
  await page.getByRole("menuitem", { name: "Cut here" }).click();
  await shot.click();
  await page.getByRole("menuitem", { name: "Dissolve in from the shot before" }).click();
  await expect(page.getByLabel("Comes in by")).toHaveValue("dissolve");
  await expect(page.getByLabel("Comes in over (s)")).toHaveValue("0.5");
  await expect(page.locator(".clip.time")).toHaveCount(0); // no Time row until there is a time effect
  await shot.click();
  await page.getByRole("menuitem", { name: /^Hit-stop here/ }).click();
  await expect(page.locator(".clip.time", { hasText: "Hit-stop" })).toHaveCount(1);
  await expect(page.getByLabel("Length (s)", { exact: true })).toHaveValue("0.1");
  await shot.click();
  await page.getByRole("menuitem", { name: /^Slow motion here/ }).click();
  await expect(page.getByRole("alert").or(page.locator(".toast")).first()).toContainText("overlap");
  await page.screenshot({ path: "test-results/d2-time-row.png" });
  await page.keyboard.press("Control+z");
  await expect(page.locator(".clip.time")).toHaveCount(0);
});
