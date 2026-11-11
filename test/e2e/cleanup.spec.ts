import { expect, test } from "@playwright/test";

// A character whose walk has a stray white pixel and floats 2 px: Clean up fixes both, and Undo outlives a reload.
test("clean up fixes a generated walk and can be undone after a reload", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[accept*=zip]").waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { newProject, toZip } = await import("/src/core/project.ts" as string);
    const p = newProject("Clean test");
    const frame = async (top: number, speck: boolean) => {
      const c = new OffscreenCanvas(16, 24), g = c.getContext("2d")!;
      g.fillStyle = "rgb(120 60 30)"; g.fillRect(4, top, 8, 16);
      g.fillStyle = "rgb(216 67 58)"; g.fillRect(6, top + 2, 1, 1); // an eye: one pixel, in every frame
      if (speck) { g.fillStyle = "rgb(250 250 250)"; g.fillRect(8, top + 8, 1, 1); }
      return c.convertToBlob({ type: "image/png" });
    };
    const anim = async (name: string, top: number, speck: boolean) => {
      const frames: string[] = [];
      for (let i = 0; i < 2; i++) {
        const f = `chars/hero/${name}/${name}_${i}.png`;
        p.files.set(f, await frame(top, speck && i === 1));
        frames.push(f);
      }
      return { approved: true, source: "user", frames };
    };
    p.kit = { chars: { hero: { view: "side", anims: { idle: await anim("idle", 8, false), walk: await anim("walk", 6, true) } } }, faces: {}, assets: {} } as any;
    const dt = new DataTransfer();
    dt.items.add(new File([await toZip(p)], "clean.zip", { type: "application/zip" }));
    const input = document.querySelector<HTMLInputElement>("input[accept*=zip]")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.getByLabel("Project name")).toHaveValue("Clean test");
  await page.getByRole("button", { name: "② Cast" }).click();

  await page.getByRole("button", { name: "Clean up hero walk" }).click();
  await expect(page.getByText("hero walk: 1 stray pixel fixed, 2 floating frames set on the ground.")).toBeVisible();
  await page.getByRole("button", { name: "Clean up hero idle" }).click();
  await expect(page.getByText("hero idle is already clean.")).toBeVisible(); // the eye is a detail, not a speck

  await page.reload();
  await page.getByRole("button", { name: "② Cast" }).click();
  await page.getByRole("button", { name: "Undo clean-up of hero walk" }).click();
  await expect(page.getByRole("button", { name: "Undo clean-up of hero walk" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clean up hero walk" }).click(); // the original frames are back, so it cleans again
  await expect(page.getByText("hero walk: 1 stray pixel fixed, 2 floating frames set on the ground.")).toBeVisible();
});
