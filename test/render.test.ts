import { describe, expect, test } from "vitest";
import miniText from "../../tests/fixtures/mini.json?raw";
import { bakeFx, renderFxFrames } from "../src/core/fxBake";
import type { Img, Kit } from "../src/core/kit";
import { blit } from "../src/core/raster";
import { renderFrame, type RenderInput } from "../src/core/render";
import type { Timeline } from "../src/core/types";
import * as torch from "../vendor/pixelfx/src/fx/fire/torch.js";

const solid = (w: number, h: number, r: number, g = 0, b = 0, a = 255): Img => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([r, g, b, a], i * 4);
  return { w, h, px };
};
const at = (im: Img, x: number, y: number) => Array.from(im.px.slice((y * im.w + x) * 4, (y * im.w + x) * 4 + 4));
const count = (im: Img, rgba: number[]) => {
  let n = 0;
  for (let i = 0; i < im.w * im.h; i++) if (rgba.every((v, k) => im.px[i * 4 + k] === v)) n++;
  return n;
};
const tl = (): Timeline => JSON.parse(miniText);
const emptyKit = (): Kit => ({ chars: {}, faces: {}, assets: {} });
const piece = { approved: true, source: "user" as const };
const BLACK = [0, 0, 0, 255];

function setup(t: Timeline, kit: Kit, imgs: Record<string, Img>, draft = false, W = 200, H = 120) {
  const p: RenderInput = { tl: t, kit, img: (path) => imgs[path] ?? null, draft, W, H };
  const out = solid(W, H, 9, 9, 9);
  return { p, out, draw: (time: number) => renderFrame(p, time, out) };
}
// a one-shot wide shot with no actors, fx or camera movement
const flat = (t: Timeline) => {
  t.actors = [];
  t.fx = [];
  const s = t.shots[0];
  if (s.type === "wide") s.camera = [];
  return t;
};

describe("raster", () => {
  const rb = (): Img => ({ w: 2, h: 1, px: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) });
  test("blit_scale2_exact", () => {
    const dst = solid(20, 20, 0);
    blit(dst, rb(), 3, 4, 2);
    expect(count(dst, [255, 0, 0, 255])).toBe(4);
    expect(count(dst, [0, 0, 255, 255])).toBe(4);
    for (const [x, y] of [[3, 4], [4, 4], [3, 5], [4, 5]]) expect(at(dst, x, y)).toEqual([255, 0, 0, 255]);
    for (const [x, y] of [[5, 4], [6, 4], [5, 5], [6, 5]]) expect(at(dst, x, y)).toEqual([0, 0, 255, 255]);
  });
  test("blit_flip", () => {
    const dst = solid(4, 1, 0);
    blit(dst, rb(), 1, 0, 1, true);
    expect(at(dst, 1, 0)).toEqual([0, 0, 255, 255]);
    expect(at(dst, 2, 0)).toEqual([255, 0, 0, 255]);
  });
  test("alpha: 0 skipped, partial blended, clipped at edges", () => {
    const dst = solid(2, 1, 100, 100, 100);
    const src: Img = { w: 3, h: 1, px: new Uint8ClampedArray([255, 0, 0, 0, 200, 200, 200, 128, 0, 0, 0, 255]) };
    blit(dst, src, 0, 0);
    expect(at(dst, 0, 0)).toEqual([100, 100, 100, 255]);
    expect(at(dst, 1, 0)).toEqual([150, 150, 150, 255]);
    blit(dst, src, -5, 7); // fully outside: no throw
  });
});

