import { expect, test, type Page } from "@playwright/test";
// @ts-ignore node types are not part of the browser build
import { mkdirSync, readFileSync } from "node:fs";
import { FFMPEG, NO_FFMPEG, ff, nativeFrame, openFixture, probe } from "./fixture";

const OUT = "test-results/export";
mkdirSync(OUT, { recursive: true });
const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** One decoded frame as raw RGBA, read as BT.709 limited range (the HD default; ffmpeg alone would assume BT.601). */
function frameAt(file: string, n: number) {
  const r = ff("-i", file, "-vf", `select=eq(n\\,${n}),scale=in_color_matrix=bt709:in_range=tv`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-");
  return r.stdout;
}

async function exportAndSave(page: Page, button: string, file: string) {
  const dl = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: button }).click();
  const d = await dl;
  await d.saveAs(`${OUT}/${file}`);
  return d.suggestedFilename();
}

// H.264 is lossy, so "equals renderFrame" means within TOL per channel (see the task-15 report for the choice).
const TOL = 8;

test("export full: 1080p30 MP4 with sound, frame 60 is renderFrame(2.0) at x2 with no blur", async ({ page }) => {
  test.setTimeout(180_000);
  await openFixture(page, { extraAnim: "walk", big: true, sound: true });
  await page.getByRole("button", { name: "④ Export" }).click();
  await expect(page.getByTestId("format-note")).toContainText("MP4");
  const t0 = Date.now();
  const dl = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "Export video" }).click();
  await expect(page.getByTestId("export-progress")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/export-1280x800.png" });
  const d = await dl;
  console.log(`full export of the fixture (150 frames, 1920x1080): ${Date.now() - t0} ms`);
  expect(d.suggestedFilename()).toBe("Tweak fixture.mp4");
  await d.saveAs(`${OUT}/full.mp4`);
  await expect(page.getByTestId("export-progress")).toBeHidden();

  test.skip(!FFMPEG, NO_FFMPEG);
  const { info, frames } = probe(`${OUT}/full.mp4`);
  console.log(info);
  expect(info).toMatch(/Video: h264.*1920x1080/);
  expect(info).toMatch(/\b30 fps\b/);
  expect(info).toMatch(/Audio: aac.*48000 Hz, stereo/);
  expect(Math.abs(frames - 150)).toBeLessThanOrEqual(1);

  const big = frameAt(`${OUT}/full.mp4`, 60);
  expect(big.length).toBe(1920 * 1080 * 4);
  const want = await nativeFrame(page, 2.0);
  let worst = 0, blocky = 0, hero = 0;
  for (let y = 0; y < 540; y++) {
    for (let x = 0; x < 960; x++) {
      const w = (y * 960 + x) * 4;
      if (y < 540 - 20 && (want[w] !== 58 || want[w + 1] !== 94)) hero++; // above the sand strip: only the hero
      for (let c = 0; c < 3; c++) {
        const block = [0, 1].flatMap((dy) => [0, 1].map((dx) => big[((2 * y + dy) * 1920 + 2 * x + dx) * 4 + c]));
        const mean = (block[0] + block[1] + block[2] + block[3]) / 4; // the x2 frame downscaled back to native
        worst = Math.max(worst, Math.abs(mean - want[w + c]));
        blocky = Math.max(blocky, Math.max(...block) - Math.min(...block)); // a 2x2 block is one colour
      }
    }
  }
  console.log(`frame 60: worst channel error ${worst.toFixed(1)}, worst 2x2 spread ${blocky}`);
  expect(hero).toBeGreaterThan(50);
  expect(worst).toBeLessThanOrEqual(TOL);
  expect(blocky).toBeLessThanOrEqual(TOL);
});

test("webm_fallback: without H.264 the download is WebM and the note says so", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const orig = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = async (c) => (c.codec.startsWith("avc") ? { supported: false, config: c } : orig(c));
  });
  await openFixture(page, { extraAnim: "walk", sound: true });
  await page.getByRole("button", { name: "④ Export" }).click();
  await expect(page.getByTestId("format-note")).toContainText("Your browser can't make MP4, so this is WebM");
  expect(await exportAndSave(page, "Export video", "fallback.webm")).toBe("Tweak fixture.webm");

  test.skip(!FFMPEG, NO_FFMPEG);
  const { info, frames } = probe(`${OUT}/fallback.webm`);
  console.log(info);
  expect(info).toMatch(/Video: vp9.*640x360/);
  expect(info).toMatch(/Audio: opus/);
  expect(Math.abs(frames - 150)).toBeLessThanOrEqual(1);
});

