import { expect, test } from "@playwright/test";
import { openFixture } from "./fixture";

test("camera: drag the picture of a selected shot to set a key, follow an actor, ease per key, cinema bars", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const preview = page.getByTestId("preview");
  await expect(preview).toHaveAttribute("data-ready", "1");
  const ruler = page.locator(".track.ruler .lane");
  const rb = (await ruler.boundingBox())!;
  await ruler.click({ position: { x: rb.width * 0.4, y: rb.height / 2 } });
  await page.locator(".clip.shot").first().click();
  await expect(page.getByLabel("camera key 2 x")).toHaveCount(0);
  const pb = (await preview.boundingBox())!;
  await page.mouse.move(pb.x + pb.width * 0.3, pb.y + pb.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(pb.x + pb.width * 0.2, pb.y + pb.height * 0.2, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByLabel("camera key 2 x")).toHaveValue(/^[1-9]\d*$/); // dragged left: the camera moved right
  await page.screenshot({ path: "test-results/d1-camera-path.png" });
  await page.getByLabel("camera key 1 ease").selectOption("linear");
  await expect(page.getByLabel("camera key 1 ease")).toHaveValue("linear");
  await page.getByRole("button", { name: /\+ Shot/ }).click();
  await page.getByRole("menuitem", { name: /^Camera follows hero/ }).click();
  await expect(page.getByLabel("camera key 1 ease")).toHaveValue("linear");
  await page.getByRole("button", { name: /\+ Shot/ }).click();
  await page.getByRole("menuitem", { name: "Cinema bars (top and bottom)" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Cinema bars (px)")).toHaveValue("22");
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Cinema bars (px)")).toHaveValue("");
});
