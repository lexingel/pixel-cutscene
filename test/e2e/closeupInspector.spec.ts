import { expect, test } from "@playwright/test";

// A close-up's face and expression are picked from the cast and the moods, not typed.
test("a close-up's face and expression are picked from lists", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.locator("input[accept*=zip]").waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { newProject, toZip } = await import("/src/core/project.ts" as string);
    const p = newProject("Face pick");
    p.step = 3;
    p.tl = {
      name: "t", duration: 4,
      shots: [
        { id: "s1", type: "wide", start: 0, end: 2, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] },
        { id: "s2", type: "closeup", start: 2, end: 4, face: "knight", expr: "neutral" },
      ],
      actors: [{ id: "m1", char: "mage", x: 50, y: 100, actions: [] }], audio: [], fx: [],
    };
    const dt = new DataTransfer();
    dt.items.add(new File([await toZip(p)], "f.zip", { type: "application/zip" }));
    const input = document.querySelector<HTMLInputElement>("input[accept*=zip]")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.getByLabel("Project name")).toHaveValue("Face pick");
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.locator(".clip.shot", { hasText: "close-up" }).click();
  const ins = page.locator(".inspector");
  await expect(ins.getByLabel("Face")).toHaveValue("knight");
  await ins.getByLabel("Face").selectOption("mage");
  await ins.getByLabel("Expression").selectOption("angry");
  await expect.poll(() => page.evaluate(async () => {
    const { listProjects, loadProject } = await import("/src/core/store.ts" as string);
    const p = await loadProject((await listProjects()).find((m: { name: string }) => m.name === "Face pick").id);
    return [p.tl.shots[1].face, p.tl.shots[1].expr];
  }), { timeout: 10_000 }).toEqual(["mage", "angry"]);
});
