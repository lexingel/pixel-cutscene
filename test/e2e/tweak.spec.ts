import { expect, test } from "@playwright/test";
import { closeApprovals, openApprovals, openFixture } from "./fixture";

test("tweak: preview matches renderFrame, drag moves an action", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
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
  const t = page.getByLabel("Start (s)", { exact: true });
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
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
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
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const swap = page.getByLabel(/Change action/);
  await expect(swap.locator("option", { hasText: `Play: ${evil}` })).toHaveCount(1);
  await expect(page.locator(".side img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
});

test("framing: a camera pan past the background is flagged, and Fill the frame covers it", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
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
  await expect(page.getByLabel("Background scale", { exact: true })).toHaveValue("2");
  await expect(box).toBeHidden();
});

test("changing an action to Walk just works", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await page.getByRole("menuitem", { name: "Look around" }).click();
  const act = page.getByLabel("Move", { exact: true });
  await expect(act).toHaveValue("look_around");
  await expect(act.locator("option", { hasText: "Walk to…" })).toHaveCount(1);
  await act.selectOption("walk");
  await expect(page.getByLabel("Go to x")).toBeVisible();
  await expect(page.getByLabel("Go to y")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /needs|unknown/ })).toHaveCount(0);
});

test("added at the playhead", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("timecode")).toContainText("2.00");
  await page.getByTestId("drawer").getByRole("button", { name: "hero", exact: true }).click();
  await expect(page.getByLabel("Appears at (s)")).toHaveValue("2");
  await page.getByRole("button", { name: "Add a move for hero 2" }).click();
  await page.getByRole("menuitem", { name: "Look around" }).click();
  await expect(page.getByLabel("Start (s)", { exact: true })).toHaveValue("2");
});

test("row menu adds Turn to dust at the playhead", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(9); // no extra anims in this fixture, plus Say, Attack and Breathe fire; no Stand up (nobody is down)
  await page.getByRole("menuitem", { name: "Turn to dust" }).click();
  await expect(page.locator(".clip[title*=\"· Turn to dust · \"]")).toBeVisible();
  await expect(page.getByLabel("Start (s)", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("Length (s)", { exact: true })).toHaveValue("1.5");
});

test("Play items list only approved anims, never idle, walk or hurt", async ({ page }) => {
  await openFixture(page, { breathe: true, extraAnim: "hurt", unapprovedAnim: "cheer" });
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  const names = await page.getByRole("menuitem").allTextContents();
  expect(names).toEqual(["Walk to…", "Move to…", "Look around", "Startle", "Hurt", "Turn to dust", "Say…", "Attack", "Breathe fire"]);
  await page.getByRole("menuitem", { name: "Look around" }).click();
  await expect(page.getByRole("button", { name: "Add a move for hero" })).toBeFocused();
});

test("Escape closes the row menu", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("Breathe fire brings its flame", async ({ page }) => {
  await openFixture(page, { breathe: true, extraAnim: "walk" });
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("timecode")).toContainText("1.00");
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await page.getByRole("menuitem", { name: "Breathe fire" }).click();
  const flame = page.locator(".clip.fx[title^=\"fire breath · \"]");
  await expect(flame).toBeVisible();
  await flame.click();
  await expect(page.getByLabel("Start (s)", { exact: true })).toHaveValue("1.333");
  expect(Number(await page.getByLabel("X", { exact: true }).inputValue())).toBeGreaterThan(80); // the facing (right) edge of a hero standing at x 80
  expect(Number(await page.getByLabel("Y", { exact: true }).inputValue())).toBeLessThan(150); // above the feet
  await expect(page.getByTestId("status")).toHaveText("Ready to export");
  await openApprovals(page);
  await expect(page.getByText(/Nothing missing/)).toBeVisible();
  await closeApprovals(page);
  await page.getByRole("button", { name: "Undo" }).click(); // one step takes the move and its flame together
  await expect(flame).toHaveCount(0);
  await expect(page.locator(".clip[title^=\"hero · Breathe fire · \"]")).toHaveCount(0);
});

