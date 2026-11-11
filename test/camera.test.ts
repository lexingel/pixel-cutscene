import { expect, test } from "vitest";
import { camAt } from "../src/core/cam";
import type { Img, Kit } from "../src/core/kit";
import { renderFrame } from "../src/core/render";
import { validateTimeline } from "../src/core/timeline";
import type { Timeline } from "../src/core/types";
import { followKeys } from "../src/ui/stageEdit";
import { camKeyAt } from "../src/ui/timelineEditor";

const sprite: Img = { w: 10, h: 20, px: new Uint8ClampedArray(10 * 20 * 4).fill(255) };
const kit = { chars: { hero: { view: "side", anims: { idle: { approved: true, source: "user", frames: ["i.png"] } } } }, faces: {}, assets: {} } as unknown as Kit;
const img = (p: string) => (p === "i.png" ? sprite : null);
const tl = (): Timeline => ({
  name: "t", duration: 4, shots: [{ id: "s1", type: "wide", start: 0, end: 4, camera: [{ t: 0, x: 0, y: 0 }], bg_scale: 1 }],
  actors: [{ id: "hero", char: "hero", x: 100, y: 70, actions: [{ id: "a1", t: 1, do: "walk", to: [300, 70], dur: 2 }] }],
  fx: [], audio: [],
});

test("camAt: a key's ease shapes the way to the next key (smooth by default, linear, hold)", () => {
  const ks = (ease?: "linear" | "hold") => [{ t: 0, x: 0, y: 0, ...(ease ? { ease } : {}) }, { t: 1, x: 100, y: 0 }];
  expect(camAt(ks(), 0.25).x).toBe(16); // smoothstep: slow start
  expect(camAt(ks("linear"), 0.25).x).toBe(25);
  expect(camAt(ks("hold"), 0.99).x).toBe(0);
  expect(camAt(ks("hold"), 1).x).toBe(100);
  const bad = tl();
  (bad.shots[0] as any).camera[0].ease = "wobbly";
  expect(validateTimeline(bad)).toContain("s1.camera: a key's ease must be smooth, linear or hold");
});

test("camKeyAt: sets the key at the playhead, or adds one, in the shot under it", () => {
  const r = camKeyAt(tl(), 2, 40, 5);
  expect(r.id).toBe("s1");
  expect((r.tl.shots[0] as any).camera).toEqual([{ t: 0, x: 0, y: 0 }, { t: 2, x: 40, y: 5 }]);
  expect((camKeyAt(r.tl, 2, 50, 5).tl.shots[0] as any).camera).toEqual([{ t: 0, x: 0, y: 0 }, { t: 2, x: 50, y: 5 }]);
});

test("followKeys: the camera keeps a walking actor in the middle, linear, within the background", () => {
  const ks = followKeys(tl(), kit, img, "s1", "hero", 160, 90, { x: 1000, y: 0 });
  expect(ks[0]).toMatchObject({ t: 0, x: 20, y: 0 }); // 100 - 160/2
  expect(ks.every((k, i) => i === ks.length - 1 || k.ease === "linear")).toBe(true);
  expect(camAt(ks, 2).x).toBe(120); // halfway through the walk: feet at 200
  expect(ks[ks.length - 1]).toMatchObject({ t: 4, x: 220 });
  expect(ks.length).toBeLessThan(8); // standing still makes no extra keys
  expect(followKeys(tl(), kit, img, "s1", "hero", 160, 90, { x: 100, y: 0 }).at(-1)!.x).toBe(100); // clamped to the background
});

test("letterbox: black bars top and bottom", () => {
  const t = tl();
  t.letterbox = 3;
  t.shots[0].bg = "g";
  const W = 16, H = 12, out = { w: W, h: H, px: new Uint8ClampedArray(W * H * 4) };
  renderFrame({ tl: t, kit: { ...kit, assets: { g: { approved: true, source: "user", kind: "bg", path: "g" } } } as unknown as Kit, img: (k) => (k === "g" ? { w: W, h: H, px: new Uint8ClampedArray(W * H * 4).fill(200) } : null), draft: false, W, H }, 0, out);
  expect(validateTimeline(t)).toEqual([]);
  expect([...out.px.slice(0, 3)]).toEqual([0, 0, 0]);
  expect([...out.px.slice((W * (H - 1)) * 4, (W * (H - 1)) * 4 + 3)]).toEqual([0, 0, 0]);
});
