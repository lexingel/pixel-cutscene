import { expect, test } from "vitest";
import { cropInto, sliceFit, verticalFit } from "../src/export/exporter";
import { bitrate } from "../src/export/encode";

test("a_vertical_video_is_a_9_16_slice_at_a_whole_scale_inside_1080x1920", () => {
  const v = verticalFit(480, 270);
  expect(v).toMatchObject({ outW: 1080, outH: 1920, cw: 152, k: 7 });
  expect(v.cw * v.k).toBeLessThanOrEqual(1080);
  expect(270 * v.k).toBeLessThanOrEqual(1920);
  expect([v.ox % 2, v.oy % 2]).toEqual([0, 0]); // even offsets keep chroma blocks inside one pixel's colour
  expect(verticalFit(320, 180)).toMatchObject({ cw: 102, k: 10 });
});
test("the_slice_is_placed_where_asked_and_stays_inside_the_scene", () => {
  const v = verticalFit(480, 270);
  expect(v.sliceX(240)).toBe(240 - 76);
  expect(v.sliceX(0)).toBe(0);
  expect(v.sliceX(9999)).toBe(480 - 152);
});
test("crop_into_copies_a_rectangle_onto_a_black_canvas", () => {
  const src = new Uint8ClampedArray(4 * 2 * 4).map((_, i) => i); // 4x2
  const dst = new Uint8ClampedArray(3 * 3 * 4);
  cropInto(src, 4, 1, 2, 2, dst, 3, 1, 1);
  expect(Array.from(dst.slice((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4))).toEqual([4, 5, 6, 7]); // src (1,0)
  expect(Array.from(dst.slice((2 * 3 + 2) * 4, (2 * 3 + 2) * 4 + 4))).toEqual([24, 25, 26, 27]); // src (2,1)
  expect(Array.from(dst.slice(0, 4))).toEqual([0, 0, 0, 255]); // outside the slice: black
});
test("share_quality_is_a_quarter_of_best", () => {
  expect(bitrate(1920, 1080, "best")).toBeCloseTo(37_324_800, -3);
  expect(bitrate(1920, 1080, "share")).toBeLessThanOrEqual(10_000_000);
});
test("a_square_video_is_a_scene_tall_slice_inside_1080x1080", () => {
  expect(sliceFit(480, 270, 1080, 1080)).toMatchObject({ outW: 1080, outH: 1080, cw: 270, k: 4, ox: 0, oy: 0 });
  expect(sliceFit(320, 180, 1080, 1080)).toMatchObject({ cw: 180, k: 6 });
  const { sliceX: _a, ...v } = verticalFit(480, 270), { sliceX: _b, ...s } = sliceFit(480, 270, 1080, 1920);
  expect(v).toEqual(s);
});
