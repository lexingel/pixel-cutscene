import { expect, test } from "vitest";
import { dragTarget, hitTest, moveBy } from "../src/ui/stageEdit";
import type { Timeline } from "../src/core/types";
import type { Kit, Img } from "../src/core/kit";

const sprite: Img = { w: 10, h: 20, px: new Uint8ClampedArray(10 * 20 * 4).fill(255) };
const kit = { chars: { hero: { view: "side", anims: { idle: { approved: true, source: "user", frames: ["i.png"] } } } }, faces: {}, assets: {} } as unknown as Kit;
const img = (p: string) => (p === "i.png" ? sprite : null);
const tl = (): Timeline => ({
  name: "t", duration: 5, shots: [{ id: "s1", type: "wide", start: 0, end: 5, camera: [{ t: 0, x: 0, y: 0 }], bg_scale: 1 }],
  actors: [
    { id: "back", char: "hero", x: 50, y: 60, actions: [] },
    { id: "front", char: "hero", x: 52, y: 70, actions: [{ id: "a1", t: 1, do: "walk", to: [100, 70], dur: 2 }] },
  ],
  fx: [], audio: [],
});

test("hit_front_actor_first", () => {
  // both boxes cover (52, 55): back spans y 40..60, front spans y 50..70
  expect(hitTest(tl(), kit, img, 0, 52, 55)).toBe("front");
  expect(hitTest(tl(), kit, img, 0, 52, 45)).toBe("back");
});
test("hit_none_on_empty", () => expect(hitTest(tl(), kit, img, 0, 200, 150)).toBeNull());
test("drag_target_during_walk_is_to", () => expect(dragTarget(tl(), "front", 2)).toEqual({ id: "a1", key: "to" }));
test("drag_target_before_walk_is_pos", () => expect(dragTarget(tl(), "front", 0.5)).toEqual({ id: "front", key: "pos" }));
test("move_by_whole_pixels", () => {
  const r = moveBy(tl(), { id: "front", key: "pos" }, 2.6, -1.2);
  expect(r.tl.actors[1]).toMatchObject({ x: 55, y: 69 });
  expect(moveBy(tl(), { id: "a1", key: "to" }, 2.6, 0).tl.actors[1].actions[0].to).toEqual([103, 70]);
});

import { aimAngle, aimHandle } from "../src/ui/stageEdit";
import type { FxEntry } from "../src/core/types";

const flame = (flip: boolean): FxEntry => ({ id: "f1", t: 0, fx: "x", x: 100, y: 100, ...(flip ? { flip: true } : {}) });
const cam0 = { x: 0, y: 0 };
test("aim_handle_unflipped_angle_0_is_right", () => expect(aimHandle(flame(false), cam0, 0).x).toBeGreaterThan(100));
test("aim_handle_flipped_angle_0_is_left_where_the_flame_is_drawn", () => {
  const h = aimHandle(flame(true), cam0, 0);
  expect(h.x).toBeLessThan(100);
  expect(h.y).toBe(100);
});
test("aim_angle_unflipped_follows_the_pointer", () => expect(aimAngle(flame(false), cam0, 100, 150)).toBe(90));
test("aim_angle_flipped_stores_the_mirror_of_the_pointer_angle", () => {
  expect(aimAngle(flame(true), cam0, 50, 100)).toBe(0); // pointer left of a flipped flame: stored 0 (the sheet is mirrored at draw time)
  expect(aimAngle(flame(true), cam0, 50, 117)).toBe(20); // lower-left, 160 deg on screen: stored 20, which the mirror draws at 160
});
test("aim_round_trip_flipped_and_not", () => {
  for (const flip of [false, true]) for (const deg of [-170, -90, 0, 35, 90, 160, 180]) {
    const f = flame(flip), h = aimHandle(f, cam0, deg);
    expect(aimAngle(f, cam0, h.x, h.y), `${flip} ${deg}`).toBe(deg);
  }
});

import { onAimHandle, snapGround } from "../src/ui/stageEdit";
test("aim_handle_is_easy_to_grab_on_a_small_preview", () => {
  const hd = { x: 100, y: 50 };
  expect(onAimHandle({ x: 107, y: 50 }, hd, 1)).toBe(true); // full size: 8 canvas px
  expect(onAimHandle({ x: 109, y: 50 }, hd, 1)).toBe(false);
  expect(onAimHandle({ x: 104, y: 50 }, hd, 0.25)).toBe(true); // zoomed in: never under 4 canvas px
  expect(onAimHandle({ x: 115, y: 50 }, hd, 2.6)).toBe(true); // 960 px canvas shown 367 px wide: 8 screen px
  expect(onAimHandle({ x: 125, y: 50 }, hd, 2.6)).toBe(false);
});
test("ground_snaps_feet_that_land_near_it", () => {
  expect(snapGround(455, 463)).toBe(463);
  expect(snapGround(470, 463)).toBe(463);
  expect(snapGround(440, 463)).toBe(440);
  expect(snapGround(440, undefined)).toBe(440);
});
import { groundAt } from "../src/ui/stageEdit";
test("drags_of_feet_snap_to_the_ground_effects_do_not", () => {
  const t0 = tl();
  (t0.shots[0] as { ground?: number }).ground = 75;
  t0.fx.push({ id: "f1", t: 0, fx: "x", x: 10, y: 70 });
  expect(groundAt(t0, 1)).toBe(75);
  expect(moveBy(t0, { id: "front", key: "pos" }, 0, 3, 75).tl.actors[1].y).toBe(75);
  expect(moveBy(t0, { id: "a1", key: "to" }, 0, -2, 75).tl.actors[1].actions[0].to).toEqual([100, 75]);
  expect(moveBy(t0, { id: "f1", key: "pos" }, 0, 3, 75).tl.fx[0].y).toBe(73);
  expect(groundAt(tl(), 1)).toBeUndefined();
});
