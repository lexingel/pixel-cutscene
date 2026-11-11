import { expect, test } from "@playwright/test";

// A newcomer with no sprites and no keys: the starter pack and the getting-started card get them to a first move.
test("starter pack: no sprites, no keys, still a scene with a background and characters", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await expect(page.getByLabel("Scene size")).toHaveValue("1"); // medium by default
  await page.getByRole("button", { name: "Use the starter pack" }).click();
  await expect(page.locator(".toast")).toContainText("knight");
  await expect(page.getByRole("button", { name: "Use the starter pack" })).toBeHidden(); // once is enough
  await expect(page.getByLabel("Scene size")).toHaveValue("0"); // the pack is drawn for 320x180
  await page.getByRole("button", { name: "Write it myself" }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");

  await page.getByTitle("Shot 1 · wide").click();
  await expect(page.getByLabel("Background", { exact: true })).toHaveValue("dusk"); // not a black stage

  const guide = page.getByRole("region", { name: "Getting started" });
  await expect(guide).toBeVisible();
  await expect(guide.locator("li.done")).toHaveCount(0);
  await page.getByTestId("drawer").getByRole("button", { name: "knight", exact: true }).click();
  await expect(guide.locator("li.done")).toHaveCount(1); // a character is in
  await expect(page.getByLabel("Y", { exact: true })).toHaveValue("168"); // standing on the ground, not in the sky
  await page.getByRole("button", { name: "Add a move for knight" }).click();
  await page.getByRole("menuitem", { name: "Look around" }).click();
  await expect(guide.locator("li.done")).toHaveCount(2); // it does something
  await page.screenshot({ path: "test-results/starter-guide-1280x800.png" });
  await guide.getByRole("button", { name: "Got it" }).click();
  await expect(guide).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await expect(page.getByRole("region", { name: "Getting started" })).toBeHidden(); // dismissed for good
});
