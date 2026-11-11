import { expect, test } from "@playwright/test";
import { openFixture } from "./fixture";

test("+ Character adds an actor; + opens an effects row and × takes an empty one out; a bar click moves the playhead", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await page.getByRole("button", { name: "+ Character" }).click();
  await page.getByRole("menuitem", { name: "hero", exact: true }).click();
  await expect(page.locator(".track-label[data-actor=actor1]")).toHaveCount(1);

  await page.getByRole("button", { name: "Add an effects row" }).click();
  await expect(page.locator(".track-label[data-fxrow]")).toHaveText([/FX 2/, /FX 1/]);
  await page.getByRole("button", { name: "Remove FX 2" }).click();
  await expect(page.locator(".track-label[data-fxrow]")).toHaveText([/FX 1/]);

  await page.locator("[data-id=a1]").click();
  await expect(page.getByTestId("timecode")).toHaveText(/^00:01\.00/); // a1 starts at 1 s
});

test("view: groups fold and stay folded, rows go compact, zooming in shows the overview strip", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await page.locator("[data-group=chars]").click();
  await expect(page.locator(".track-label[data-actor]")).toHaveCount(0);
  await expect(page.locator(".gmark")).toHaveCount(1); // the folded row still shows where hero's walk is
  await page.reload();
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.locator("[data-group=chars]")).toHaveAttribute("aria-expanded", "false");
  await page.locator("[data-group=chars]").click();
  await expect(page.locator(".track-label[data-actor=hero1]")).toHaveCount(1);

  await page.getByRole("button", { name: "Compact rows" }).click();
  await expect(page.getByTestId("tracks")).toHaveClass(/compact/);
  await expect(page.locator(".overview")).toBeHidden();
  await page.getByRole("button", { name: "Zoom the timeline in" }).click();
  await expect(page.locator(".overview")).toBeVisible();
  await expect(page.locator(".ph-t")).toHaveText("0.00");
});

test("review fixes: locks follow a removed row, × hands focus on, the names grip takes arrows, a tiny drag is no edit, the time label stays inside", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  const tracks = page.getByTestId("tracks");

  // 3 rows, lock FX 3, take out the empty FX 2: the lock is now on FX 2 (the old FX 3)
  await page.getByRole("button", { name: "Add an effects row" }).click();
  await page.getByRole("button", { name: "Add an effects row" }).click();
  await page.getByRole("button", { name: "Lock the FX 3 row" }).click();
  await page.getByRole("button", { name: "Remove FX 2" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Lock the FX 2 row" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Lock the FX 1 row" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Remove FX 2" })).toBeFocused(); // the row that moved down into its place

  // the names column: arrows widen it
  const w0 = await tracks.evaluate((el) => getComputedStyle(el).getPropertyValue("--label"));
  await page.locator(".l-resize").focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => tracks.evaluate((el) => getComputedStyle(el).getPropertyValue("--label"))).not.toBe(w0);
  await expect(page.locator(".l-resize")).toBeFocused();

  // select a1 (playhead to its start), then a 4 px drag: no undo step
  await page.locator("[data-id=a1]").click();
  const undoBefore = await page.locator("[data-act=undo]").isDisabled();
  const box = (await page.locator("[data-id=a1]").boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 24, box.y + box.height / 2, { steps: 2 });
  await page.mouse.up();
  expect(await page.locator("[data-act=undo]").isDisabled()).toBe(undoBefore);

  // at the scene's end the time label sits left of the line: no sideways scroll at zoom 1
  await page.keyboard.press("End");
  await expect(page.locator(".ph-t")).toHaveClass(/flip/);
  expect(await tracks.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});

test("several selected effects dragged onto another row move together; the ruler number under the time label steps aside", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await expect(page.locator(".ruler .tick:not(.minor)").first()).toHaveClass(/under-ph/); // "0" sits under "0.00"
  const drawer = page.getByTestId("drawer");
  await drawer.getByLabel("Search effects").fill("campfire");
  for (const x of [0.1, 0.6]) { // one at a tenth of the scene, one past the middle
    const rb = (await page.locator(".ruler .lane").boundingBox())!;
    await page.mouse.click(rb.x + rb.width * x, rb.y + rb.height / 2);
    await drawer.getByRole("button", { name: "campfire" }).focus();
    await page.keyboard.press("Enter");
  }
  await expect(page.locator(".clip.fx")).toHaveCount(2, { timeout: 60_000 });
  await page.getByRole("button", { name: "Add an effects row" }).click();
  const bars = page.locator('.lane[data-fxrow="0"] .clip.fx');
  await bars.nth(0).click();
  await bars.nth(1).click({ modifiers: ["Shift"] });
  const from = (await bars.nth(0).boundingBox())!, target = (await page.locator('.lane[data-fxrow="1"]').boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, target.y + target.height / 2, { steps: 5 });
  await expect(page.locator(".track.drop")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.lane[data-fxrow="1"] .clip.fx')).toHaveCount(2);
  await expect(page.locator(".track.drop")).toHaveCount(0);
});
