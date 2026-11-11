import { expect, test } from "@playwright/test";
import { openApprovals } from "./fixture";

test("music library: pick a track for a missing music clip", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[accept*=zip]").waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const src = (f: string) => `/src/core/${f}.ts`; // served by vite; a variable keeps tsc from resolving it
    const { newProject, toZip } = await import(src("project"));
    const p = newProject("Music fixture");
    p.canvas = { W: 320, H: 180, exportScale: 2 };
    p.tl = {
      name: "music", duration: 5,
      shots: [{ id: "s1", type: "wide", start: 0, end: 5, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
      actors: [], fx: [], audio: [{ id: "m1", t: 0, clip: "theme", kind: "music" }],
    };
    const dt = new DataTransfer();
    dt.items.add(new File([await toZip(p)], "music.zip", { type: "application/zip" }));
    const input = document.querySelector<HTMLInputElement>("input[accept*=zip]")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.getByLabel("Project name")).toHaveValue("Music fixture");
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await openApprovals(page);
  const row = page.getByTestId("needs").locator("li", { hasText: "theme" });
  await expect(row.locator(".tag")).toHaveText("missing");
  await row.getByRole("button", { name: "Pick from library" }).click();
  const dlg = page.getByRole("dialog", { name: "Music library" });
  await expect(dlg.locator("li")).toHaveCount(12);
  await dlg.getByLabel("Mood").selectOption("battle");
  await expect(dlg.locator("li").first()).toBeVisible();
  await page.screenshot({ path: "test-results/music-picker-1280x800.png" });
  // the track download is held: Close and Escape wait until the Use lands
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/music/*.ogg", async (route) => (await held, route.continue()));
  await dlg.locator("li").first().getByRole("button", { name: "Use" }).click();
  await expect(dlg.getByRole("button", { name: "Close" })).toBeDisabled();
  for (const b of await dlg.getByRole("button", { name: "Use" }).all()) await expect(b).toBeDisabled(); // no double Use
  await page.keyboard.press("Escape");
  await expect(dlg).toBeVisible();
  // a repeated Escape may close without a cancel event (Chrome's close watcher); the Use must still be saved
  await dlg.evaluate((d: HTMLDialogElement) => d.close());
  release();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("needs")).toContainText("Nothing missing");
});
