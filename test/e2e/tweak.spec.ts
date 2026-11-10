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
  await page.getByTestId("drawer").getByRole("button", { name: "New sound…" }).click();
  await expect(page.getByTestId("needs")).toContainText("sound1");
  // a second sound gets its own clip, not sound1 again
  await page.getByTestId("drawer").getByRole("button", { name: "New sound…" }).click();
  await expect(page.getByTestId("needs").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("needs").locator("li", { hasText: "sound1" })).toHaveCount(1);
});

test("names from a project zip are shown as text, never as markup", async ({ page }) => {
  const evil = `<img src=x onerror="window.__pwned=1">`;
  await openFixture(page, evil);
  await page.getByRole("button", { name: "③ Tweak" }).click();
  const swap = page.getByLabel(/Change action/);
  await expect(swap.locator("option", { hasText: `Play: ${evil}` })).toHaveCount(1);
  await expect(page.locator(".side img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
});

test("framing: a camera pan past the background is flagged, and Fill the frame covers it", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "③ Tweak" }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  const box = page.getByTestId("framing");
  await expect(box).toBeHidden(); // the 320x180 field covers the 320x180 canvas
  await page.getByTitle("Shot 1 · wide").click();
  const x = page.getByLabel("camera key 1 x");
  await x.fill("100");
  await x.press("Enter"); // change fires on commit
  await x.blur();
  await expect(box).toContainText("Shot 1: the background leaves black at the right");
  await page.screenshot({ path: "test-results/framing-1280x800.png" });
  await box.getByRole("button", { name: "Fill the frame" }).click();
  await expect(page.getByLabel("bg scale", { exact: true })).toHaveValue("2");
  await expect(box).toBeHidden();
});

test("changing an action to Walk just works", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "③ Tweak" }).click();
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await page.getByRole("menuitem", { name: "Stand" }).click();
  const act = page.getByLabel("action", { exact: true });
  await expect(act).toHaveValue("idle");
  await expect(act.locator("option", { hasText: "Walk to…" })).toHaveCount(1);
  await act.selectOption("walk");
  await expect(page.getByLabel("to x")).toBeVisible();
  await expect(page.getByLabel("to y")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /needs|unknown/ })).toHaveCount(0);
});

test("added at the playhead", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "③ Tweak" }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("timecode")).toContainText("2.00");
  await page.getByTestId("drawer").getByRole("button", { name: "hero", exact: true }).click();
  await expect(page.getByLabel("appears at (s)")).toHaveValue("2");
  await page.getByRole("button", { name: "Add a move for hero 2" }).click();
  await page.getByRole("menuitem", { name: "Stand" }).click();
  await expect(page.getByLabel("t (s)", { exact: true })).toHaveValue("2");
});

test("row menu adds Turn to dust at the playhead", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "③ Tweak" }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(9); // no extra anims in this fixture, plus Attack and Breathe fire
  await page.getByRole("menuitem", { name: "Turn to dust" }).click();
  await expect(page.locator(".clip[title$=\"· Turn to dust\"]")).toBeVisible();
  await expect(page.getByLabel("t (s)", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("dur (s)", { exact: true })).toHaveValue("1.5");
});

test("Play items list only approved anims, never idle, walk or hurt", async ({ page }) => {
  await openFixture(page, { breathe: true, extraAnim: "hurt", unapprovedAnim: "cheer" });
  await page.getByRole("button", { name: "③ Tweak" }).click();
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  const names = await page.getByRole("menuitem").allTextContents();
  expect(names).toEqual(["Stand", "Walk to…", "Move to…", "Look around", "Startle", "Hurt", "Turn to dust", "Attack", "Breathe fire"]);
  await page.getByRole("menuitem", { name: "Stand" }).click();
  await expect(page.getByRole("button", { name: "Add a move for hero" })).toBeFocused();
});

test("Escape closes the row menu", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "③ Tweak" }).click();
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("Breathe fire brings its flame", async ({ page }) => {
  await openFixture(page, { breathe: true, extraAnim: "walk" });
  await page.getByRole("button", { name: "③ Tweak" }).click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("timecode")).toContainText("1.00");
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await page.getByRole("menuitem", { name: "Breathe fire" }).click();
  const flame = page.locator(".clip.fx[title=\"fire breath\"]");
  await expect(flame).toBeVisible();
  await flame.click();
  await expect(page.getByLabel("t (s)", { exact: true })).toHaveValue("1.333");
  expect(Number(await page.getByLabel("x", { exact: true }).inputValue())).toBeGreaterThan(80); // the facing (right) edge of a hero standing at x 80
  expect(Number(await page.getByLabel("y", { exact: true }).inputValue())).toBeLessThan(150); // above the feet
  await expect(page.getByText("Ready to export", { exact: true })).toBeVisible();
  await expect(page.getByText(/Nothing missing/)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click(); // one step takes the move and its flame together
  await expect(flame).toHaveCount(0);
  await expect(page.locator(".clip[title=\"hero · Breathe fire\"]")).toHaveCount(0);
});

