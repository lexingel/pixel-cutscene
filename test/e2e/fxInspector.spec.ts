import { expect, test } from "@playwright/test";

// A library effect can be aimed and turned around from the inspector, not only by dragging its handle.
test("an effect's angle and facing are set in the inspector", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.locator("input[accept*=zip]").waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const src = (f: string) => `/src/core/${f}.ts`;
    const { newProject, toZip } = await import(src("project"));
    const { addLibraryFx } = await import(src("fxLibrary"));
    const p = newProject("Fx aim");
    p.step = 3;
    const id = await addLibraryFx(p, "impacts/hit-spark", 0);
    p.tl = {
      name: "t", duration: 4, shots: [{ id: "s1", type: "wide", start: 0, end: 4, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
      actors: [], audio: [], fx: [{ id: "f1", t: 1, fx: id, x: 100, y: 100 }],
    };
    const dt = new DataTransfer();
    dt.items.add(new File([await toZip(p)], "fx.zip", { type: "application/zip" }));
    const input = document.querySelector<HTMLInputElement>("input[accept*=zip]")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.getByLabel("Project name")).toHaveValue("Fx aim");
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.locator(".clip.fx").first().click();
  const angle = page.locator(".inspector").getByLabel("Angle");
  await angle.fill("45");
  await angle.press("Enter");
  await expect(page.locator(".inspector").getByLabel("Angle")).toHaveValue("45", { timeout: 30_000 });
  const flip = page.locator(".inspector").getByLabel("Faces left");
  await flip.check();
  await expect(page.locator(".inspector").getByLabel("Faces left")).toBeChecked();
  await expect.poll(() => page.evaluate(async () => {
    const { listProjects, loadProject } = await import("/src/core/store.ts" as string);
    const metas = await listProjects();
    const p = await loadProject(metas.find((m: { name: string }) => m.name === "Fx aim").id);
    return [p.tl.fx[0].angle, p.tl.fx[0].flip];
  }), { timeout: 10_000 }).toEqual([45, true]);
});
