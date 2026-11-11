import { expect, test } from "vitest";
import miniText from "./fixtures/mini.json?raw";
import { ANIM_FPS, actionSpan, pose, shotAt } from "../src/core/acting";
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

test("hurt_flash_and_shake", () => {
  const a = act({ actions: [{ id: "h", t: 1.0, do: "hurt" }] });
  const p = (t: number) => pose(a, t, frames)!;
  expect(p(1.0).flash).toBe(true);
  expect(p(1.0).shake).toBe(2);
  expect(p(1.2).flash).toBe(false);
  expect(p(1.5).shake).toBe(0);
  expect(p(0.5).flash).toBe(false);
  expect(p(1.0).anim).toBe("hurt"); // the kit has a hurt anim here
});

test("dust_progress_then_gone", () => {
  const a = act({ actions: [{ id: "d", t: 1.0, do: "dust", dur: 1.5 }, { id: "w", t: 3.0, do: "walk", to: [300, 250], dur: 1 }] });
  expect(pose(a, 0.9, frames)!.dust).toBeNull();
  expect(pose(a, 1.75, frames)!.dust).toBeCloseTo(0.5);
  expect(pose(a, 1.75, frames)!.gone).toBe(false);
  const g = pose(a, 2.5, frames)!;
  expect(g.gone).toBe(true);
  expect(g.img).toBeNull();
  expect(pose(a, 3.5, frames)!.gone).toBe(true);
});

test("dust freezes the pose at its start", () => {
  const a = act({ actions: [{ id: "w", t: 0, do: "walk", to: [200, 250], dur: 2 }, { id: "d", t: 1, do: "dust", dur: 1.5 }] });
  const p0 = pose(a, 1, frames)!, p1 = pose(a, 1.9, frames)!;
  expect([p1.feet, p1.frame, p1.anim]).toEqual([p0.feet, p0.frame, p0.anim]);
});

test("an_anim_move_plays_once_then_stands_again", () => {
  const atk = [img(), img(), img()];
  const f = (_c: string, n: string) => (n === "attack" ? atk : n === "idle" ? idle : []);
  const a = act({ actions: [{ id: "w", t: 0, do: "anim:attack" }] });
  expect(pose(a, 2 / ANIM_FPS + 0.001, f)!.img).toBe(atk[2]);
  const after = pose(a, 3 / ANIM_FPS + 0.001, f)!;
  expect(after.anim).toBe("idle");
  expect(after.img).toBe(idle[0]); // the stand starts over where the move ended
});
test("an_anim_move_with_a_duration_holds_its_last_frame_until_then", () => {
  const atk = [img(), img(), img()];
  const f = (_c: string, n: string) => (n === "attack" ? atk : n === "idle" ? idle : []);
  const a = act({ actions: [{ id: "w", t: 0, do: "anim:attack", dur: 1 }] });
  expect(pose(a, 0.9, f)!.img).toBe(atk[2]);
  expect(pose(a, 1.01, f)!.anim).toBe("idle");
});
test("a_death_stays_down", () => {
  const die = [img(), img()];
  const f = (_c: string, n: string) => (n === "death" ? die : n === "idle" ? idle : []);
  const a = act({ actions: [{ id: "w", t: 0, do: "anim:death" }] });
  expect(pose(a, 5, f)!.img).toBe(die[1]);
});
test("a_bar_without_a_duration_is_as_long_as_what_plays", () => {
  const f = (_c: string, n: string) => (n === "attack" ? [img(), img(), img()] : n === "hurt" ? hurt : []);
  expect(actionSpan({ id: "a", t: 0, do: "anim:attack" }, "w", f)).toBeCloseTo(3 / ANIM_FPS);
  expect(actionSpan({ id: "a", t: 0, do: "anim:attack", dur: 2 }, "w", f)).toBe(2);
  expect(actionSpan({ id: "a", t: 0, do: "hurt" }, "w", f)).toBeCloseTo(2 / ANIM_FPS);
  expect(actionSpan({ id: "a", t: 0, do: "say", text: "Hi" }, "w", f)).toBe(2);
  expect(actionSpan({ id: "a", t: 0, do: "walk", dur: 3 }, "w", f)).toBe(3);
  expect(actionSpan({ id: "a", t: 0, do: "idle" }, "w", f)).toBeUndefined();
});

test("a walk faces the way it goes and keeps facing it; a move (slide) does not turn", () => {
  const w = act({ actions: [{ id: "a", t: 0, do: "walk", to: [40, 250], dur: 1 }, { id: "b", t: 2, do: "walk", to: [300, 250], dur: 1 }] });
  expect(pose(w, 0.5, frames)!.flip).toBe(true); // going left
  expect(pose(w, 1.5, frames)!.flip).toBe(true); // stays turned after
  expect(pose(w, 2.5, frames)!.flip).toBe(false); // going right again
  const f = act({ flip: true, actions: [{ id: "a", t: 0, do: "walk", to: [100, 300], dur: 1 }] });
  expect(pose(f, 0.5, frames)!.flip).toBe(true); // straight down: keeps its facing
  const m = act({ actions: [{ id: "a", t: 0, do: "move", to: [40, 250], dur: 1 }] });
  expect(pose(m, 0.5, frames)!.flip).toBe(false); // knocked back: still faces forward
});