// ---- editing in the preview
const stageTweak = async (page: import("@playwright/test").Page) => {
  await openFixture(page);
  await page.getByRole("button", { name: "③ Tweak" }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
};

test("drag in the preview, one undo step", async ({ page }) => {
  await stageTweak(page);
  const box = (await page.getByTestId("preview").boundingBox())!;
  const scale = box.width / 320;
  const sx = box.x + 80 * scale, sy = box.y + 140 * scale; // inside the hero standing at (80, 150)
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 20, sy, { steps: 4 });
  await page.keyboard.press("Control+z"); // ignored mid-drag
  await page.mouse.move(sx + 40, sy, { steps: 4 });
  await page.mouse.up();
  const x = page.getByLabel("x", { exact: true });
  await expect(x).toHaveValue(String(80 + Math.round(40 / scale)));
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(x).toHaveValue("80");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled(); // the whole drag was one step
});

test("a click in the preview only selects", async ({ page }) => {
  await stageTweak(page);
  const box = (await page.getByTestId("preview").boundingBox())!;
  await page.mouse.click(box.x + (80 * box.width) / 320, box.y + (140 * box.width) / 320);
  await expect(page.getByLabel("x", { exact: true })).toHaveValue("80");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("arrow keys nudge the selection", async ({ page }) => {
  await stageTweak(page);
  await page.locator(".track-label[data-actor=hero1]").click();
  await page.getByTestId("preview").focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("x", { exact: true })).toHaveValue("83");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByLabel("y", { exact: true })).toHaveValue("158");
  await expect(page.getByTestId("timecode").locator("b")).toHaveText("0.00");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowRight"); // nothing selected: scrubs again
  await expect(page.getByTestId("timecode").locator("b")).toHaveText("1.00");
});

test("aim handle turns the flame", async ({ page }) => {
  await stageTweak(page);
  const drawer = page.getByTestId("drawer");
  await drawer.getByLabel("Search effects").fill("breath");
  await drawer.getByRole("button", { name: "fire breath" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".clip.fx")).toContainText("fire breath");
  // the handle is drawn once the effect's module says it can be aimed
  await page.waitForFunction(() => {
    const o = document.querySelector<HTMLCanvasElement>(".overlay")!;
    return o.getContext("2d")!.getImageData(0, 0, o.width, o.height).data.some((v, i) => i % 4 === 3 && v > 0);
  });
  const box = (await page.getByTestId("preview").boundingBox())!;
  const k = box.width / 320;
  const ox = box.x + 160 * k, oy = box.y + 90 * k; // the effect was added at the middle of the frame
  await page.mouse.move(ox + 24 * k, oy);
  await page.mouse.down();
  await page.mouse.move(ox + 12 * k, oy - 12 * k, { steps: 4 });
  await page.mouse.move(ox, oy - 24 * k, { steps: 4 });
  await page.mouse.up();
  const fx = page.locator("output[aria-label=effect]"); // reads "fire breath"; its data-asset is the baked sheet
  await expect(fx).toHaveAttribute("data-asset", /^fire-breath_a(-90|270)$/, { timeout: 30000 }); // the re-bake takes seconds in a dev build
  await expect(fx).toHaveText("fire breath");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(fx).toHaveAttribute("data-asset", "fire-breath");
});

test("choosing Breathe fire in the inspector adds the flame too, in one undo step", async ({ page }) => {
  await openFixture(page, { breathe: true, extraAnim: "walk" });
  await page.getByRole("button", { name: "③ Tweak" }).click();
  await page.locator("[data-id=a1]").click();
  await page.getByLabel("action", { exact: true }).selectOption("anim:breathe");
  await expect(page.locator(".clip.fx[title=\"fire breath\"]")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".clip.fx")).toHaveCount(0);
  await expect(page.getByLabel("action", { exact: true })).toHaveValue("walk");
});