test("export_refused_with_missing: an unapproved piece blocks the full export; a draft goes through with the watermark", async ({ page }) => {
  test.setTimeout(120_000);
  await openFixture(page, { extraAnim: "walk", unapproved: true });
  await page.getByRole("button", { name: "④ Export" }).click();
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.getByRole("button", { name: "Export video" }).click();
  await expect(page.getByRole("alert")).toContainText("tone");
  await expect(page.getByRole("alert")).toContainText("unapproved");
  await page.waitForTimeout(300);
  expect(downloads).toBe(0);

  await page.getByLabel(/Draft/).check();
  expect(await exportAndSave(page, "Export video", "draft.mp4")).toBe("Tweak fixture_DRAFT.mp4");

  test.skip(!FFMPEG, NO_FFMPEG);
  // native 320x180 draws the watermark at k = 1 from (287, 4), top right; the D's top-left pixel is white, x2 in the file
  const f = frameAt(`${OUT}/draft.mp4`, 0);
  const at = (x: number, y: number) => [...f.subarray((y * 640 + x) * 4, (y * 640 + x) * 4 + 3)];
  for (const v of at(575, 9)) expect(v).toBeGreaterThan(255 - TOL);
  const plain = await nativeFrame(page, 0);
  expect([...plain.subarray((4 * 320 + 287) * 4, (4 * 320 + 287) * 4 + 3)]).not.toEqual([255, 255, 255]); // only the draft has it
});

test("store loop: a range as native-size WebM and as a 15 fps GIF; cancel never downloads", async ({ page }) => {
  test.setTimeout(120_000);
  await openFixture(page, { extraAnim: "walk" });
  await page.getByRole("button", { name: "④ Export" }).click();
  await page.getByLabel("From (s)").fill("1");
  await page.getByLabel("To (s)").fill("2");
  await page.getByLabel("Loop format").selectOption("webm");
  expect(await exportAndSave(page, "Export loop", "loop.webm")).toBe("Tweak fixture_loop.webm");
  await page.getByLabel("Loop format").selectOption("gif");
  expect(await exportAndSave(page, "Export loop", "loop.gif")).toBe("Tweak fixture_loop.gif");
  const gif: Uint8Array = readFileSync(`${OUT}/loop.gif`);
  const dv = new DataView(gif.buffer, gif.byteOffset);
  expect(text(gif.subarray(0, 6))).toBe("GIF89a");
  expect([dv.getUint16(6, true), dv.getUint16(8, true)]).toEqual([320, 180]);

  let downloads = 0;
  page.on("download", () => downloads++);
  await page.getByRole("button", { name: "Export video" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("export-progress")).toBeHidden();
  await expect(page.getByRole("alert")).toContainText("cancelled");
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);

  test.skip(!FFMPEG, NO_FFMPEG);
  const { info, frames } = probe(`${OUT}/loop.webm`);
  expect(info).toMatch(/Video: vp9.*320x180/);
  expect(info).not.toMatch(/Audio:/);
  expect(frames).toBe(30);
  const gifInfo = probe(`${OUT}/loop.gif`);
  expect(gifInfo.frames).toBe(15);
});

test("export vertical share: a 1080x1920 slice for phones, named _vertical", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const ask = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    (window as any).asked = [];
    VideoEncoder.isConfigSupported = (c: VideoEncoderConfig) => ((window as any).asked.push(`${c.width}x${c.height}`), ask(c));
  });
  await openFixture(page, { extraAnim: "walk", big: true, sound: true });
  await page.getByRole("button", { name: "④ Export" }).click();
  await page.getByLabel("Shape").selectOption("vertical");
  await expect(page.getByTestId("full-size")).toContainText("1080×1920");
  await expect(page.getByLabel("Slice centre x")).toBeVisible();
  await page.getByLabel("Quality").selectOption("share");
  expect(await exportAndSave(page, "Export video", "vertical.mp4")).toBe("Tweak fixture_vertical.mp4");
  expect(await page.evaluate(() => (window as any).asked)).toContain("1080x1920"); // the codec is checked at the size it encodes
  test.skip(!FFMPEG, NO_FFMPEG);
  const { info } = probe(`${OUT}/vertical.mp4`);
  expect(info).toMatch(/Video: h264.*1080x1920/);
});

