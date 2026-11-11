import { expect, test } from "@playwright/test";
// @ts-ignore node types are not part of the browser build
import { readFileSync } from "node:fs";
import { FFMPEG, NO_FFMPEG, probe } from "./fixture";

// Someone who has never seen the tool, with no keys: every step is found by its visible label.
test("a stranger makes and exports a cutscene with no keys", async ({ page }) => {
  test.setTimeout(240_000);
  await page.route("https://**", (route) => route.abort()); // no keys, so nothing should go out anyway
  await page.goto("/");
  await page.screenshot({ path: "test-results/stranger-home-1280x800.png" });
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await expect(page.getByRole("button", { name: "Scene", exact: true })).toHaveAttribute("aria-current", "step");
  await page.screenshot({ path: "test-results/stranger-scene-1280x800.png" });

  // Cast: the folder of PNGs, then the side-view question
  await page.getByRole("button", { name: "Cast", exact: true }).click();
  await page.screenshot({ path: "test-results/stranger-cast-empty-1280x800.png" });
  await page.getByLabel(/Use my sprites/).setInputFiles("test/fixtures/sprites/hero");
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByRole("heading", { name: "hero" })).toBeVisible();
  await page.screenshot({ path: "test-results/stranger-cast-1280x800.png" });

  // Scene: no AI key, so write it by hand
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await page.getByRole("button", { name: "Write it myself" }).click();
  await expect(page.getByRole("button", { name: "Tweak", exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await page.screenshot({ path: "test-results/stranger-tweak-empty-1280x800.png" });

  // Tweak: a background for the wide shot, the hero with an idle, a library track
  await page.getByTitle("Shot 1 · wide").click(); // the shot bar (its label span ignores the pointer)
  await page.getByLabel("Upload background").setInputFiles("test/fixtures/bg/field.png");
  await expect(page.getByLabel("Background", { exact: true })).toHaveValue("field");
  await expect(page.getByLabel("Ground line (y)")).not.toHaveValue(""); // found in the picture: the sand strip
  await page.getByLabel("Far layer (behind, slower)").selectOption("field");
  await expect(page.getByLabel("Far layer (behind, slower)")).toHaveValue("field");
  await page.getByTestId("drawer").getByRole("button", { name: "hero", exact: true }).click();
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await page.getByRole("menuitem", { name: "Look around" }).click();
  await expect(page.getByLabel("Move", { exact: true })).toHaveValue("look_around");

  await page.getByTestId("drawer").locator(".d-row .d-item").first().click(); // the first library track
  await expect(page.getByTestId("status")).toHaveText("Ready to export");
  await page.screenshot({ path: "test-results/stranger-tweak-1280x800.png" });

  // Export: the full video is a real MP4
  await page.getByRole("button", { name: "Next: Export" }).click();
  await expect(page.getByText("Full videos come out as MP4")).toBeVisible({ timeout: 30_000 }); // the codec probe is slow while another worker bakes
  await page.screenshot({ path: "test-results/stranger-export-1280x800.png" });
  const dl = page.waitForEvent("download", { timeout: 180_000 });
  await page.getByRole("button", { name: "Export video" }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe("Untitled cutscene.mp4");
  const file = "test-results/stranger.mp4";
  await d.saveAs(file);
  const head = readFileSync(file) as Uint8Array;
  expect(new TextDecoder().decode(head.subarray(4, 8))).toBe("ftyp");

  test.skip(!FFMPEG, NO_FFMPEG);
  const { info, frames } = probe(file);
  expect(info).toMatch(/Video: h264/);
  expect(info).toMatch(/Audio: aac/);
  expect(frames).toBe(300); // 10 s at 30 fps
});

test("the sample opens ready to export", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the sample" }).click();
  await expect(page.getByRole("button", { name: "Tweak", exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await expect(page.getByTestId("status")).toHaveText("Ready to export");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight"); // 3 s: the ranger is mid-walk
  await page.screenshot({ path: "test-results/stranger-sample-1280x800.png" });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export video" })).toBeVisible(); // the export page has rendered
  await expect(page.locator(".needs-list")).toBeHidden();
});
