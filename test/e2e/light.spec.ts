import { expect, test } from "@playwright/test";
import { openFixture } from "./fixture";

test("light: a shot set to night with dark corners darkens the preview, and undo brings the day back", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const preview = page.getByTestId("preview");
  await expect(preview).toHaveAttribute("data-ready", "1");
  const px = (x: number, y: number) => preview.evaluate((c: HTMLCanvasElement, [x, y]) => [...c.getContext("2d")!.getImageData(x, y, 1, 1).data].slice(0, 3), [x, y]);
  const day = await px(20, 20);
  await page.locator(".clip.shot").first().click();
  await page.getByLabel("Light", { exact: true }).selectOption("night");
  await page.getByLabel("Dark corners").check();
  await expect.poll(async () => (await px(20, 20))[0]).toBeLessThan(day[0]);
  await page.screenshot({ path: "test-results/d3-night.png" });
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect.poll(() => px(20, 20)).toEqual(day);
});
