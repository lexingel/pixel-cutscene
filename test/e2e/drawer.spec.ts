import { expect, test } from "@playwright/test";
import { openFixture } from "./fixture";

const tweak = async (page: import("@playwright/test").Page, opts: Parameters<typeof openFixture>[1] = {}) => {
  await openFixture(page, opts);
  await page.getByRole("button", { name: "③ Tweak" }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
};

test("drag a character onto the preview", async ({ page }) => {
  await tweak(page);
  const canvas = page.getByTestId("preview");
  const box = (await canvas.boundingBox())!;
  await page.getByTestId("drawer").getByRole("button", { name: "hero", exact: true }).dragTo(canvas, {
    targetPosition: { x: (100 * box.width) / 320, y: (150 * box.height) / 180 },
  });
  await expect(page.locator("[data-actor=actor1]").first()).toBeVisible();
  await expect(page.getByLabel("x", { exact: true })).toHaveValue("100");
  await expect(page.getByLabel("y", { exact: true })).toHaveValue("150");
});

test("pick an effect by search", async ({ page }) => {
  await tweak(page, "walk"); // the fixture's walk frames are in, so only the effect could be missing
  const drawer = page.getByTestId("drawer");
  await drawer.getByLabel("Effect category").selectOption("fire");
  await expect(drawer.getByRole("button", { name: "arcane orb" })).toBeHidden();
  await drawer.getByLabel("Effect category").selectOption("all");
  await drawer.getByLabel("Search effects").fill("breath");
  await expect(drawer.getByRole("button", { name: "fire breath" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "campfire" })).toBeHidden();
  await drawer.getByRole("button", { name: "fire breath" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".clip.fx")).toContainText("fire breath");
  await expect(page.getByTestId("needs")).toContainText("Nothing missing");
});

test("drop a track on the timeline", async ({ page }) => {
  await tweak(page);
  const lane = page.locator(".track", { hasText: "Audio" }).locator(".lane");
  const box = (await lane.boundingBox())!;
  const first = page.getByTestId("drawer").getByRole("button", { name: /^(?!Play|New sound)/ }).filter({ has: page.locator(".d-sub") }).first();
  await first.dragTo(lane, { targetPosition: { x: (box.width * 2) / 5, y: box.height / 2 } });
  await expect(page.locator(".clip.music")).toHaveCount(1);
  await expect(page.getByLabel("t (s)", { exact: true })).toHaveValue("2");
});

test("New sound adds a placeholder that waits for approval", async ({ page }) => {
  await tweak(page);
  await page.getByTestId("drawer").getByRole("button", { name: "New sound…" }).click();
  await expect(page.getByTestId("needs")).toContainText("sound1");
});

test("fits 1280x800", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await tweak(page);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(800);
  const next = (await page.getByRole("button", { name: "Next: Export" }).boundingBox())!;
  expect(next.y + next.height).toBeLessThanOrEqual(800);
  expect(next.x + next.width).toBeLessThanOrEqual(1280);
  for (const loc of [page.getByRole("heading", { name: "Sound and Music" }), page.getByRole("button", { name: "New sound…" })]) {
    const b = (await loc.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(800);
  }
  const fx = page.getByTestId("drawer").locator(".d-fx .d-item");
  const grid = (await page.getByTestId("drawer").locator(".d-fx .d-grid").boundingBox())!;
  let inView = 0;
  for (const b of await fx.all()) {
    const r = await b.boundingBox();
    if (r && r.y >= grid.y && r.y + r.height <= grid.y + grid.height) inView++; // fully inside the scrolling grid
  }
  expect(inView).toBeGreaterThanOrEqual(6);
  await page.screenshot({ path: "test-results/drawer-1280x800.png" });
});

test("dragging the end of an older looping effect starts from the length its bar shows", async ({ page }) => {
  await tweak(page);
  const drawer = page.getByTestId("drawer");
  await drawer.getByLabel("Search effects").fill("campfire");
  await drawer.getByRole("button", { name: "campfire" }).focus();
  await page.keyboard.press("Enter");
  const dur = page.getByLabel("dur (s)", { exact: true });
  await expect(dur).toHaveValue("2");
  await dur.fill(""); // an effect saved before loops had a length: it plays to the scene's end
  await dur.blur();
  await expect(dur).toHaveValue("");
  const shown = await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>(".clip.fx")!, lane = b.closest(".lane")!;
    return b.getBoundingClientRect().width / lane.getBoundingClientRect().width;
  });
  const grip = page.locator(".clip.fx .grip");
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 - 8, g.y + g.height / 2, { steps: 4 });
  await page.mouse.up();
  const D = parseFloat((await page.getByTestId("timecode").textContent())!.split("/")[1]);
  expect(Number(await dur.inputValue())).toBeGreaterThan(shown * D - 1); // a little shorter, not 0.5 s
});
