import { expect, test } from "@playwright/test";

const heroDir = "test/fixtures/sprites/hero"; // relative to web/, where playwright runs; frames are idle_0..3.png

test("cast: add own sprite folder, survives reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await page.getByRole("button", { name: "Cast", exact: true }).click();
  await page.locator("input[webkitdirectory]").setInputFiles(heroDir);
  await page.getByRole("button", { name: "Yes" }).click();
  const cast = page.getByTestId("cast-list");
  await expect(cast).toContainText("hero");
  await expect(cast).toContainText("idle 4 frames");
  // the label starts at "Saved"; a change flips it to "Saving…" until the 1 s debounced save lands
  const save = page.getByTestId("save-status");
  await expect(save).toHaveText("Saving…");
  await expect(save).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("cast-list")).toContainText("idle 4 frames");
  await page.screenshot({ path: "test-results/cast-1280x800.png" });
});

test("a drop that misses the drop zone stays in the app", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await page.getByRole("button", { name: "Cast", exact: true }).click();
  await expect(page.getByTestId("cast-list")).toBeVisible();
  const url = page.url();
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "idle_0.png", { type: "image/png" }));
    const over = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true });
    const drop = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
    document.querySelector("h2")!.dispatchEvent(over);
    document.querySelector("h2")!.dispatchEvent(drop);
    return over.defaultPrevented && drop.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(page.getByText("Drop the folder on the Use my sprites box")).toBeVisible();
  expect(page.url()).toBe(url);
});

test("opening a zip of a project already here imports a copy", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await page.getByLabel("Project name").fill("Backup test");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download project" }).click()]);
  const zip = info.outputPath("backup.zip");
  await dl.saveAs(zip);
  await page.getByRole("link", { name: "Pixel Cutscene" }).click();
  await page.locator("input[accept*=zip]").setInputFiles(zip);
  await expect(page.getByLabel("Project name")).toHaveValue("Backup test (copy)");
  await page.getByRole("link", { name: "Pixel Cutscene" }).click();
  await expect(page.locator(".projects")).toContainText("Backup test (copy)");
  await expect(page.locator(".projects li").filter({ hasText: /^Backup test(?! \(copy\))/ })).toHaveCount(1);
});