// ---- editing in the preview
const stageTweak = async (page: import("@playwright/test").Page) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
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
  const x = page.getByLabel("X", { exact: true });
  await expect(x).toHaveValue(String(80 + Math.round(40 / scale)));
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(x).toHaveValue("80");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled(); // the whole drag was one step
});

test("a click in the preview only selects", async ({ page }) => {
  await stageTweak(page);
  const box = (await page.getByTestId("preview").boundingBox())!;
  await page.mouse.click(box.x + (80 * box.width) / 320, box.y + (140 * box.width) / 320);
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("80");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("arrow keys nudge the selection", async ({ page }) => {
  await stageTweak(page);
  await page.locator(".track-label[data-actor=hero1]").click();
  await page.getByTestId("preview").focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("83");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByLabel("Y", { exact: true })).toHaveValue("158");
  await expect(page.getByTestId("timecode").locator("b")).toHaveText("00:00.00");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowRight"); // nothing selected: scrubs again
  await expect(page.getByTestId("timecode").locator("b")).toHaveText("00:01.00");
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
  const fx = page.locator("output[aria-label=Effect]"); // reads "fire breath"; its data-asset is the baked sheet
  await expect(fx).toHaveAttribute("data-asset", /^fire-breath_a(-90|270)$/, { timeout: 30000 }); // the re-bake takes seconds in a dev build
  await expect(fx).toHaveText("fire breath");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(fx).toHaveAttribute("data-asset", "fire-breath");
});

test("choosing Breathe fire in the inspector adds the flame too, in one undo step", async ({ page }) => {
  await openFixture(page, { breathe: true, extraAnim: "walk" });
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.locator("[data-id=a1]").click();
  await page.getByLabel("Move", { exact: true }).selectOption("anim:breathe");
  await expect(page.locator(".clip.fx[title^=\"fire breath · \"]")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".clip.fx")).toHaveCount(0);
  await expect(page.getByLabel("Move", { exact: true })).toHaveValue("walk");
});

test("tweak: + Shot adds a close-up and a white flash at the playhead", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: /\+ Shot/ }).click();
  const closeUp = page.getByRole("menuitem", { name: /^Close-up on / }).first();
  await expect(closeUp).toBeVisible();
  await closeUp.click();
  await expect(page.locator(".clip.shot", { hasText: "close-up" })).toHaveCount(1);
  await page.getByRole("button", { name: /\+ Shot/ }).click();
  await page.getByRole("menuitem", { name: "White flash" }).click();
  await expect(page.getByLabel("White flash (s)")).toHaveValue("0.3");
});

test("tweak: a close-up's zoom shows in the inspector and can be changed; Space picks a menu item", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await page.keyboard.press("ArrowRight");
  const shot = page.getByRole("button", { name: /\+ Shot/ });
  await shot.click();
  await expect(shot).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("menuitem", { name: /^Close-up on / }).first().click();
  await expect(shot).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Zoom follows")).not.toHaveValue("");
  await page.getByLabel("Zoom to (×)").fill("1");
  await page.getByLabel("Zoom to (×)").blur(); // change fires
  await expect(page.locator(".clip.shot", { hasText: "zoom out" })).toHaveCount(1);
  // Space on the focused first item ("Cut here") cuts instead of starting playback
  const shots = await page.locator(".clip.shot").count();
  await page.keyboard.press("ArrowLeft"); // back to 0.00 s, then one frame on: inside the first shot
  await page.keyboard.press("Shift+ArrowRight");
  await shot.click();
  await expect(page.getByRole("menuitem", { name: "Cut here" })).toBeFocused();
  await page.keyboard.press(" ");
  await expect(page.locator(".clip.shot")).toHaveCount(shots + 1);
  await expect(page.getByTestId("timecode")).toContainText("0.03");
});

