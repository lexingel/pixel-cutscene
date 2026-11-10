import { describe, expect, test } from "vitest";
import type { Img } from "../src/core/kit";
import { scale2x } from "../src/core/scale2x";

const R = [255, 0, 0, 255], T = [0, 0, 0, 0];
const img = (w: number, h: number, px: number[][]): Img => ({ w, h, px: Uint8ClampedArray.from(px.flat()) });
const rows = (im: Img) => Array.from({ length: im.h }, (_, y) => Array.from({ length: im.w }, (_, x) => Array.from(im.px.slice((y * im.w + x) * 4, (y * im.w + x) * 4 + 4))));

describe("scale2x", () => {
  test("size_doubles", () => {
    const o = scale2x(img(3, 5, Array(15).fill(R)));
    expect([o.w, o.h, o.px.length]).toEqual([6, 10, 6 * 10 * 4]);
  });
  test("flat_colour_stays_flat", () => {
    const o = scale2x(img(3, 3, Array(9).fill(R)));
    expect(rows(o).flat()).toEqual(Array(36).fill(R));
  });
  test("diagonal_edge_is_smoothed", () => {
    // Input (T=transparent, R=red):  T R / R T. Edges clamp, so each pixel's missing neighbour is itself.
    // Every pixel passes B≠H and D≠F, so each corner copies D/F only where it matches the touching neighbour:
    //   (0,0) E=T B=T D=T F=R H=R -> TL=D=T, TR=E=T (B≠F), BL=E=T (D≠H), BR=F=R (H==F)
    //   (1,0) E=R B=R D=T F=R H=T -> TL=E=R (D≠B), TR=F=R (B==F), BL=D=T (D==H), BR=E=R (H≠F)
    //   (0,1) E=R B=T D=R F=T H=R -> TL=E=R, TR=F=T (B==F), BL=D=R (D==H), BR=E=R
    //   (1,1) E=T B=R D=R F=T H=T -> TL=D=R (D==B), TR=E=T, BL=E=T, BR=F=T (H==F)
    const o = scale2x(img(2, 2, [T, R, R, T]));
    expect(rows(o)).toEqual([
      [T, T, R, R],
      [T, R, T, R],
      [R, T, R, T],
      [R, R, T, T],
    ]);
  });
  test("no_new_colours", () => {
    const G = [0, 255, 0, 255], B = [0, 0, 255, 128];
    const src = img(4, 3, [R, G, B, T, G, R, T, B, B, T, R, G]);
    const key = (c: number[]) => c.join(",");
    const have = new Set(rows(src).flat().map(key));
    expect(rows(scale2x(src)).flat().every((c) => have.has(key(c)))).toBe(true);
  });
});
