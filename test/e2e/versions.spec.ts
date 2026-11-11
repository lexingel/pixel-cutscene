import { expect, test } from "@playwright/test";

test("versions: save a named version, change the project, restore it; the state before restoring is kept", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await expect(page).toHaveURL(/#\/p\//);
  await page.getByRole("button", { name: "Versions" }).click();
  const dlg = page.getByRole("dialog", { name: "Versions" });
  await dlg.getByLabel("Version name").fill("Clean start");
  await dlg.getByRole("button", { name: "Save a version" }).click();
  await expect(dlg.locator("li", { hasText: "Clean start" })).toHaveCount(1);
  await dlg.getByRole("button", { name: "Close" }).click();

  await page.getByLabel("Project name").fill("Changed name");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Versions" }).click();
  await dlg.locator("li", { hasText: "Clean start" }).getByRole("button", { name: "Restore" }).click();
  await page.getByRole("dialog", { name: "Restore this version?" }).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("Untitled cutscene");
  await page.getByRole("button", { name: "Versions" }).click();
  await expect(dlg.locator("li", { hasText: "Before restoring" })).toContainText("Changed name");
});

test("versions: a backup folder gets the project zip, named after the project", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __writes: string[]; showDirectoryPicker: unknown };
    w.__writes = [];
    w.showDirectoryPicker = async () => ({
      name: "cutscene-backups",
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      getFileHandle: async (n: string) => ({ createWritable: async () => ({ write: async (b: Blob) => void w.__writes.push(`${n}:${b.size > 0}`), close: async () => {} }) }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await expect(page).toHaveURL(/#\/p\//);
  await page.getByRole("button", { name: "Versions" }).click();
  const dlg = page.getByRole("dialog", { name: "Versions" });
  await dlg.getByRole("button", { name: "Choose a backup folder" }).click();
  await expect(dlg.getByTestId("backup-state")).toContainText("cutscene-backups");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __writes: string[] }).__writes)).toEqual([expect.stringMatching(/^Untitled cutscene-[0-9a-f]{8}\.zip:true$/)]);
});