test("tweak: in a close-up, clicking the character on screen picks them", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const canvas = page.getByTestId("preview");
  await expect(canvas).toHaveAttribute("data-ready", "1");
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: /\+ Shot/ }).click();
  await page.getByRole("menuitem", { name: /^Close-up on / }).first().click();
  await page.keyboard.press("Escape"); // drop the shot selection
  // a point on screen that shows the character once zoomed, but is empty in the same spot of the unzoomed frame
  const pt = await page.evaluate(async () => {
    const src = (f: string) => `/src/core/${f}.ts`;
    const { frameZoom } = await import(src("render"));
    const { zoomView } = await import(src("raster"));
    const { hitTest } = await import("/src/ui/stageEdit.ts" as string);
    const { loadProject } = await import(src("store"));
    let p = await loadProject(location.hash.split("/").pop()!);
    for (let i = 0; i < 30 && !p.tl.shots.some((s: any) => s.zoom); i++) { // the edit is saved a moment later
      await new Promise((r) => setTimeout(r, 100));
      p = await loadProject(location.hash.split("/").pop()!);
    }
    const imgs = new Map();
    for (const [path, blob] of p.files as Map<string, Blob>) {
      const bmp = await createImageBitmap(blob);
      imgs.set(path, { w: bmp.width, h: bmp.height, px: new Uint8ClampedArray(bmp.width * bmp.height * 4) });
    }
    const { W, H } = p.canvas, img = (k: string) => imgs.get(k) ?? null;
    const z = frameZoom({ tl: p.tl, kit: p.kit, img, draft: false, W, H }, 1)!;
    const v = zoomView(W, H, z.z, z.x, z.y, 1);
    const id = p.tl.actors[0].id, hit = (x: number, y: number) => hitTest(p.tl, p.kit, img, 1, x, y);
    for (let Y = 0; Y < H; Y += 2) for (let X = 0; X < W; X += 2) {
      const f = { x: v.cx + (X + 0.5 - W / 2) / v.P, y: v.cy + (Y + 0.5 - H / 2) / v.P };
      if (hit(f.x, f.y) === id && hit(X + 0.5, Y + 0.5) !== id) return { x: (X + 0.5) / W, y: (Y + 0.5) / H, name: id };
    }
    return null;
  });
  expect(pt).not.toBeNull();
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * pt!.x, y: box.height * pt!.y } });
  await expect(page.locator(".inspector h2")).toHaveText("Actor");
  await expect(page.locator(".track-label[data-actor]").first()).toHaveClass(/sel/); // the first actor, the one in the close-up
});

test("Say… puts a speech bubble on the actor's row, its words typed in the inspector", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await page.getByRole("menuitem", { name: "Say…" }).click();
  const words = page.getByLabel("Words", { exact: true });
  await words.fill("Run!");
  await words.press("Tab");
  await expect(page.locator(".clip", { hasText: "“Run!”" })).toBeVisible();
  await expect(page.getByLabel("Shown as", { exact: true })).toHaveValue("");
});

test("a flame's reach stretches it in one undo step", async ({ page }) => {
  await stageTweak(page);
  const drawer = page.getByTestId("drawer");
  await drawer.getByLabel("Search effects").fill("breath");
  await drawer.getByRole("button", { name: "fire breath" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".clip.fx")).toContainText("fire breath");
  const reach = page.getByLabel("Reach", { exact: true });
  await expect(reach).toHaveValue("1");
  await reach.selectOption("2.5");
  const fx = page.locator("output[aria-label=Effect]");
  await expect(fx).toHaveAttribute("data-asset", "fire-breath_r25", { timeout: 30000 });
  await expect(fx).toHaveText("fire breath");
  await expect(page.getByLabel("Reach", { exact: true })).toHaveValue("2.5");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(fx).toHaveAttribute("data-asset", "fire-breath");
});

test("keys: Home and End jump to the ends; [ and ] set the selected bar's start and end at the playhead", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.keyboard.press("End");
  await expect(page.getByTestId("timecode")).toContainText("frame 150");
  await page.keyboard.press("Home");
  await expect(page.getByTestId("timecode")).toContainText("frame 0");
  await page.locator("[data-id=a1]").click(); // the walk, 1 s to 3 s
  await page.keyboard.press("Home"); // the click may have moved the playhead
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("BracketLeft");
  await expect(page.getByLabel("Start (s)", { exact: true })).toHaveValue("2");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight"); // 4 s
  await page.keyboard.press("BracketRight");
  await expect(page.getByLabel("Length (s)", { exact: true })).toHaveValue("2");
});

