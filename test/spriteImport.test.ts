import { describe, expect, it } from "vitest";
import type { Img } from "../src/core/kit";
import { checkSprite, downscale, gridScale, guessAnims, KNOWN_ANIMS } from "../src/core/spriteImport";

const mk = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Img => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(f(x, y), (y * w + x) * 4);
  return { w, h, px };
};
// small pixel-art fixture: few colours, transparent corners, no accidental uniform 2x2 blocks
const art = (): Img =>
  mk(12, 12, (x, y) => ((x + y) % 5 === 0 ? [0, 0, 0, 0] : [(x * 37) % 256, (y * 53) % 256, (x * y) % 256, 255]));
const up = (img: Img, k: number): Img =>
  mk(img.w * k, img.h * k, (x, y) => {
    const i = ((Math.floor(y / k)) * img.w + Math.floor(x / k)) * 4;
    return [img.px[i], img.px[i + 1], img.px[i + 2], img.px[i + 3]];
  });

describe("guessAnims", () => {
  it("guess_folder_names", () => {
    const r = guessAnims(["hero/idle/b.png", "hero\\walk\\2.png", "hero/walk/1.png", "hero/idle/a.png", "x.png"]);
    expect(r.idle).toEqual(["hero/idle/a.png", "hero/idle/b.png"]);
    expect(r.walk).toEqual(["hero/walk/1.png", "hero\\walk\\2.png"]);
    expect(r["?"]).toEqual(["x.png"]);
    expect(KNOWN_ANIMS).toContain("cast");
  });
  it("guess_prefix_numbering", () => {
    const paths = Array.from({ length: 6 }, (_, i) => `legend_warrior_idle_${[3, 10, 1, 2, 6, 5][i]}.png`);
    paths.push("legend_warrior_idle_4.png");
    const r = guessAnims(paths.filter((p) => !p.endsWith("_10.png")));
    expect(r.idle.map((p) => p.match(/_(\d+)\.png/)![1])).toEqual(["1", "2", "3", "4", "5", "6"]);
    const r2 = guessAnims(["a_walk_10.png", "a_walk_2.png", "a_walk_1.png"]);
    expect(r2.walk).toEqual(["a_walk_1.png", "a_walk_2.png", "a_walk_10.png"]);
  });
  it("guess_bare_anim_number", () => {
    expect(guessAnims(["attack2.png", "attack1.png"]).attack).toEqual(["attack1.png", "attack2.png"]);
  });
  it("guess_bare_with_separator", () => {
    const r = guessAnims(["idle_1.png", "idle_0.png", "walk3.png", "attack-1.png", "Idle_10.png", "idle_2.png"]);
    expect(r.idle).toEqual(["idle_0.png", "idle_1.png", "idle_2.png", "Idle_10.png"]);
    expect(r.walk).toEqual(["walk3.png"]);
    expect(r.attack).toEqual(["attack-1.png"]);
    expect(r["?"]).toBeUndefined();
  });
});

describe("grid", () => {
  it("grid_x2_detected_and_downscaled_losslessly", () => {
    const o = art();
    expect(gridScale(o)).toBe(1);
    const u = up(o, 2);
    expect(gridScale(u)).toBe(2);
    expect(downscale(u, 2)).toEqual(o);
    expect(gridScale(up(o, 3))).toBe(3);
  });
  it("mixed_scale_refused", () => {
    const r = checkSprite([up(art(), 2), up(art(), 3)]);
    expect(r).toEqual({ ok: false, reason: "frames are drawn at different pixel sizes" });
  });
  it("photo_refused", () => {
    const photo = mk(100, 100, (x, y) => [(x * 2) % 256, (y * 2) % 256, (x + y) % 256, 255]);
    // 100x100 gradient: ensure >4096 colours
    const r = checkSprite([photo]);
    expect(r).toEqual({ ok: false, reason: "this doesn't look like pixel art" });
  });
  it("blank_frame_ignored_in_scale_check", () => {
    const blank = mk(24, 24, () => [0, 0, 0, 0]);
    const flat = mk(24, 24, () => [9, 9, 9, 255]);
    expect(checkSprite([up(art(), 2), blank, flat])).toEqual({ ok: true, scale: 2 });
    expect(checkSprite([blank, blank])).toEqual({ ok: true, scale: 1 });
  });
  it("ok_returns_scale", () => {
    expect(checkSprite([up(art(), 2), up(art(), 2)])).toEqual({ ok: true, scale: 2 });
  });
});
