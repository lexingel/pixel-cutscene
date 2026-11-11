import { expect, test } from "vitest";
import type { Img, Kit } from "../src/core/kit";
import { renderFrame } from "../src/core/render";
import { validateTimeline } from "../src/core/timeline";
import type { Timeline } from "../src/core/types";

const W = 128, H = 40;
const solid = (w: number, h: number, c: number[]): Img => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([...c, 255], i * 4);
  return { w, h, px };
};
const BG = solid(W, H, [200, 160, 120]), SPARK = solid(2, 2, [255, 255, 0]);
const kit = {
  chars: {}, faces: {},
  assets: {
    bg: { approved: true, source: "user", kind: "bg", path: "bg" },
    spark: { approved: true, source: "user", kind: "fx", path: "spark", fx: { frames: 1, cols: 1, fps: 12, loop: true, dx: 1, dy: 1 } },
  },
} as unknown as Kit;
const tl = (light?: object): Timeline => ({
  name: "t", duration: 2, shots: [{ id: "s1", type: "wide", start: 0, end: 2, bg: "bg", bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }], ...light }],
  actors: [], fx: [], audio: [],
});
function frame(t: Timeline) {
  const out = solid(W, H, [0, 0, 0]);
  renderFrame({ tl: t, kit, img: (k) => (k === "bg" ? BG : k === "spark" ? SPARK : null), draft: false, W, H }, 0.5, out);
  const at = (x: number, y: number) => [...out.px.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
  const colours = new Set<string>();
  for (let i = 0; i < W * H; i++) colours.add(out.px.slice(i * 4, i * 4 + 3).join());
  return { at, colours };
}

test("a night grade maps every colour to one darker, bluer colour: no blur, no new in-betweens", () => {
  const f = frame(tl({ grade: "night" }));
  const [r, g, b] = f.at(10, 10);
  expect(r).toBeLessThan(200);
  expect(b / r).toBeGreaterThan(120 / 200);
  expect(f.colours.size).toBe(1);
  expect(validateTimeline(tl({ grade: "midnight" }))).toContain("s1.grade: must be night, dusk, cold or sepia");
});

test("an effect lights up the graded scene around it, in dithered steps", () => {
  const t = tl({ grade: "night" });
  t.fx = [{ id: "f1", t: 0, fx: "spark", x: 32, y: 20 }];
  const f = frame(t);
  expect(f.at(33, 22)).toEqual([200, 160, 120]); // next to the fire: its own colour
  expect(f.at(120, 5)).not.toEqual([200, 160, 120]); // far off: still night
  expect(f.colours.size).toBeLessThanOrEqual(3); // night, lit and the spark itself
});

test("a vignette darkens the corners through a dither and leaves the middle alone", () => {
  const f = frame(tl({ vignette: true }));
  expect(f.at(64, 20)).toEqual([200, 160, 120]);
  expect(f.at(0, 0)).not.toEqual([200, 160, 120]);
  expect(f.colours.size).toBe(2);
});
