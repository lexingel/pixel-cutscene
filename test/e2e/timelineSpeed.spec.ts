import { expect, test, type Page } from "@playwright/test";
import { openFixture } from "./fixture";

// The fixture: hero1 with a walk (a1). A second hero (actor1) is added from the drawer.
async function twoHeroes(page: Page) {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await page.getByTestId("drawer").getByRole("button", { name: "hero", exact: true }).click();
  await expect(page.locator(".track-label[data-actor=actor1]")).toHaveCount(1);
}
const row = (page: Page, actor: string) => page.locator(".track", { has: page.locator(`.track-label[data-actor=${actor}]`) }).locator(".clip");

test("right-click a move: Give this move to the other actors puts it on their rows, one undo step", async ({ page }) => {
  await twoHeroes(page);
  await page.locator("[data-id=a1]").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Give this move to the other actors" }).click();
  await expect(row(page, "actor1")).toHaveCount(1);
  await expect(page.locator(".clip.sel")).toHaveCount(2); // the original and the copy stay selected
  await page.keyboard.press("Control+z");
  await expect(row(page, "actor1")).toHaveCount(0);
});

test("Shift+click selects several bars; Delete removes them together; Ctrl+C/V pastes the group at the playhead", async ({ page }) => {
  await twoHeroes(page);
  await page.locator("[data-id=a1]").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Give this move to the other actors" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".clip.sel")).toHaveCount(0);
  const [a, b] = [page.locator("[data-id=a1]"), row(page, "actor1").first()];
  await a.click();
  await b.click({ modifiers: ["Shift"] });
  await expect(page.locator(".clip.sel")).toHaveCount(2);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Control+v");
  await expect(row(page, "hero1")).toHaveCount(2);
  await expect(row(page, "actor1")).toHaveCount(2);
  await page.keyboard.press("Delete"); // the pasted pair is selected
  await expect(row(page, "hero1")).toHaveCount(1);
  await expect(row(page, "actor1")).toHaveCount(1);
  await a.click();
  await b.click({ modifiers: ["Control"] }); // Ctrl+click adds...
  await expect(page.locator(".clip.sel")).toHaveCount(2);
  await b.click({ modifiers: ["Control"] }); // ...and takes it out again
  await expect(page.locator(".clip.sel")).toHaveCount(1);
});

test("Alt+drag leaves the bar where it was and drops a copy", async ({ page }) => {
  await twoHeroes(page);
  const a = page.locator("[data-id=a1]");
  const box = (await a.boundingBox())!;
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(row(page, "hero1")).toHaveCount(2);
  expect(Math.round((await a.boundingBox())!.x)).toBe(Math.round(box.x));
});

test("a locked row keeps its bars: no drag, no delete; the padlock unlocks it", async ({ page }) => {
  await twoHeroes(page);
  await page.locator(".track-label[data-actor=hero1] .row-lock").click();
  await expect(page.locator(".track-label[data-actor=hero1] .row-lock")).toHaveAttribute("aria-pressed", "true");
  const a = page.locator("[data-id=a1]");
  const box = (await a.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Math.round((await a.boundingBox())!.x)).toBe(Math.round(box.x));
  await expect(page.locator(".toast", { hasText: "row is locked" })).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(row(page, "hero1")).toHaveCount(1);
  await page.locator(".track-label[data-actor=hero1] .row-lock").click();
  await a.click();
  await page.keyboard.press("Delete");
  await expect(row(page, "hero1")).toHaveCount(0);
});

test("what is selected gets a box on the preview, and loses it on Escape", async ({ page }) => {
  await twoHeroes(page);
  const orange = () =>
    page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>("canvas.overlay")!;
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 170 && d[i + 1] < 200 && d[i + 2] < 100 && d[i + 3] > 0) n++;
      return n;
    });
  await page.keyboard.press("Escape");
  await expect.poll(orange).toBe(0);
  await page.locator(".track-label[data-actor=hero1]").click();
  await expect.poll(orange).toBeGreaterThan(40);
  await page.keyboard.press("Escape");
  await expect.poll(orange).toBe(0);
});
