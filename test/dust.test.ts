import { expect, test } from "vitest";
import { crumble, seededRandom } from "../src/core/dust";
import type { Img } from "../src/core/kit";

// 8x10 sprite, opaque everywhere except a transparent top-left corner
const sprite = (): Img => {
  const w = 8, h = 10, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x + y > 1) px.set([200, 40 + x * 10, 90, 255], (y * w + x) * 4);
  return { w, h, px };
};

test("crumble_u0_is_the_sprite", () => {
  const s = sprite();
  const c = crumble(s, 0, 7);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const i = (y * s.w + x) * 4, j = ((y - c.dy) * c.img.w + (x - c.dx)) * 4;
    expect(Array.from(c.img.px.slice(j, j + 4))).toEqual(Array.from(s.px.slice(i, i + 4)));
  }
  let opaque = 0;
  for (let i = 3; i < c.img.px.length; i += 4) if (c.img.px[i] > 0) opaque++;
  expect(opaque).toBe(77); // 80 minus the 3 transparent pixels; nothing extra
});

test("crumble_u1_is_empty", () => {
  for (const seed of [1, 7, 123456]) {
    const c = crumble(sprite(), 1, seed);
    for (let i = 3; i < c.img.px.length; i += 4) expect(c.img.px[i]).toBe(0);
  }
});

test("crumble_is_deterministic", () => {
  const a = crumble(sprite(), 0.37, 42), b = crumble(sprite(), 0.37, 42);
  expect([a.dx, a.dy]).toEqual([b.dx, b.dy]);
  expect(Array.from(a.img.px)).toEqual(Array.from(b.img.px));
  expect(Array.from(crumble(sprite(), 0.37, 43).img.px)).not.toEqual(Array.from(a.img.px));
});

test("ash_at_half", () => {
  const s = sprite(), c = crumble(s, 0.5, 9);
  for (let x = 0; x < s.w; x++) {
    const j = ((s.h - 1 - c.dy) * c.img.w + (x - c.dx)) * 4;
    const got = Array.from(c.img.px.slice(j, j + 4));
    const i = ((s.h - 1) * s.w + x) * 4;
    // ash, or the original pixel if it has not released yet
    expect([[0x4a, 0x44, 0x40, 255], Array.from(s.px.slice(i, i + 4))]).toContainEqual(got);
  }
});

test("ash_never_covers_standing_feet", () => {
  const s = sprite(), c = crumble(s, 0.05, 9);
  for (let x = 0; x < s.w; x++) {
    const i = ((s.h - 1) * s.w + x) * 4, j = ((s.h - 1 - c.dy) * c.img.w + (x - c.dx)) * 4;
    if (s.px[i + 3] === 255 && seededRandom(9, x, s.h - 1) * 0.6 > 0.05) {
      expect(Array.from(c.img.px.slice(j, j + 4))).toEqual(Array.from(s.px.slice(i, i + 4)));
    }
  }
});