test("export square: a 1080x1080 slice for posts, named _square", async ({ page }) => {
  test.setTimeout(180_000);
  await openFixture(page, { extraAnim: "walk", big: true, sound: true });
  await page.getByRole("button", { name: "④ Export" }).click();
  await page.getByLabel("Shape").selectOption("square");
  await expect(page.getByTestId("full-size")).toContainText("1080×1080");
  await page.getByLabel("Shape").selectOption("wide");
  await expect(page.getByLabel("Slice centre x")).toBeHidden();
  await page.getByLabel("Shape").selectOption("square");
  expect(await exportAndSave(page, "Export video", "square.mp4")).toBe("Tweak fixture_square.mp4");
  test.skip(!FFMPEG, NO_FFMPEG);
  const { info } = probe(`${OUT}/square.mp4`);
  expect(info).toMatch(/Video: h264.*1080x1080/);
});

test("a square draft keeps its DRAFT mark (stamped after the slice is cut)", async ({ page }) => {
  test.setTimeout(180_000);
  await openFixture(page, { extraAnim: "walk", unapproved: true });
  await page.getByRole("button", { name: "④ Export" }).click();
  await page.getByLabel(/Draft/).check();
  await page.getByLabel("Shape").selectOption("square");
  expect(await exportAndSave(page, "Export video", "sqdraft.mp4")).toBe("Tweak fixture_square_DRAFT.mp4");
  test.skip(!FFMPEG, NO_FFMPEG);
  const f = frameAt(`${OUT}/sqdraft.mp4`, 0);
  // 1080 tall: k 6, the D's top-left block at (1080 - 24 - 174, 24)
  for (const v of [...f.subarray((27 * 1080 + 885) * 4, (27 * 1080 + 885) * 4 + 3)]) expect(v).toBeGreaterThan(255 - TOL);
});

test("store loops are made at Best quality, whatever the Quality select says", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const conf = VideoEncoder.prototype.configure;
    (window as any).rates = [];
    VideoEncoder.prototype.configure = function (c: VideoEncoderConfig) { (window as any).rates.push([c.width, c.bitrate]); return conf.call(this, c); };
  });
  await openFixture(page, { extraAnim: "walk" });
  await page.getByRole("button", { name: "④ Export" }).click();
  await expect(page.getByLabel("Quality")).toHaveValue("share");
  await page.getByLabel("From (s)").fill("1");
  await page.getByLabel("To (s)").fill("2");
  await page.getByLabel("Loop format").selectOption("webm");
  await exportAndSave(page, "Export loop", "loop_q.webm");
  const best = await page.evaluate(async () => (await import(`/src/export/${"encode"}.ts`)).bitrate(320, 180, "best"));
  expect(await page.evaluate(() => (window as any).rates)).toEqual([[320, best]]);
});

test("a ready scene says so, hides Draft, shows a still, and names the saved file after an export", async ({ page }) => {
  test.setTimeout(120_000);
  await openFixture(page, { extraAnim: "walk" });
  await page.getByRole("button", { name: "④ Export" }).click();
  await expect(page.getByTestId("ready")).toBeVisible();
  await expect(page.getByTestId("draft-row")).toBeHidden();
  await expect(page.getByTestId("poster-note")).toContainText("at 0.0 s");
  await page.getByLabel("From (s)").fill("1.5");
  await expect(page.getByTestId("poster-note")).toContainText("at 1.5 s");
  const lit = await page.locator(".poster canvas").evaluate((c: HTMLCanvasElement) =>
    c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0));
  expect(lit).toBe(true);
  await page.getByLabel("To (s)").fill("2");
  expect(await exportAndSave(page, "Export loop", "done.webm")).toBe("Tweak fixture_loop.webm");
  await expect(page.getByTestId("export-done")).toContainText("Saved Tweak fixture_loop.webm");
  await expect(page.getByRole("button", { name: "Make a store loop next" })).toBeHidden();
});

test("a scene with missing pieces offers Draft and no ready line", async ({ page }) => {
  await openFixture(page, { extraAnim: "walk", unapproved: true });
  await page.getByRole("button", { name: "④ Export" }).click();
  await expect(page.getByTestId("draft-row")).toBeVisible();
  await expect(page.getByTestId("ready")).toBeHidden();
});

test("Project files: the .zip and project.json download from the export page", async ({ page }) => {
  await openFixture(page, { extraAnim: "walk" });
  await page.getByRole("button", { name: "④ Export" }).click();
  expect(await exportAndSave(page, "Download project (.zip)", "proj.zip")).toBe("Tweak fixture.zip");
  expect(await exportAndSave(page, "project.json only", "proj.json")).toBe("Tweak fixture.json");
  const j = JSON.parse(text(readFileSync(`${OUT}/proj.json`)));
  expect(j.tl.shots.length).toBeGreaterThan(0);
  expect(j.files).toBeUndefined();
});
