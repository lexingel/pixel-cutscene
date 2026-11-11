import { expect, test } from "vitest";
import type { Img, Kit } from "../src/core/kit";
import { renderFrame, type RenderInput } from "../src/core/render";
import { sceneTime } from "../src/core/timewarp";
import { validateTimeline } from "../src/core/timeline";
import type { Timeline } from "../src/core/types";
import { addTimeFx, shotTransition } from "../src/ui/timelineEditor";

const W = 40, H = 20;
const solid = (r: number, g: number, b: number): Img => {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) px.set([r, g, b, 255], i * 4);
  return { w: W, h: H, px };
};
const RED = solid(200, 0, 0), BLUE = solid(0, 0, 200);
const kit: Kit = { chars: {}, faces: {}, assets: { red: { approved: true, source: "user", kind: "bg", path: "red" }, blue: { approved: true, source: "user", kind: "bg", path: "blue" } } } as unknown as Kit;
const tl = (): Timeline => ({
  name: "t", duration: 4,
  shots: [
    { id: "s1", type: "wide", start: 0, end: 2, bg: "red", bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] },
    { id: "s2", type: "wide", start: 2, end: 4, bg: "blue", bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] },
  ],
  actors: [], fx: [], audio: [],
});
function frame(t: Timeline, at: number) {
  const p: RenderInput = { tl: t, kit, img: (k) => (k === "red" ? RED : k === "blue" ? BLUE : null), draft: false, W, H };
  const out = solid(9, 9, 9);
  renderFrame(p, at, out);
  let red = 0, blue = 0, black = 0, other = 0;
  for (let i = 0; i < W * H; i++) {
    const [r, , b] = out.px.slice(i * 4, i * 4 + 3);
    if (r === 200 && b === 0) red++;
    else if (b === 200 && r === 0) blue++;
    else if (r === 0 && b === 0) black++;
    else other++;
  }
  return { red, blue, black, other, px: (x: number, y: number) => [...out.px.slice((y * W + x) * 4, (y * W + x) * 4 + 3)] };
}

test("sceneTime: a hold stops the picture, a slow motion ramp eases through and lands back in step", () => {
  const t = tl();
  t.time = [{ id: "tm1", t: 1, dur: 0.5, kind: "hold" }, { id: "tm2", t: 2.5, dur: 1, kind: "slow", rate: 0.25 }];
  expect(sceneTime(t, 0.9)).toBe(0.9);
  expect(sceneTime(t, 1.2)).toBe(1); // held
  expect(sceneTime(t, 1.5)).toBe(1.5); // and in step after
  const mid = [2.9, 3.0, 3.1].map((x) => sceneTime(t, x));
  expect(mid[2] - mid[1]).toBeCloseTo(0.1 * 0.25, 2); // slowest in the middle
  expect(sceneTime(t, 3.5)).toBe(3.5);
  for (let x = 2.5; x < 3.5; x += 0.01) expect(sceneTime(t, x + 0.01)).toBeGreaterThan(sceneTime(t, x)); // never runs backwards
});

test("dissolve: the new shot appears through an ordered dither, no blended colours", () => {
  const t = shotTransition(tl(), 2.5, "dissolve").tl;
  expect(t.shots[1].transition).toEqual({ kind: "dissolve", dur: 0.5 });
  const half = frame(t, 2.25);
  expect(half.other).toBe(0);
  expect(half.red).toBe(W * H / 2);
  expect(half.blue).toBe(W * H / 2);
  expect(frame(t, 2.6).blue).toBe(W * H);
  expect(frame(t, 2).red).toBe(W * H);
});

test("wipe: the new shot slides in from the left; iris opens from the middle out of black", () => {
  let t = shotTransition(tl(), 3, "wipe").tl;
  const w = frame(t, 2.25);
  expect(w.px(5, 10)).toEqual([0, 0, 200]);
  expect(w.px(35, 10)).toEqual([200, 0, 0]);
  t = shotTransition(tl(), 3, "iris").tl;
  const i = frame(t, 2.1);
  expect(i.px(20, 10)).toEqual([0, 0, 200]);
  expect(i.px(0, 0)).toEqual([0, 0, 0]);
  expect(shotTransition(tl(), 1, "dissolve").error).toMatch(/first shot/);
});

test("time effects are bars: added at the playhead, validated, and an overlap is refused", () => {
  const r = addTimeFx(tl(), 1, "slow");
  expect(r.error).toBeUndefined();
  expect(r.tl.time).toEqual([{ id: r.id, t: 1, dur: 1, kind: "slow", rate: 0.25 }]);
  expect(validateTimeline(r.tl)).toEqual([]);
  expect(addTimeFx(r.tl, 1.5, "hitstop").error).toMatch(/overlap/);
  expect(addTimeFx(r.tl, 3, "hitstop").tl.time![1]).toMatchObject({ t: 3, dur: 0.1, kind: "hold" });
  const bad = { ...tl(), time: [{ id: "x", t: 3.8, dur: 1, kind: "slow" }] };
  expect(validateTimeline(bad)).toContain("x.dur: must end by the end of the scene (4.0)");
});
