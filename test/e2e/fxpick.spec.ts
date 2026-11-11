import { expect, test } from "@playwright/test";

// An effect the scene names but the kit lacks (an AI draft's own idea) is swapped for a library one from Needs approval.
test("a missing effect is picked from the library in Needs approval", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[accept*=zip]").waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { newProject, toZip } = await import("/src/core/project.ts" as string);
    const p = newProject("Fx pick");
    p.step = 3;
    p.tl = {
      name: "t", duration: 4, shots: [{ id: "s1", type: "wide", start: 0, end: 4, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
      actors: [], audio: [], fx: [{ id: "f1", t: 1, fx: "dragon_fire", x: 100, y: 200 }],
    };
    const dt = new DataTransfer();
    dt.items.add(new File([await toZip(p)], "fx.zip", { type: "application/zip" }));
    const input = document.querySelector<HTMLInputElement>("input[accept*=zip]")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.getByLabel("Project name")).toHaveValue("Fx pick");
  await page.getByRole("button", { name: "③ Tweak" }).click();
  await page.getByRole("button", { name: "Pick from library" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Search effects").fill("fire breath");
  await expect(dialog.getByRole("button", { name: /^Use / })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Use fire breath" }).click();
  await expect(page.getByText("Nothing missing.", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".clip.fx[title=\"fire breath\"]")).toBeVisible();
});
