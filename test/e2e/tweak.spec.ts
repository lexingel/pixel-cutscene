import { expect, test } from "@playwright/test";
import { openFixture } from "./fixture";

test("tweak: preview matches renderFrame, drag moves an action", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "③ Tweak" }).click();
  const canvas = page.getByTestId("preview");
  await expect(canvas).toHaveAttribute("data-ready", "1");

  // scrub: two 1 s steps from 0 land on 2.0 s
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("timecode")).toContainText("2.00");

  // the canvas holds exactly renderFrame(t = 2.0), worked out here from the saved project
  const diff = await page.evaluate(async () => {
    const src = (f: string) => `/src/core/${f}.ts`; // served by vite; a variable keeps tsc from resolving it
    const { renderFrame } = await import(src("render"));
    const { loadProject } = await import(src("store"));
    const id = location.hash.split("/").pop()!;
    const p = await loadProject(id);
    const imgs = new Map();
    for (const [path, blob] of p.files as Map<string, Blob>) {
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      imgs.set(path, { w: bmp.width, h: bmp.height, px: g.getImageData(0, 0, bmp.width, bmp.height).data });
    }
    const { W, H } = p.canvas;
    const want = { w: W, h: H, px: new Uint8ClampedArray(W * H * 4) };
    renderFrame({ tl: p.tl, kit: p.kit, img: (k: string) => imgs.get(k) ?? null, draft: false, W, H }, 2.0, want);
    const cv = document.querySelector<HTMLCanvasElement>("[data-testid=preview]")!;
    const got = cv.getContext("2d")!.getImageData(0, 0, W, H).data;
    let bad = 0, hero = 0;
    for (let i = 0; i < got.length; i++) if (got[i] !== want.px[i]) bad++;
    for (let i = 0; i < got.length; i += 4) if (want.px[i] !== 58 || want.px[i + 1] !== 94) hero++; // pixels that are not the plain field
    return { bad, hero, size: [cv.width, cv.height] };
  });
  expect(diff.size).toEqual([320, 180]);
  expect(diff.hero).toBeGreaterThan(50); // the hero is on screen, so the check is not just the background
  expect(diff.bad).toBe(0);

  // drag the first action 80 px to the right; the inspector follows with the new, frame-snapped t
  const bar = page.locator("[data-id=a1]");
  await bar.click();
  const t = page.getByLabel("t (s)", { exact: true });
  await expect(t).toHaveValue("1");
  const box = (await bar.boundingBox())!;
  const lane = (await page.locator(".lane").first().boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 46, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + 86, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const want = Math.round((1 + (80 / lane.width) * 5) * 30) / 30;
  await expect(t).toHaveValue(String(Math.round(want * 1000) / 1000));
  await expect(page.getByTestId("needs")).toContainText("hero walk");
  await page.screenshot({ path: "test-results/tweak-1280x800.png" });
});

test("tweak without a timeline offers a way forward", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await page.getByRole("button", { name: "③ Tweak" }).click();
  await page.getByRole("button", { name: "Start an empty timeline" }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await expect(page.getByTestId("needs")).toContainText("Nothing missing");
  await page.getByRole("button", { name: "+ Sound" }).click();
  await expect(page.getByTestId("needs")).toContainText("sound1");
});

test("names from a project zip are shown as text, never as markup", async ({ page }) => {
  const evil = `<img src=x onerror="window.__pwned=1">`;
  await openFixture(page, evil);
  await page.getByRole("button", { name: "③ Tweak" }).click();
  const swap = page.getByLabel("Change action a1");
  await expect(swap.locator("option", { hasText: `anim:${evil}` })).toHaveCount(1);
  await expect(page.locator(".side img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
});
