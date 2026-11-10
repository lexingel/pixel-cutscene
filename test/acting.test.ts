import { expect, test } from "vitest";
import miniText from "./fixtures/mini.json?raw";
import { ANIM_FPS, pose, shotAt } from "../src/core/acting";
import { activeAudio } from "../src/core/audioPlan";
import { camAt } from "../src/core/cam";
import type { Img } from "../src/core/kit";
import type { Actor, Timeline } from "../src/core/types";

const img = (w = 96, h = 200): Img => ({ w, h, px: new Uint8ClampedArray(w * h * 4) });
const tl = (): Timeline => JSON.parse(miniText);
const idle = [img(), img()];
const hurt = [img(), img()];
const store: Record<string, Img[]> = { idle, hurt };
const frames = (_c: string, a: string) => store[a] ?? [];
const act = (a: Partial<Actor>): Actor => ({ id: "x", char: "w", x: 100, y: 250, actions: [], ...a });

test("camera: midpoint, holds both ends, whole pixels", () => {
  const keys = [{ t: 0, x: 0, y: 0 }, { t: 6, x: 480, y: 0 }];
  expect(camAt(keys, 3)).toEqual({ x: 240, y: 0 });
  expect(camAt(keys, -1)).toEqual({ x: 0, y: 0 });
  expect(camAt(keys, 99)).toEqual({ x: 480, y: 0 });
  const c = camAt(keys, 1.234);
  expect(Number.isInteger(c.x) && Number.isInteger(c.y)).toBe(true);
  expect(camAt([], 1)).toEqual({ x: 0, y: 0 });
});

test("walk feet and draw position", () => {
  const p = pose(tl().actors[0], 2.1, frames)!;
  expect(p.feet).toEqual({ x: 66, y: 250 });
  expect([p.drawX, p.drawY]).toEqual([66 - 48, 250 - 200]);
});

test("look_around flips mid-way only; flip keeps draw position", () => {
  const a = tl().actors[0];
  expect(pose(a, 4, frames)!.flip).toBe(true);
  expect(pose(a, 3.2, frames)!.flip).toBe(false);
  expect(pose(a, 4.9, frames)!.flip).toBe(false);
  expect(pose({ ...a, flip: true }, 0.5, frames)!.drawX).toBe(pose(a, 0.5, frames)!.drawX);
});

test("scrubbing back gives the same pose", () => {
  const a = tl().actors[0];
  const fresh = pose(a, 2.1, frames);
  pose(a, 4, frames);
  expect(pose(a, 2.1, frames)).toEqual(fresh);
});

test("startle holds hurt frame 2, then back to idle", () => {
  const a = act({ actions: [{ id: "s", t: 1, do: "startle", dur: 1 }] });
  expect(pose(a, 1.9, frames)!.img).toBe(hurt[1]);
  expect(pose(a, 2.5, frames)!.anim).toBe("idle");
});

test("shot_at picks the shot, last at duration", () => {
  const t = tl();
  expect(shotAt(t, 5.99).id).toBe("s1");
  expect(shotAt(t, 6).id).toBe("s2");
  expect(shotAt(t, 8).id).toBe("s2");
});

test("appear: null before, posed after", () => {
  const a = { ...tl().actors[0], appear: 1 };
  expect(pose(a, 0.5, frames)).toBeNull();
  expect(pose(a, 1.5, frames)).not.toBeNull();
});

test("mixed_frame_sizes: feet anchor holds for every frame", () => {
  const mixed: Record<string, Img[]> = { idle: [img(20, 30), img(24, 34)] };
  const f = (_c: string, n: string) => mixed[n] ?? [];
  const a = act({ x: 100, y: 200 });
  for (const [t, w] of [[0, 20], [1 / ANIM_FPS + 0.001, 24]]) {
    const p = pose(a, t, f)!;
    expect(p.img!.w).toBe(w);
    expect(p.drawY + p.img!.h).toBe(200);
    expect(p.drawX + Math.floor(p.img!.w / 2)).toBe(100);
  }
});

test("anim_fallback_last_frame: missing anim falls back to looping idle", () => {
  const three = [img(), img(), img()];
  const f = (_c: string, n: string) => (n === "idle" ? three : []);
  const a = act({ actions: [{ id: "w", t: 0, do: "anim:windup" }] });
  expect(pose(a, 0.5, f)!.img).toBe(three[0]); // idx 6 -> 6 % 3 = 0, not stuck on the last frame
  expect(pose(a, 4 / ANIM_FPS + 0.001, f)!.img).toBe(three[1]);
});

test("audio plan: offsets, sorting, cut at scene end", () => {
  const audio = [{ id: "v1", t: 7, clip: "line", kind: "voice" as const }, { id: "m1", t: 0, clip: "music", kind: "music" as const }];
  const lens = { line: 2, music: 40 };
  const at8 = activeAudio(audio, 8, lens, 30);
  expect(at8.map((x) => x.id)).toEqual(["m1", "v1"]);
  expect(at8[1].offset).toBeCloseTo(1);
  expect(activeAudio(audio, 9, lens, 30).some((x) => x.id === "v1")).toBe(false);
  expect(activeAudio(audio, 30, lens, 30)).toEqual([]);
});
