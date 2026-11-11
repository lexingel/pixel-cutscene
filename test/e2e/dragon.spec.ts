import { expect, test, type Page } from "@playwright/test";
import { FFMPEG, NO_FFMPEG, nativeFrame, probe } from "./fixture";

const DURATION = 6;
const HEROES = [500, 570, 640]; // feet x of the three heroes; y is 400 on a 960x540 canvas

/** A 960x540 project: three hero copies standing in a row, and a dragon char (scale 2) with hand-drawn
 * stand-ins (a 40x32 red shape: idle x2, breathe x6) made in the page. The dragon is NOT on the timeline. */
async function buildProject(page: Page) {
  await page.goto("/");
  await page.locator("input[accept*=zip]").waitFor({ state: "attached" });
  await page.evaluate(async ({ DURATION, HEROES }) => {
    const src = (f: string) => `/src/core/${f}.ts`;
    const { newProject, toZip } = await import(src("project"));
    const p = newProject("Dragon scene");
    p.step = 2;
    p.canvas = { W: 960, H: 540, exportScale: 2 };
    const idle = [0, 1, 2, 3].map((i) => `chars/hero/idle/idle_${i}.png`);
    for (const [i, f] of idle.entries()) p.files.set(f, await (await fetch(`/test/fixtures/sprites/hero/idle_${i}.png`)).blob());
    const shape = async (i: number) => {
      const c = new OffscreenCanvas(40, 32), g = c.getContext("2d")!;
      g.fillStyle = "rgb(190 40 40)"; g.fillRect(4, 8 + (i % 2), 32, 24 - (i % 2)); // body
      g.fillStyle = "rgb(120 20 20)"; g.fillRect(30, 2 + (i % 3), 10, 10); // head
      g.fillStyle = "rgb(250 220 80)"; g.fillRect(36, 5 + (i % 3), 2, 2); // eye
      return c.convertToBlob({ type: "image/png" });
    };
    const anim = async (name: string, n: number) => {
      const frames: string[] = [];
      for (let i = 0; i < n; i++) {
        const f = `chars/dragon/${name}/${name}_${i}.png`;
        p.files.set(f, await shape(name === "idle" ? i : i + 2));
        frames.push(f);
      }
      return { approved: true, source: "user", frames };
    };
    const bg = new OffscreenCanvas(960, 540), g = bg.getContext("2d")!;
    g.fillStyle = "rgb(58 94 64)"; g.fillRect(0, 0, 960, 540);
    g.fillStyle = "rgb(200 170 90)"; g.fillRect(0, 520, 960, 20);
    p.files.set("bg/field.png", await bg.convertToBlob({ type: "image/png" }));
    p.kit = {
      chars: {
        hero: { view: "side", anims: { idle: { approved: true, source: "user", frames: idle } } },
        dragon: { view: "side", scale: 2, anims: { idle: await anim("idle", 2), breathe: await anim("breathe", 6) } },
      } as Record<string, any>,
      faces: {}, assets: { field: { approved: true, source: "user", kind: "bg", path: "bg/field.png" } } as Record<string, any>,
    };
    p.tl = {
      name: "dragon", duration: DURATION,
      shots: [{ id: "s1", type: "wide", start: 0, end: DURATION, bg: "field", bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
      actors: HEROES.map((x: number, i: number) => ({ id: `hero${i + 1}`, char: "hero", x, y: 400, actions: [] })),
      fx: [], audio: [],
    };
    const dt = new DataTransfer();
    dt.items.add(new File([await toZip(p)], "dragon.zip", { type: "application/zip" }));
    const input = document.querySelector<HTMLInputElement>("input[accept*=zip]")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  }, { DURATION, HEROES });
  await expect(page.getByLabel("Project name")).toHaveValue("Dragon scene");
}

/** Puts the playhead at seconds + frames/30, by key presses from where it is now (ArrowRight = 1 s, Shift = 1 frame). */
async function seekTo(page: Page, seconds: number, frames: number) {
  const tc = page.getByTestId("timecode").locator("b");
  const [m, sec] = (await tc.innerText()).split(":"); // "00:03.40"
  const now = Math.round((Number(m) * 60 + Number(sec)) * 30);
  const want = seconds * 30 + frames;
  expect(want).toBeGreaterThanOrEqual(now);
  await page.getByTestId("preview").focus();
  await page.keyboard.press("Escape"); // with something selected the arrows nudge it instead of scrubbing
  let left = want - now;
  for (; left >= 30; left -= 30) await page.keyboard.press("ArrowRight");
  for (; left > 0; left--) await page.keyboard.press("Shift+ArrowRight");
  await expect(tc).toHaveText(`00:${(want / 30).toFixed(2).padStart(5, "0")}`); // scenes here are under a minute
}

/** No entry id (a1, f1, s1, actor1, hero1...) in the visible text, a tooltip or an aria-label. */
async function expectNoIds(page: Page) {
  const seen = await page.evaluate(() => [
    document.body.innerText,
    ...[...document.querySelectorAll("[title],[aria-label]")].flatMap((e) => [e.getAttribute("title") ?? "", e.getAttribute("aria-label") ?? ""]),
  ]);
  for (const text of seen) expect(text).not.toMatch(/(a|f|s|actor|hero|dragon|sound)\d+/);
}

const addMove = async (page: Page, actor: string, move: string) => {
  await page.getByRole("button", { name: `Add a move for ${actor}` }).click();
  await page.getByRole("menuitem", { name: move }).click();
};

test("three heroes, a dragon, fire, dust", async ({ page }) => {
  test.setTimeout(300_000);
  await buildProject(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");

  // the dragon: dragged from the drawer, feet at (160, 400)
  const canvas = page.getByTestId("preview");
  const box = (await canvas.boundingBox())!;
  await page.getByTestId("drawer").getByRole("button", { name: "dragon", exact: true }).dragTo(canvas, {
    targetPosition: { x: (160 * box.width) / 960, y: (400 * box.height) / 540 },
  });
  await expect(page.getByLabel("X", { exact: true })).toHaveValue(/^(159|160|161)$/); // the drop point is in screen pixels
  await expect(page.getByLabel("Y", { exact: true })).toHaveValue(/^(399|400|401)$/);
  const dragon = "dragon"; // rows are named by character; the three heroes are "hero 1" to "hero 3"
  await expect(page.locator(".track-label[data-actor] .who")).toHaveText(["hero 1", "hero 2", "hero 3", dragon]);

  await seekTo(page, 3, 0);
  await addMove(page, dragon, "Breathe fire");
  const flame = page.locator(".clip.fx[title=\"fire breath\"]");
  await expect(flame).toBeVisible({ timeout: 60_000 }); // the first bake loads the effect's chunk
  const flameW = (await flame.boundingBox())!.width, laneW = (await page.locator(".lane").first().boundingBox())!.width;
  expect(flameW).toBeLessThan((laneW * 1.2) / DURATION); // a one-second breath, not the rest of the scene
  expect(flameW).toBeGreaterThan((laneW * 0.8) / DURATION);
  await flame.click();

  // aim it at the heroes: drag the handle (24 px right of the mouth) to a point a little below the mouth; the re-bake takes seconds
  const mx = Number(await page.getByLabel("X", { exact: true }).inputValue()), my = Number(await page.getByLabel("Y", { exact: true }).inputValue());
  const pv = (await canvas.boundingBox())!, k = pv.width / 960;
  await page.mouse.move(pv.x + (mx + 24) * k, pv.y + my * k);
  await page.mouse.down();
  await page.mouse.move(pv.x + (mx + 100) * k, pv.y + (my + 8) * k, { steps: 4 });
  await page.mouse.move(pv.x + (mx + 200) * k, pv.y + (my + 18) * k, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("output[aria-label=Effect]")).toHaveAttribute("data-asset", /_a5(_r\d+)?$/, { timeout: 120_000 });

  await seekTo(page, 3, 18); // 3.6 s
  for (let i = 1; i <= 3; i++) await addMove(page, `hero ${i}`, "Hurt");
  await seekTo(page, 3, 24); // 3.8 s
  for (let i = 1; i <= 3; i++) await addMove(page, `hero ${i}`, "Turn to dust");
  await expect(page.locator(".clip[title$=\"· Turn to dust\"]")).toHaveCount(3);
  await expect(page.locator(".clip[title$=\"· Hurt\"]")).toHaveCount(3);

  // the screenshot at 3.4 s, while the flame burns (a step back, which the keys allow)
  await page.getByTestId("preview").focus();
  await page.keyboard.press("Escape");
  for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowLeft");
  await expect(page.getByTestId("timecode").locator("b")).toHaveText("00:03.40");
  await page.locator(".clip[title$=\"· Turn to dust\"]").first().click(); // some selection, to show the inspector with a plain label
  await expectNoIds(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/dragon-1280x800.png" });

  // a full export: 1920x1080, DURATION x 30 frames (as a Draft only if something is still missing)
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const draftBox = page.getByLabel(/Draft/);
  if (await draftBox.isVisible()) await draftBox.check();
  const dl = page.waitForEvent("download", { timeout: 240_000 });
  await page.getByRole("button", { name: "Export video" }).click();
  const d = await dl;
  await d.saveAs("test-results/export/dragon.mp4");

  // Hero pixels: those exactly in a hero sprite's palette, inside a box around each hero (the dust drifts at most
  // 16 px sideways and 12 up). Fading dust is blended (off-palette) and drifted pixels leave the sprite's shape,
  // so a dust under way has fewer. The flame is never exactly a hero colour.
  const palette = await page.evaluate(async () => {
    const bmp = await createImageBitmap(await (await fetch("/test/fixtures/sprites/hero/idle_0.png")).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d")!;
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data, s = new Set<number>();
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] === 255) s.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    return [...s];
  });
  const own = new Set(palette);
  const heroPixels = (f: Uint8Array) => {
    let n = 0;
    for (const cx of HEROES) for (let y = 400 - 24 - 12; y <= 400; y++) for (let x = cx - 8 - 16; x <= cx + 8 + 16; x++) {
      const i = (y * 960 + x) * 4;
      if (own.has((f[i] << 16) | (f[i + 1] << 8) | f[i + 2])) n++;
    }
    return n;
  };
  const before = heroPixels(await nativeFrame(page, 3.0)), after = heroPixels(await nativeFrame(page, 4.5));
  console.log(`hero pixels: ${before} at 3.0 s, ${after} at 4.5 s`);
  expect(before).toBeGreaterThan(100);
  expect(after).toBeLessThan(before);

  test.skip(!FFMPEG, NO_FFMPEG);
  const { info, frames } = probe("test-results/export/dragon.mp4");
  expect(info).toMatch(/Video: h264.*1920x1080/);
  expect(info).toMatch(/\b30 fps\b/);
  expect(Math.abs(frames - DURATION * 30)).toBeLessThanOrEqual(1);
});
