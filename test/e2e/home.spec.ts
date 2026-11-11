import { expect, test } from "@playwright/test";

test("delete asks first, then removes the project", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await expect(page).toHaveURL(/#\/p\//); // the app opens it once saved; leaving earlier races that
  await page.goto("/#");
  const row = page.locator(".projects li", { hasText: "Untitled cutscene" });
  await row.getByRole("button", { name: "Delete" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toContainText(`Delete "Untitled cutscene"? This can't be undone. Download the zip first if you want to keep it.`);
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".projects li")).toHaveText("Nothing yet. Projects you make are kept in this browser.");
});

test("the sample opens once", async ({ page }) => {
  await page.goto("/");
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Open the sample" }).click();
    await expect(page).toHaveURL(/#\/p\//);
    await page.goto("/#");
    await expect(page.getByRole("button", { name: "Open the sample" })).toBeVisible();
  }
  await expect(page.locator(".projects li")).toHaveCount(1);
  await expect(page.locator(".projects li strong")).toHaveText("Sample: campfire at dusk");
  await expect(page.locator(".toast", { hasText: "(copy)" })).toHaveCount(0);
});

test("duplicate makes an independent copy", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await expect(page).toHaveURL(/#\/p\//); // the app opens it once saved; leaving earlier races that
  await page.goto("/#");
  await page.locator(".projects li", { hasText: "Untitled cutscene" }).getByRole("button", { name: "Duplicate" }).dblclick(); // one copy even so
  const copy = page.locator(".projects li", { hasText: "Untitled cutscene copy" });
  await expect(copy).toHaveCount(1);
  await expect(page.locator(".projects li")).toHaveCount(2);
  await copy.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".projects li", { hasText: "Untitled cutscene" })).toHaveCount(1); // the original stays
});
