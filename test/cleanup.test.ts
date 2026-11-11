import { describe, expect, test } from "vitest";
import { cleanAnim, fillPinholes, groundSnap, paletteLock, paletteOf, speckFix } from "../src/core/cleanup";
import type { Img } from "../src/core/kit";

const blank = (w: number, h: number): Img => ({ w, h, px: new Uint8ClampedArray(w * h * 4) });
const put = (im: Img, x: number, y: number, c: number[]) => im.px.set(c.length === 3 ? [...c, 255] : c, (y * im.w + x) * 4);
const at = (im: Img, x: number, y: number) => Array.from(im.px.slice((y * im.w + x) * 4, (y * im.w + x) * 4 + 4));
const rect = (im: Img, x0: number, y0: number, x1: number, y1: number, c: number[]) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(im, x, y, c);
};

describe("cleanup (ported from PixTools)", () => {
  test("a_lone_odd_pixel_takes_its_neighbours_colour_and_a_floating_one_goes", () => {
    const a = blank(9, 9);
    rect(a, 2, 2, 8, 8, [100, 80, 60]);
    put(a, 4, 4, [250, 250, 250]);
    put(a, 8, 0, [9, 9, 9]);
    const { img, n } = speckFix(a);
    expect(n).toBe(2);
    expect(at(img, 4, 4)).toEqual([100, 80, 60, 255]);
    expect(at(img, 8, 0)[3]).toBe(0);
    expect(at(a, 4, 4)).toEqual([250, 250, 250, 255]); // the input is left as it was
  });
  test("a_colour_the_sprite_reuses_is_a_detail_and_stays", () => {
    const a = blank(9, 9);
    rect(a, 2, 2, 8, 8, [100, 80, 60]);
    for (const [x, y] of [[4, 4], [3, 5], [5, 5]]) put(a, x, y, [250, 250, 250]);
    expect(at(speckFix(a).img, 3, 5)).toEqual([250, 250, 250, 255]);
  });
  test("a_one_pixel_hole_is_filled_a_two_pixel_gap_is_not", () => {
    const a = blank(8, 8);
    rect(a, 2, 2, 5, 5, [9, 8, 7]);
    put(a, 3, 3, [0, 0, 0, 0]);
    const r = fillPinholes(a);
    expect(r.n).toBe(1);
    expect(at(r.img, 3, 3)).toEqual([9, 8, 7, 255]);
    put(a, 4, 3, [0, 0, 0, 0]);
    expect(fillPinholes(a).n).toBe(0);
  });
  test("drifted_colours_snap_to_the_palette_far_ones_stay", () => {
    const a = blank(4, 4);
    put(a, 1, 1, [205, 98, 52]);
    put(a, 2, 2, [11, 10, 9]);
    put(a, 3, 3, [90, 200, 90]);
    const ref = blank(2, 1);
    put(ref, 0, 0, [10, 10, 10]);
    put(ref, 1, 0, [200, 100, 50]);
    const r = paletteLock(a, paletteOf([ref]), 30);
    expect(r.n).toBe(2);
    expect(at(r.img, 1, 1)).toEqual([200, 100, 50, 255]);
    expect(at(r.img, 2, 2)).toEqual([10, 10, 10, 255]);
    expect(at(r.img, 3, 3)).toEqual([90, 200, 90, 255]);
  });
  test("a_floating_frame_drops_onto_the_feet_line_a_lower_one_stays", () => {
    const a = blank(6, 10);
    rect(a, 2, 3, 4, 6, [50, 50, 50]); // lowest row 5
    const r = groundSnap(a, 8);
    expect(r.moved).toBe(3);
    expect(at(r.img, 2, 8)[3]).toBe(255);
    expect(at(r.img, 2, 3)[3]).toBe(0);
    expect(groundSnap(a, 4).moved).toBe(0);
  });
  test("an_animation_is_cleaned_against_the_idle_and_reports_what_it_did", () => {
    const idle = blank(8, 10);
    rect(idle, 2, 2, 6, 10, [120, 60, 30]);
    const f = blank(8, 10);
    rect(f, 2, 0, 6, 8, [124, 58, 31]); // drifted shade, floating 2 px
    put(f, 3, 3, [0, 0, 0, 0]); // pinhole
    put(f, 4, 4, [255, 255, 255, 140]); // half-transparent smear pixel
    const r = cleanAnim([f], [idle], true);
    expect(r.report).toMatchObject({ lowered: 1, snapped: expect.any(Number), pinholes: 1 });
    expect(r.report.snapped).toBeGreaterThan(20);
    const out = r.frames[0];
    expect(at(out, 2, 9)).toEqual([120, 60, 30, 255]);
    expect(at(out, 3, 5)).toEqual([120, 60, 30, 255]); // the hole, moved down 2 and filled
    expect([...out.px].filter((_, i) => i % 4 === 3).every((v) => v === 0 || v === 255)).toBe(true);
  });
  test("a_one_pixel_detail_repeated_across_the_frames_is_kept", () => {
    // the sample knight's red eye: one pixel per frame, so per frame it looks like a speck
    const frame = (dirty: boolean) => {
      const f = blank(8, 8);
      rect(f, 1, 1, 7, 7, [85, 93, 110]);
      put(f, 3, 3, [216, 67, 58]);
      if (dirty) put(f, 5, 5, [250, 250, 250]);
      return f;
    };
    const r = cleanAnim([frame(false), frame(true), frame(false)], null, false);
    for (const f of r.frames) expect(at(f, 3, 3)).toEqual([216, 67, 58, 255]);
    expect(at(r.frames[1], 5, 5)).toEqual([85, 93, 110, 255]);
    expect(r.report.specks).toBe(1);
    const two = cleanAnim([frame(false), frame(true)], null, false); // two frames: the eye is used only twice, still a detail
    expect(at(two.frames[0], 3, 3)).toEqual([216, 67, 58, 255]);
    expect(two.report.specks).toBe(1);
  });
  test("ground_snap_is_skipped_when_asked_and_when_sizes_differ", () => {
    const idle = blank(8, 10);
    rect(idle, 2, 2, 6, 10, [120, 60, 30]);
    const f = blank(8, 10);
    rect(f, 2, 0, 6, 8, [120, 60, 30]);
    expect(cleanAnim([f], [idle], false).report.lowered).toBe(0);
    const big = blank(16, 20);
    rect(big, 2, 0, 6, 8, [120, 60, 30]);
    expect(cleanAnim([big], [idle], true).report.lowered).toBe(0);
  });
});
