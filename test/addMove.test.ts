import { describe, expect, test } from "vitest";
import { addMove } from "../src/ui/addMove";
import { newProject } from "../src/core/project";
import type { Img } from "../src/core/kit";
import type { Timeline } from "../src/core/types";
import { pngBytes } from "./png";

const encode = async (img: Img) => new Blob([pngBytes(img) as BlobPart]);
const stub: Img = { w: 10, h: 20, px: new Uint8ClampedArray(10 * 20 * 4) };

// hero standing at (100, 150); idle 1 frame, breathe 6 frames (0.5 s at 12 fps), all 10x20
function setup(opts: { flip?: boolean; scale?: 2 } = {}) {
  const p = newProject("t");
  const idle = ["i0.png"], breathe = [0, 1, 2, 3, 4, 5].map((i) => `b${i}.png`);
  for (const f of [...idle, ...breathe]) p.files.set(f, new Blob([]));
  p.kit.chars.hero = {
    view: "side", ...(opts.scale ? { scale: 2 as const } : {}),
    anims: { idle: { approved: true, source: "user", frames: idle }, breathe: { approved: true, source: "user", frames: breathe } },
  };
  const tl: Timeline = {
    name: "t", duration: 5, shots: [{ id: "s1", type: "wide", start: 0, end: 5, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
    actors: [{ id: "hero1", char: "hero", x: 100, y: 150, ...(opts.flip ? { flip: true } : {}), actions: [] }], fx: [], audio: [],
  };
  return { p, tl };
}
const img = () => stub;

describe("addMove", () => {
  test("breathe_flame_at_the_facing_edge_30pct_down", async () => {
    const { p, tl } = setup();
    const r = await addMove(p, tl, "hero1", "anim:breathe", 1, img, encode);
    expect(r.error).toBeUndefined();
    expect(r.tl.actors[0].actions).toEqual([expect.objectContaining({ t: 1, do: "anim:breathe" })]);
    // drawX 95, w 10 -> right edge 105; drawY 130, 30% of 20 = 6 -> 136
    expect(r.tl.fx).toEqual([expect.objectContaining({ fx: "fire-breath", x: 105, y: 136 })]);
    expect(r.tl.fx[0].flip).toBeUndefined();
    expect(r.tl.fx[0].t).toBeCloseTo(1 + (2 / 3) * 0.5, 3);
    expect(p.kit.assets["fire-breath"].approved).toBe(true);
  });
  test("flipped_actor_breathes_from_the_left_edge", async () => {
    const { p, tl } = setup({ flip: true });
    const r = await addMove(p, tl, "hero1", "anim:breathe", 1, img, encode);
    expect(r.tl.fx[0]).toEqual(expect.objectContaining({ x: 95, y: 136, flip: true }));
  });
  test("scale_2_character_uses_the_doubled_sprite", async () => {
    const { p, tl } = setup({ scale: 2 });
    const r = await addMove(p, tl, "hero1", "anim:breathe", 1, img, encode);
    // 20x40: drawX 90 -> right edge 110; drawY 110, 30% of 40 = 12 -> 122
    expect(r.tl.fx[0]).toEqual(expect.objectContaining({ x: 110, y: 122 }));
  });
  test("a_failing_fx_load_adds_nothing", async () => {
    const { p, tl } = setup();
    const boom = async (): Promise<Blob> => { throw new Error("encode failed"); };
    await expect(addMove(p, tl, "hero1", "anim:breathe", 1, img, boom)).rejects.toThrow("encode failed");
    expect(tl.actors[0].actions).toEqual([]); // the input timeline is untouched, nothing was committed
    expect(tl.fx).toEqual([]);
    expect(p.kit.assets["fire-breath"]).toBeUndefined();
  });
  test("other_moves_add_no_flame", async () => {
    const { p, tl } = setup();
    const r = await addMove(p, tl, "hero1", "startle", 1, img, encode);
    expect(r.tl.fx).toEqual([]);
    expect(r.tl.actors[0].actions[0]).toEqual(expect.objectContaining({ do: "startle", dur: 1 }));
  });
});

import { addLibraryFx } from "../src/core/fxLibrary";
import { changeMove } from "../src/ui/addMove";

describe("addMove fixes", () => {
  test("flame_starts_in_the_last_third_and_burns_a_second", async () => {
    const { p, tl } = setup();
    const r = await addMove(p, tl, "hero1", "anim:breathe", 1, img, encode);
    const f = r.tl.fx[0] as { t: number; dur?: number };
    expect(f.t).toBeCloseTo(1 + (2 / 3) * 0.5, 1);
    expect(f.dur).toBeCloseTo(1, 2); // the last frame (jaws open) holds while it burns
  });
  test("flame_of_the_default_clip_burns_a_second_too", async () => {
    const { p, tl } = setup();
    delete p.kit.chars.hero.anims.breathe; // not made yet: 9 frames at 12 fps = 0.75 s
    const r = await addMove(p, tl, "hero1", "anim:breathe", 1, img, encode);
    expect((r.tl.fx[0] as { dur?: number }).dur).toBeCloseTo(1, 2);
  });
  test("changing_an_existing_move_to_breathe_adds_the_flame_in_one_edit", async () => {
    const { p, tl } = setup();
    tl.actors[0].actions.push({ id: "a1", t: 2, do: "idle" });
    const r = await changeMove(p, tl, "a1", "anim:breathe", img, encode);
    expect(r.error).toBeUndefined();
    expect(r.tl.actors[0].actions[0].do).toBe("anim:breathe");
    expect(r.tl.fx).toEqual([expect.objectContaining({ fx: "fire-breath", x: 105, y: 136 })]);
    expect(r.tl.fx[0].t).toBeCloseTo(2 + (2 / 3) * 0.5, 3);
    expect(tl.fx).toEqual([]); // the input is untouched: one result, one undo step
  });
  test("changing_to_another_move_adds_no_flame", async () => {
    const { p, tl } = setup();
    tl.actors[0].actions.push({ id: "a1", t: 2, do: "idle" });
    const r = await changeMove(p, tl, "a1", "startle", img, encode);
    expect(r.tl.fx).toEqual([]);
    expect(r.tl.actors[0].actions[0].do).toBe("startle");
  });
  test("scale_2_breathe_decodes_frames_that_are_not_loaded_yet", async () => {
    const { p, tl } = setup({ scale: 2 });
    const r = await addMove(p, tl, "hero1", "anim:breathe", 1, () => null, encode, async () => stub);
    expect(r.error).toBeUndefined();
    expect(r.tl.fx[0]).toEqual(expect.objectContaining({ x: 110, y: 122 }));
  });
  test("library_drop_never_reuses_a_user_asset_of_the_same_name", async () => {
    const { p } = setup();
    p.kit.assets["fire-breath"] = { approved: true, source: "user", kind: "fx", path: "fx/mine.png" };
    const id = await addLibraryFx(p, "fire/fire-breath", undefined, encode);
    expect(id).not.toBe("fire-breath");
    expect(p.kit.assets[id]).toMatchObject({ source: "pixelfx", ref: "fire/fire-breath" });
    expect(p.kit.assets["fire-breath"].source).toBe("user");
    expect(await addLibraryFx(p, "fire/fire-breath", undefined, encode)).toBe(id); // the library one is reused
  });
});

import { findMouth, replaceFlames } from "../src/ui/addMove";

// 20x20 head facing right: upper jaw rows 2-4 to x 19, lower jaw rows 8-10 to x 16, joined at x < 10
function jaws(): Img {
  const px = new Uint8ClampedArray(20 * 20 * 4);
  const on = (x: number, y: number) => px.set([200, 40, 40, 255], (y * 20 + x) * 4);
  for (let y = 2; y <= 4; y++) for (let x = 0; x <= 19; x++) on(x, y);
  for (let y = 8; y <= 10; y++) for (let x = 0; x <= 16; x++) on(x, y);
  for (let y = 5; y <= 19; y++) for (let x = 0; x <= 9; x++) on(x, y);
  return { w: 20, h: 20, px };
}

describe("mouth", () => {
  test("mouth_is_the_gap_between_the_jaws_not_the_snout_tip", () => {
    expect(findMouth(jaws())).toEqual({ x: 17, y: 6 }); // right edge of the gap's front column, gap rows 5-7
  });
  test("a_closed_mouth_falls_back_to_the_snout_tip", () => {
    const im = jaws();
    for (let y = 5; y <= 7; y++) for (let x = 10; x <= 16; x++) im.px.set([200, 40, 40, 255], (y * 20 + x) * 4);
    expect(findMouth(im)).toEqual({ x: 20, y: 2 });
  });
  test("an_empty_sprite_has_no_mouth", () => {
    expect(findMouth(stub)).toBeNull();
  });
  test("breathe_flame_comes_out_of_the_open_jaws", async () => {
    const { p, tl } = setup();
    const r = await addMove(p, tl, "hero1", "anim:breathe", 1, () => jaws(), encode);
    // drawX 90, drawY 130 -> (90 + 17, 130 + 6)
    expect(r.tl.fx[0]).toEqual(expect.objectContaining({ x: 107, y: 136 }));
    const fl = await addMove(p, setup({ flip: true }).tl, "hero1", "anim:breathe", 1, () => jaws(), encode);
    expect(fl.tl.fx[0]).toEqual(expect.objectContaining({ x: 93, y: 136, flip: true }));
  });
  test("flames_move_to_the_new_mouth_after_breathe_is_remade", async () => {
    const { p, tl } = setup();
    const r = await addMove(p, tl, "hero1", "anim:breathe", 1, img, encode); // edge rule: (105, 136)
    const aimed = { ...r.tl, fx: r.tl.fx.map((f) => ({ ...f, angle: 30 })) };
    const moved = await replaceFlames(p, aimed, "hero", () => jaws());
    expect(moved.fx[0]).toEqual(expect.objectContaining({ x: 107, y: 136, angle: 30 }));
    expect(moved.fx[0].t).toBeCloseTo(1 + (2 / 3) * 0.5, 1);
    expect(r.tl.fx[0].x).toBe(105); // the input is untouched
    const other = await replaceFlames(p, aimed, "nobody", () => jaws());
    expect(other).toBe(aimed);
  });
});
