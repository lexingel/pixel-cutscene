import { expect, type Page } from "@playwright/test";
// @ts-ignore node types are not part of the browser build
import { spawnSync } from "node:child_process";
// @ts-ignore node types are not part of the browser build
import { existsSync } from "node:fs";

// The FFMPEG environment variable (a full path), else ffmpeg on PATH. Without either, the checks that read
// the file back are skipped with a message; the export itself still runs.
// @ts-ignore node types are not part of the browser build
const DEV_FFMPEG: string = process.env.FFMPEG ?? "";
// A build older than 4.0 can't decode VP9 here and ignores the colour-matrix option, so it would fail the checks.
const recent = (bin: string) => {
  const r = spawnSync(bin, ["-version"], { encoding: "utf8" });
  if (r.error) return false;
  const m = /version n?(\d+)\.\d/.exec(r.stdout), git = /version N-(\d+)/.exec(r.stdout);
  return m ? +m[1] >= 4 : git ? +git[1] >= 90000 : true;
};
// the copy pip's imageio-ffmpeg ships, when the PATH one is too old
const imageio = () => spawnSync("python", ["-c", "import imageio_ffmpeg as i; print(i.get_ffmpeg_exe())"], { encoding: "utf8" }).stdout?.trim() ?? "";
export const FFMPEG = [DEV_FFMPEG && existsSync(DEV_FFMPEG) ? DEV_FFMPEG : "", "ffmpeg", imageio()].find((b) => b && recent(b)) ?? null;
export const NO_FFMPEG = "no ffmpeg/ffprobe found (FFMPEG or PATH), so the exported file cannot be checked";
const text = (b: Uint8Array) => new TextDecoder().decode(b);
export const ff = (...args: string[]): { stdout: Uint8Array; stderr: Uint8Array } => spawnSync(FFMPEG!, args, { encoding: "buffer", maxBuffer: 64 << 20 });
/** `ffmpeg -i` stream info (stderr), plus the decoded video frame count. */
export function probe(file: string) {
  const info = text(ff("-i", file).stderr);
  const run = text(ff("-i", file, "-map", "0:v:0", "-f", "null", "-").stderr);
  const frames = Number([...run.matchAll(/frame=\s*(\d+)/g)].pop()?.[1]);
  return { info, frames };
}

export type FixtureOpts = {
  extraAnim?: string; // an approved extra anim on the hero (idle frames); "walk" makes the scene complete
  breathe?: boolean; // an approved 6-frame `breathe` anim on the hero (0.5 s at 12 fps)
  unapprovedAnim?: string; // an extra hero anim waiting for approval
  big?: boolean; // 960x540 canvas instead of 320x180
  sound?: boolean; // a 1 s 440 Hz tone at t = 0.5 s, approved
  unapproved?: boolean; // the tone is unapproved (implies sound)
};

/** Opens the fixture project, zipped with the app's own toZip and loaded through the "Open a project (.zip)" input.
 * 320x180 canvas, a solid field background, the hero's idle_0..3 and a 5 s timeline with one wide
 * shot and one walk (walk frames missing unless extraAnim is "walk", so it shows in Needs approval). */
