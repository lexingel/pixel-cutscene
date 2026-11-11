import { describe, expect, test } from "vitest";
import miniText from "./fixtures/mini.json?raw";
import { bakeFx, renderFxFrames } from "../src/core/fxBake";
import type { Img, Kit } from "../src/core/kit";
import { blit } from "../src/core/raster";
import { pose } from "../src/core/acting";
import { charFrames } from "../src/core/frames";
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
  test("the DRAFT watermark is small and in the top-right corner, off the action", () => {
    const r = setup(flat(tl()), emptyKit(), {}, true, 360, 180); // k = 1 at 180 px tall
    r.draw(1);
    const white = [255, 255, 255, 255];
    expect(at(r.out, 360 - 4 - 29, 4)).toEqual(white); // the D's top-left pixel
    let low = 0;
    for (let y = 20; y < 180; y++) for (let x = 0; x < 360; x++) if (at(r.out, x, y).every((v, i) => v === white[i])) low++;
    expect(low).toBe(0); // nothing below the top strip
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

  test("an actor set to the back layer stays behind, one set to the front stays in front", () => {
    const t = actorTl();
    t.actors = [
      { id: "front", char: "a", x: 10, y: 40, actions: [], layer: "back" },
      { id: "back", char: "b", x: 10, y: 38, actions: [] },
    ];
    const kit = emptyKit();
    kit.chars.a = { view: "side", anims: { idle: { ...piece, frames: ["a.png"] } } };
    kit.chars.b = { view: "side", anims: { idle: { ...piece, frames: ["b.png"] } } };
    const imgs = { "a.png": solid(4, 4, 255), "b.png": solid(4, 4, 0, 255) };
    const r = setup(t, kit, imgs);
    r.draw(0);
    expect(at(r.out, 9, 37)).toEqual([0, 255, 0, 255]); // the lower one is behind now
    t.actors[0].layer = undefined;
    t.actors[1].layer = "front";
    r.draw(0);
    expect(at(r.out, 9, 37)).toEqual([0, 255, 0, 255]);
  });

  test("ground shadows: a dark oval under the feet when the scene has them on", () => {
    const t = actorTl();
    t.actors = [{ id: "h", char: "a", x: 100, y: 100, actions: [] }];
    const kit = emptyKit();
    kit.chars.a = { view: "side", anims: { idle: { ...piece, frames: ["a.png"] } } };
    kit.assets.grey = { ...piece, kind: "bg", path: "g.png" } as any;
    t.shots[0].bg = "grey";
    const r = setup(t, kit, { "a.png": solid(10, 16, 255), "g.png": solid(200, 120, 100, 100, 100) });
    r.draw(0);
    expect(at(r.out, 100, 100)).toEqual([100, 100, 100, 255]); // off by default
    t.shadows = true;
    r.draw(0);
    // a 16 px tall sprite: an oval 3 px out to each side, 1 px up and down, at 35% black
    for (const x of [97, 100, 103]) expect(at(r.out, x, 100)).toEqual([65, 65, 65, 255]);
    for (const x of [96, 104]) expect(at(r.out, x, 100)).toEqual([100, 100, 100, 255]);
    expect(at(r.out, 100, 101)).toEqual([65, 65, 65, 255]);
    expect(at(r.out, 100, 102)).toEqual([100, 100, 100, 255]);
    expect(at(r.out, 100, 99)).toEqual([255, 0, 0, 255]); // the sprite covers it
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
    test("fx_flip_mirrors_about_the_origin", () => {
      const im = solid(4, 1, 0, 0, 0, 0);
      for (let i = 0; i < 4; i++) im.px.set([(i + 1) * 10, 0, 0, 255], i * 4);
      const kit = emptyKit();
      kit.assets.a = { ...piece, kind: "fx", path: "s.png", fx: { cols: 1, frames: 1, fps: 12, loop: true, dx: 1, dy: 0 } };
      const t = flat(tl());
      t.fx = [{ id: "f1", t: 0, fx: "a", x: 10, y: 5 }];
      const r = setup(t, kit, { "s.png": im });
      r.draw(0);
      expect([9, 10, 11, 12].map((x) => at(r.out, x, 5)[0])).toEqual([10, 20, 30, 40]);
      expect(at(r.out, 8, 5)).toEqual(BLACK);
      t.fx[0].flip = true;
      r.draw(0);
      expect([8, 9, 10, 11].map((x) => at(r.out, x, 5)[0])).toEqual([40, 30, 20, 10]);
      expect(at(r.out, 12, 5)).toEqual(BLACK);
    });
    test("a higher effects row draws in front, whatever the list order", () => {
      const kit = emptyKit();
      kit.assets.r = { ...piece, kind: "fx", path: "r.png", fx: { cols: 1, frames: 1, fps: 12, loop: true, dx: 0, dy: 0 } };
      kit.assets.g = { ...piece, kind: "fx", path: "g.png", fx: { cols: 1, frames: 1, fps: 12, loop: true, dx: 0, dy: 0 } };
      const t = flat(tl());
      t.fx = [{ id: "f1", t: 0, fx: "r", x: 10, y: 5, row: 1 }, { id: "f2", t: 0, fx: "g", x: 10, y: 5 }];
      const r = setup(t, kit, { "r.png": solid(2, 2, 200), "g.png": solid(2, 2, 0, 200) });
      r.draw(0);
      expect(at(r.out, 10, 5)).toEqual([200, 0, 0, 255]); // row 1 over row 0
      t.fx[0].row = 0;
      r.draw(0);
      expect(at(r.out, 10, 5)).toEqual([0, 200, 0, 255]); // same row: list order
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

describe("v1 projects render unchanged", () => {
  // Hashes taken on d08d654, before hurt/dust rendering existed.
  const HASHES: Record<string, string> = {
    "0": "9f318ea6c53db125a1ecee52b7b22e9faf53330f7cd523735788212055f973fb",
    "1.5": "3901e587624bc7d1b7299e790cc67251f935bc1d054074073af6ba7a774122f0",
    "3": "efd28464d176e331e2b9dbb07e8f082d95ec6946ac9c4e5b51d9e5b3ea3bd738",
  };
  test("v1_project_renders_unchanged", async () => {
    const kit = emptyKit();
    kit.assets.rift_vista = { ...piece, kind: "bg", path: "bg.png" };
    kit.assets.warrior_realm = { ...piece, kind: "backdrop", path: "b.png" };
    kit.faces.warrior = { neutral: { ...piece, path: "f.png" } };
    kit.chars.legend_warrior = { view: "side", anims: { idle: { ...piece, frames: ["w.png"] }, walk: { ...piece, frames: ["w.png", "w2.png"] } } };
    const imgs = { "bg.png": solid(400, 300, 200, 100, 50), "b.png": solid(320, 180, 100, 150, 200), "f.png": solid(10, 10, 255, 255, 0), "w.png": solid(20, 40, 30, 200, 30), "w2.png": solid(20, 40, 200, 30, 30) };
    const r = setup(tl(), kit, imgs, false, 200, 300);
    for (const time of [0, 1.5, 3]) {
      r.draw(time);
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", r.out.px)), (b) => b.toString(16).padStart(2, "0")).join("");
      expect(sha).toBe(HASHES[String(time)]);
    }
  });
});

describe("hurt and dust drawing", () => {
  const stage = () => {
    const t = flat(tl());
    t.actors = [{ id: "a", char: "c", x: 50, y: 60, actions: [{ id: "h", t: 1, do: "hurt" }, { id: "d", t: 2, do: "dust", dur: 1.5 }] }];
    const kit = emptyKit();
    kit.chars.c = { view: "side", anims: { idle: { ...piece, frames: ["c.png"] } } };
    return setup(t, kit, { "c.png": solid(10, 20, 0, 255, 0) });
  };
  test("flash is a half #ff3b3b tint for two frames then normal", () => {
    const r = stage();
    r.draw(1.0); expect(at(r.out, 50, 50)).toEqual([128, 157, 30, 255]); // green and red half and half: the sprite still shows
    r.draw(1.2); expect(at(r.out, 50, 50)).toEqual([0, 255, 0, 255]);
  });
  test("dust: sprite, then nothing", () => {
    const r = stage();
    r.draw(2.0); expect(count(r.out, [0, 255, 0, 255])).toBe(200);
    r.draw(3.5); expect(count(r.out, [0, 255, 0, 255])).toBe(0);
    expect(count(r.out, [0x4a, 0x44, 0x40, 255])).toBe(0);
  });
});

describe("scale 2 characters", () => {
  const scaledKit = (): Kit => {
    const kit = emptyKit();
    kit.chars.c = { view: "side", scale: 2, anims: { idle: { ...piece, frames: ["c.png"] } } };
    return kit;
  };
  test("scaled_actor_is_drawn_2x_by_its_feet", () => {
    const t = flat(tl());
    t.actors = [{ id: "a", char: "c", x: 20, y: 40, actions: [] }];
    const r = setup(t, scaledKit(), { "c.png": solid(4, 4, 255, 0, 0) });
    r.draw(0.5);
    const red = [255, 0, 0, 255];
    expect(count(r.out, red)).toBe(64);
    expect(at(r.out, 16, 32)).toEqual(red);
    expect(at(r.out, 23, 39)).toEqual(red);
    expect(at(r.out, 15, 32)).toEqual(BLACK);
    expect(at(r.out, 24, 39)).toEqual(BLACK);
    expect(at(r.out, 23, 40)).toEqual(BLACK);
  });
  test("dust_on_flipped_scaled_actor", () => {
    const t = flat(tl());
    t.actors = [{ id: "a", char: "c", flip: true, x: 120, y: 80, actions: [{ id: "w", t: 0, do: "walk", to: [40, 80], dur: 3 }, { id: "d", t: 1, do: "dust", dur: 1 }] }];
    const imgs = { "c.png": solid(10, 20, 0, 255, 0) };
    const r = setup(t, scaledKit(), imgs);
    const q = pose(t.actors[0], 1, charFrames(scaledKit(), (p) => imgs[p as "c.png"], true, () => true))!;
    expect(q.flip).toBe(true);
    expect(q.img!.w).toBe(20);
    r.draw(1);
    expect(count(r.out, [0, 255, 0, 255])).toBe(20 * 40);
    for (let y = 0; y < r.out.h; y++) for (let x = 0; x < r.out.w; x++) {
      const inside = x >= q.drawX && x < q.drawX + 20 && y >= q.drawY && y < q.drawY + 40;
      if (!inside) expect(at(r.out, x, y)).toEqual(BLACK);
    }
    r.draw(2.1); // after dur
    expect(count(r.out, [0, 255, 0, 255])).toBe(0);
  });
});

describe("parallax layers", () => {
  // bg: 40 px wide, see-through on the top half (sky); far: a 10 px stripe pattern; near: one 2 px post
  const sky = () => {
    const im = solid(40, 40, 0, 200, 0);
    for (let i = 0; i < 40 * 20; i++) im.px[i * 4 + 3] = 0;
    return im;
  };
  const far = () => {
    const im = solid(10, 40, 0, 0, 0);
    for (let y = 0; y < 40; y++) im.px.set([250, 0, 0, 255], (y * 10) * 4); // red at x = 0 of every tile
    return im;
  };
  const near = () => {
    const im = solid(20, 40, 0, 0, 0, 0);
    for (let y = 0; y < 40; y++) im.px.set([0, 0, 250, 255], (y * 20 + 5) * 4); // blue post at x = 5
    return im;
  };
  const scene = (camX: number) => {
    const t = flat(tl());
    const s = t.shots[0];
    if (s.type !== "wide") throw new Error("fixture");
    Object.assign(s, { bg: "b", far: "f", near: "n", bg_scale: 1, camera: [{ t: 0, x: camX, y: 0 }] });
    t.actors = [{ id: "w", char: "legend_warrior", x: 5, y: 40, actions: [] }];
    const kit: Kit = {
      chars: { legend_warrior: { view: "side", anims: { idle: { ...piece, frames: ["i.png"] } } } }, faces: {},
      assets: { b: { ...piece, kind: "bg", path: "b.png" }, f: { ...piece, kind: "bg", path: "f.png" }, n: { ...piece, kind: "bg", path: "n.png" } },
    };
    return setup(t, kit, { "b.png": sky(), "f.png": far(), "n.png": near(), "i.png": solid(4, 4, 255, 255, 0) }, false, 40, 40);
  };

  test("far shows through the see-through sky, repeats, and moves at half the camera", () => {
    const r = scene(0);
    r.draw(1);
    expect(at(r.out, 0, 5)).toEqual([250, 0, 0, 255]);
    expect(at(r.out, 30, 5)).toEqual([250, 0, 0, 255]); // tiled across the frame
    expect(at(r.out, 0, 30)).toEqual([0, 200, 0, 255]); // the bg's ground covers it
    const m = scene(4);
    m.draw(1);
    expect(at(m.out, 8, 5)).toEqual([250, 0, 0, 255]); // camera 4 -> far moved 2: tile edge at 10 - 2
  });

  test("near is drawn over the actors and moves at one and a half times the camera", () => {
    const r = scene(0);
    r.draw(1);
    expect(at(r.out, 5, 38)).toEqual([0, 0, 250, 255]); // the post over the actor standing at x 5
    expect(at(r.out, 6, 38)).toEqual([255, 255, 0, 255]); // the actor next to it
    const m = scene(2);
    m.draw(1);
    expect(at(m.out, 2, 10)).toEqual([0, 0, 250, 255]); // camera 2 -> near moved 3
  });
});