test("scene notes: a still stretch is noted, and one click adds a look around", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[accept*=zip]").waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { newProject, toZip } = await import("/src/core/project.ts" as string);
    const p = newProject("Still scene");
    p.step = 3;
    p.tl = {
      name: "t", duration: 10, shots: [{ id: "s1", type: "wide", start: 0, end: 10, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
      actors: [{ id: "h1", char: "hero", x: 50, y: 100, actions: [] }], audio: [], fx: [],
    };
    const dt = new DataTransfer();
    dt.items.add(new File([await toZip(p)], "s.zip", { type: "application/zip" }));
    const input = document.querySelector<HTMLInputElement>("input[accept*=zip]")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.getByLabel("Project name")).toHaveValue("Still scene");
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const box = page.getByTestId("framing");
  await expect(box).toContainText("Nothing moves from 1.0 s to 10.0 s.");
  await box.getByRole("button", { name: /Add a look around/ }).click();
  await expect(box).toContainText("Nothing moves from 3.5 s to 10.0 s."); // 1.5-3.5 now moves
});

test("overlapping bars stack in lanes, so a short Hurt is not hidden under Turn to dust", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.locator("input[accept*=zip]").waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { newProject, toZip } = await import("/src/core/project.ts" as string);
    const p = newProject("Lanes");
    p.step = 3;
    p.tl = {
      name: "t", duration: 10, shots: [{ id: "s1", type: "wide", start: 0, end: 10, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
      actors: [{ id: "h1", char: "hero", x: 50, y: 100, actions: [{ id: "a1", t: 2, do: "hurt" }, { id: "a2", t: 2.1, do: "dust", dur: 1.5 }] }],
      audio: [], fx: [],
    };
    const dt = new DataTransfer();
    dt.items.add(new File([await toZip(p)], "l.zip", { type: "application/zip" }));
    const input = document.querySelector<HTMLInputElement>("input[accept*=zip]")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.getByLabel("Project name")).toHaveValue("Lanes");
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const hurt = await page.locator('.clip[data-id="a1"]').boundingBox();
  const dust = await page.locator('.clip[data-id="a2"]').boundingBox();
  expect(dust!.y).toBeGreaterThanOrEqual(hurt!.y + hurt!.height); // under it, not on top
  await page.locator(".tracks").screenshot({ path: "test-results/lanes.png" });
});

test("copy a move and paste it onto another actor at the playhead", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await page.getByTestId("drawer").getByRole("button", { name: "hero", exact: true }).click(); // a second hero
  await page.locator("[data-id=a1]").click(); // the first hero's walk
  await page.keyboard.press("Control+c");
  await page.locator(".track-label[data-actor=actor1]").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Control+v");
  await expect(page.locator(".track", { has: page.locator(".track-label[data-actor=actor1]") }).locator(".clip")).toHaveCount(1);
  await expect(page.getByLabel("Start (s)", { exact: true })).toHaveValue("1");
  await expect(page.getByLabel("Move", { exact: true })).toHaveValue("walk");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".track", { has: page.locator(".track-label[data-actor=actor1]") }).locator(".clip")).toHaveCount(0);
});