describe("renderFrame", () => {
  test("bg_scale_and_camera", () => {
    const bg: Img = { w: 100, h: 100, px: new Uint8ClampedArray(100 * 100 * 4) };
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) bg.px.set([x, y, 7, 255], (y * 100 + x) * 4);
    const t = flat(tl());
    const s = t.shots[0];
    if (s.type !== "wide") throw new Error("fixture");
    s.bg_scale = 2;
    s.camera = [{ t: 0, x: 21, y: 11 }];
    const kit = emptyKit();
    kit.assets.rift_vista = { ...piece, kind: "bg", path: "bg.png" };
    const r = setup(t, kit, { "bg.png": bg });
    r.draw(1);
    expect(at(r.out, 0, 0)).toEqual([10, 5, 7, 255]);
    expect(at(r.out, 1, 1)).toEqual([11, 6, 7, 255]); // (21+1)/2, (11+1)/2
    expect(at(r.out, 3, 0)[0]).toBe(12);
  });

  const warriorKit = (approved: boolean): Kit => ({
    chars: { legend_warrior: { view: "side", anims: { idle: { ...piece, approved, frames: ["i.png"] } } } },
    faces: {},
    assets: {},
  });
  const actorTl = () => {
    const t = flat(tl());
    t.actors = [{ id: "warrior", char: "legend_warrior", x: 10, y: 40, actions: [], appear: 1 }];
    return t;
  };
  const red = { "i.png": solid(4, 4, 255, 0, 0) };

  test("actor_hidden_before_appear", () => {
    const r = setup(actorTl(), warriorKit(true), red);
    r.draw(0.5);
    expect(at(r.out, 8, 36)).toEqual(BLACK);
    r.draw(1.5);
    expect(at(r.out, 8, 36)).toEqual([255, 0, 0, 255]);
    expect(at(r.out, 11, 39)).toEqual([255, 0, 0, 255]);
    expect(at(r.out, 12, 39)).toEqual(BLACK);
  });
  test("unapproved_not_drawn", () => {
    const r = setup(actorTl(), warriorKit(false), red);
    r.draw(1.5);
    expect(at(r.out, 8, 36)).toEqual(BLACK);
    expect(count(r.out, [255, 255, 255, 255])).toBe(0);
  });
  test("unapproved_drawn_in_draft, with a DRAFT watermark", () => {
    const r = setup(actorTl(), warriorKit(false), red, true);
    r.draw(1.5);
    expect(at(r.out, 8, 36)).toEqual([255, 0, 0, 255]);
    expect(count(r.out, [255, 255, 255, 255])).toBeGreaterThan(20);
    const clean = setup(actorTl(), warriorKit(true), red, false);
    clean.draw(1.5);
    expect(count(clean.out, [255, 255, 255, 255])).toBe(0);
  });
  test("actors are sorted by feet y", () => {
    const t = actorTl();
    t.actors = [
      { id: "front", char: "a", x: 10, y: 40, actions: [] },
      { id: "back", char: "b", x: 10, y: 38, actions: [] },
    ];
    const kit = emptyKit();
    kit.chars.a = { view: "side", anims: { idle: { ...piece, frames: ["a.png"] } } };
    kit.chars.b = { view: "side", anims: { idle: { ...piece, frames: ["b.png"] } } };
    const r = setup(t, kit, { "a.png": solid(4, 4, 255), "b.png": solid(4, 4, 0, 255) });
    r.draw(0);
    expect(at(r.out, 9, 37)).toEqual([255, 0, 0, 255]); // overlap: the lower one is in front
    expect(at(r.out, 9, 34)).toEqual([0, 255, 0, 255]);
  });

  test("fade_in_black_at_0 and the fade cases", () => {
    const t = flat(tl());
    t.shots[0].fade_in = 1;
    t.shots[0].fade_out = 2;
    const kit = emptyKit();
    kit.assets.rift_vista = { ...piece, kind: "bg", path: "bg.png" };
    const r = setup(t, kit, { "bg.png": solid(200, 120, 200, 100, 50) });
    r.draw(0);
    expect(count(r.out, BLACK)).toBe(200 * 120);
    r.draw(0.5);
    expect(at(r.out, 5, 5)).toEqual([100, 50, 25, 255]);
    r.draw(3);
    expect(at(r.out, 5, 5)).toEqual([200, 100, 50, 255]);
    r.draw(5);
    expect(at(r.out, 5, 5)).toEqual([100, 50, 25, 255]);
  });

  test("closeup_backdrop_covers", () => {
    const kit = emptyKit();
    kit.assets.warrior_realm = { ...piece, kind: "backdrop", path: "b.png" };
    kit.faces.warrior = { neutral: { ...piece, path: "f.png" } };
    const imgs = { "b.png": solid(320, 180, 100, 150, 200), "f.png": solid(10, 10, 255, 255, 0) };
    const r = setup(tl(), kit, imgs, false, 960, 540);
    r.draw(6.5);
    expect(count(r.out, [100, 150, 200, 255])).toBe(960 * 540 - 30 * 30); // x3 covers it all, face is 30x30
    expect(at(r.out, 465, 510)).toEqual([255, 255, 0, 255]);
    expect(at(r.out, 464, 510)).toEqual([100, 150, 200, 255]);
    expect(at(r.out, 494, 539)).toEqual([255, 255, 0, 255]);
  });

  describe("fx", () => {
    // 13 frames in a row, 2x2 each; frame i is red = (i+1)*10
    const sheet = (): Img => {
      const im = solid(26, 2, 0, 0, 0, 0);
      for (let i = 0; i < 13; i++) for (let k = 0; k < 4; k++) im.px.set([(i + 1) * 10, 0, 0, 255], ((k >> 1) * 26 + i * 2 + (k & 1)) * 4);
      return im;
    };
    const fxKit = (loop: boolean, dx = 0, dy = 0): Kit => {
      const kit = emptyKit();
      kit.assets.heal_fx = { ...piece, kind: "fx", path: "s.png", fx: { cols: 13, frames: 13, fps: 12, loop, dx, dy } };
      return kit;
    };
    test("fx_loop_wraps", () => {
      const t = flat(tl());
      t.fx = [{ id: "f1", t: 2, fx: "heal_fx", x: 100, y: 50 }];
      const r = setup(t, fxKit(true, 1, 1), { "s.png": sheet() });
      r.draw(2 + 14 / 12);
      expect(at(r.out, 99, 49)).toEqual([20, 0, 0, 255]); // 14 frames into a 13 frame clip: frame 1
      r.draw(1.9);
      expect(at(r.out, 99, 49)).toEqual(BLACK); // not started
      Object.assign(t.fx[0], { dur: 1 });
      r.draw(3.5);
      expect(at(r.out, 99, 49)).toEqual(BLACK); // hidden after its dur
    });
    test("a one-shot ends after its last frame unless it holds", () => {
      const t = flat(tl());
      t.fx = [{ id: "f1", t: 2, fx: "heal_fx", x: 100, y: 50 }];
      const r = setup(t, fxKit(false), { "s.png": sheet() });
      r.draw(2 + 12 / 12);
      expect(at(r.out, 100, 50)).toEqual([130, 0, 0, 255]);
      r.draw(2 + 14 / 12);
      expect(at(r.out, 100, 50)).toEqual(BLACK);
      Object.assign(t.fx[0], { hold: true });
      r.draw(2 + 14 / 12);
      expect(at(r.out, 100, 50)).toEqual([130, 0, 0, 255]);
    });
    test("fx_positions_whole_pixels", () => {
      const t = flat(tl());
      t.fx = [{ id: "f1", t: 0, fx: "heal_fx", x: 10.6, y: 20.4 }];
      const r = setup(t, fxKit(false), { "s.png": sheet() });
      r.draw(0);
      expect(at(r.out, 11, 20)).toEqual([10, 0, 0, 255]);
      expect(at(r.out, 10, 20)).toEqual(BLACK);
      expect(at(r.out, 12, 21)).toEqual([10, 0, 0, 255]);
      expect(at(r.out, 13, 21)).toEqual(BLACK);
    });
  });
});

describe("bakeFx", () => {
  test("bake_torch_seamless", () => {
    const b = bakeFx(torch, {});
    expect(b.loop).toBe(true);
    expect(b.frames).toBe(60); // duration 2 s at 30 fps: one period
    expect(b.fps).toBe(30);
    expect([b.dx, b.dy]).toEqual([36, 94]);
    const [w, h] = torch.meta.size;
    expect(b.sheet.w).toBe(b.cols * w);
    expect(b.sheet.h * b.sheet.w).toBeGreaterThanOrEqual(b.frames * w * h);
    const fr = renderFxFrames(torch, {}, 30, b.frames + 1);
    let diff = 0;
    for (let i = 0; i < w * h; i++) {
      for (let k = 0; k < 4; k++) if (fr[0][i * 4 + k] !== fr[b.frames][i * 4 + k]) { diff++; break; }
    }
    expect(diff).toBeLessThanOrEqual(w * h * 0.01);
    expect(b.sheet.px.some((v) => v > 0)).toBe(true);
  });
});