export async function openFixture(page: Page, opts: FixtureOpts | string = {}) {
  const o: FixtureOpts = typeof opts === "string" ? { extraAnim: opts } : opts;
  await page.goto("/");
  await page.locator("input[accept*=zip]").waitFor({ state: "attached" });
  await page.evaluate(async (o) => {
    const src = (f: string) => `/src/core/${f}.ts`; // served by vite; a variable keeps tsc from resolving it
    const { newProject, toZip } = await import(src("project"));
    const p = newProject("Tweak fixture");
    p.step = 2;
    const [W, H] = o.big ? [960, 540] : [320, 180];
    p.canvas = { W, H, exportScale: 2 };
    const frames = [0, 1, 2, 3].map((i) => `chars/hero/idle/idle_${i}.png`);
    for (const [i, f] of frames.entries()) p.files.set(f, await (await fetch(`/test/fixtures/sprites/hero/idle_${i}.png`)).blob());
    const bg = new OffscreenCanvas(W, H);
    const g = bg.getContext("2d")!;
    g.fillStyle = "rgb(58 94 64)";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgb(200 170 90)";
    g.fillRect(0, H - 20, W, 20); // a sand strip, so frames have a hard colour edge
    p.files.set("bg/field.png", await bg.convertToBlob({ type: "image/png" }));
    p.kit = {
      chars: { hero: { view: "side", anims: { idle: { approved: true, source: "user", frames } } } } as Record<string, any>, faces: {},
      assets: { field: { approved: true, source: "user", kind: "bg", path: "bg/field.png" } } as Record<string, any>,
    };
    p.tl = {
      name: "tweak_fixture", duration: 5,
      shots: [{ id: "s1", type: "wide", start: 0, end: 5, bg: "field", bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
      actors: [{ id: "hero1", char: "hero", x: 80, y: 150, actions: [{ id: "a1", t: 1, do: "walk", to: [200, 150], dur: 2 }] }],
      fx: [], audio: [],
    };
    if (o.breathe) p.kit.chars.hero.anims.breathe = { approved: true, source: "user", frames: [0, 1, 2, 3, 0, 1].map((i) => frames[i]) };
    if (o.unapprovedAnim) p.kit.chars.hero.anims[o.unapprovedAnim] = { approved: false, source: "pixellab", frames };
    if (o.extraAnim) p.kit.chars.hero.anims[o.extraAnim] = { approved: true, source: "user", frames };
    if (o.sound || o.unapproved) {
      // 16-bit mono WAV, 1 s of 440 Hz at 48 kHz
      const n = 48000, buf = new DataView(new ArrayBuffer(44 + n * 2));
      const str = (at: number, s: string) => [...s].forEach((c, i) => buf.setUint8(at + i, c.charCodeAt(0)));
      str(0, "RIFF"); buf.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
      buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
      buf.setUint32(24, 48000, true); buf.setUint32(28, 96000, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
      str(36, "data"); buf.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) buf.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / 48000) * 12000), true);
      p.files.set("sfx/tone.wav", new Blob([buf.buffer], { type: "audio/wav" }));
      p.kit.assets.tone = { approved: !o.unapproved, source: "user", kind: "sfx", path: "sfx/tone.wav" };
      p.tl.audio.push({ id: "snd1", t: 0.5, clip: "tone", kind: "sfx" });
    }
    const dt = new DataTransfer();
    dt.items.add(new File([await toZip(p)], "tweak_fixture.zip", { type: "application/zip" }));
    const input = document.querySelector<HTMLInputElement>("input[accept*=zip]")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  }, o);
  await expect(page.getByLabel("Project name")).toHaveValue("Tweak fixture");
}

/** renderFrame(t) of the saved project at native size, as raw RGBA. */
export async function nativeFrame(page: Page, t: number, draft = false) {
  const b64 = await page.evaluate(async ({ t, draft }) => {
    const src = (f: string) => `/src/${f}.ts`; // served by vite; a variable keeps tsc from resolving it
    const { renderFrame } = await import(src("core/render"));
    const { loadProject } = await import(src("core/store"));
    const { decode } = await import(src("ui/cast"));
    const p = await loadProject(location.hash.split("/").pop()!);
    const imgs = new Map();
    for (const [path, blob] of p.files as Map<string, Blob>) if (path.endsWith(".png")) imgs.set(path, await decode(blob));
    const { W, H } = p.canvas;
    const want = { w: W, h: H, px: new Uint8ClampedArray(W * H * 4) };
    renderFrame({ tl: p.tl, kit: p.kit, img: (k: string) => imgs.get(k) ?? null, draft, W, H }, t, want);
    let s = "";
    for (let i = 0; i < want.px.length; i += 0x8000) s += String.fromCharCode(...want.px.subarray(i, i + 0x8000));
    return btoa(s);
  }, { t, draft });
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Opens the Approvals dialog on Tweak the way the top-bar band does (the band says "Ready" when nothing waits, so tests ask directly). */
export async function openApprovals(page: Page) {
  await page.locator(".tweak").evaluate((el) => el.dispatchEvent(new CustomEvent("pc:approvals")));
  await expect(page.getByRole("dialog", { name: "Approve pieces" })).toBeVisible();
}

/** Esc closes the Approvals dialog (it is modal, so the timeline is inert while it is open). */
export async function closeApprovals(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Approve pieces" })).toBeHidden();
}