test("zoom the timeline: bars get wider, the names stay in view while it scrolls", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const walk = page.locator("[data-id=a1]");
  const w0 = (await walk.boundingBox())!.width;
  await page.getByRole("button", { name: "Zoom the timeline in" }).click();
  await page.getByRole("button", { name: "Zoom the timeline in" }).click();
  await expect.poll(async () => (await walk.boundingBox())!.width).toBeGreaterThan(w0 * 2);
  const tracks = page.getByTestId("tracks");
  expect(await tracks.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  await tracks.evaluate((e) => (e.scrollLeft = e.scrollWidth));
  for (const name of ["Shots", "hero"]) { // pinned at the left edge
    const label = page.locator(".track-label", { hasText: name });
    expect((await label.boundingBox())!.x, name).toBeLessThan((await tracks.boundingBox())!.x + 5);
  }
  // a click on the ruler still lands on the right time when zoomed and scrolled
  const ruler = page.locator(".ruler .lane");
  const rb = (await ruler.boundingBox())!, tb = (await tracks.boundingBox())!;
  await page.mouse.click(tb.x + tb.width - 20, rb.y + rb.height / 2);
  await expect(page.getByTestId("timecode")).toContainText(/^00:0(4\.\d\d|5\.00) \//);
  await page.getByRole("button", { name: "Zoom the timeline out" }).click();
  await page.getByRole("button", { name: "Zoom the timeline out" }).click();
  await expect.poll(async () => (await walk.boundingBox())!.width).toBeCloseTo(w0, 0);
});

test("Stand up: offered only while the actor is down, drawn as a moment, faded where it does nothing", async ({ page }) => {
  await openFixture(page, { extraAnim: "kneel" });
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await expect(page.getByRole("menuitem", { name: "Stand up" })).toHaveCount(0); // standing already
  await page.keyboard.press("Escape");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight"); // 4 s, after the walk
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await page.getByRole("menuitem", { name: "Play: kneel" }).click();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Add a move for hero" }).click();
  await page.getByRole("menuitem", { name: "Stand up" }).click(); // the kneel stays down, so this gets up
  const up = page.locator(".clip.mark", { hasText: "Stand up" });
  await expect(up).toHaveCount(1);
  await expect(up).not.toHaveClass(/noop/);
  await page.getByLabel("Start (s)", { exact: true }).fill("0");
  await page.getByLabel("Start (s)", { exact: true }).press("Enter");
  await expect(page.locator(".clip.mark", { hasText: "Stand up" })).toHaveClass(/noop/); // before the kneel: nothing to get up from
});

test("the play button keeps its icon while playing, so a click on the icon pauses", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  const btn = page.getByRole("button", { name: "Play (Space)" });
  await btn.click();
  const pause = page.getByRole("button", { name: "Pause (Space)" });
  await pause.evaluate((b) => ((window as any).icon = b.firstElementChild));
  await page.waitForTimeout(300); // several frames
  expect(await pause.evaluate((b) => b.firstElementChild === (window as any).icon)).toBe(true); // not rebuilt each frame
  await pause.locator("svg").click();
  await expect(page.getByRole("button", { name: "Play (Space)" })).toBeVisible();
});

test("bars work from the keyboard: Tab selects one, Alt+→ moves it a frame, ? lists the keys", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const bar = page.locator(".clip:not(.shot)").first();
  await bar.focus();
  await expect(bar).toHaveAttribute("aria-pressed", "true");
  const name = await bar.getAttribute("aria-label");
  expect(name).toMatch(/ s/);
  const before = await bar.evaluate((el) => parseFloat((el as HTMLElement).style.left));
  await page.keyboard.press("Alt+ArrowRight");
  const moved = page.locator(".clip[aria-pressed=true]");
  await expect(moved).toBeFocused();
  expect(await moved.evaluate((el) => parseFloat((el as HTMLElement).style.left))).toBeGreaterThan(before);
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText("Alt + ← →");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Keys" })).toBeFocused();
});

test("the add-move menu stays on screen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await openFixture(page, { extraAnim: "kneel" });
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.locator(".row-add[data-add]").last().click();
  const box = await page.getByRole("menu").boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(640);
});

test("screen readers: the preview says what is on screen, and a stopped playhead is announced", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const canvas = page.getByTestId("preview");
  await expect(canvas).toHaveAttribute("data-ready", "1");
  await expect(canvas).toHaveAttribute("aria-label", /^Preview at 0\.00 s, Shot 1 · .+, (.+ on stage|nobody on stage)$/);
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect(canvas).toHaveAttribute("aria-label", /^Preview at 1\.00 s/);
  await expect(page.getByTestId("sr-time")).toHaveText(/^1\.00 of .+ s, frame \d+$/);
  await expect(page.getByTestId("sr-time")).toHaveAttribute("aria-live", "polite");
});
