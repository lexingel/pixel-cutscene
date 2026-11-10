import { describe, expect, test } from "vitest";
import { framingIssues } from "../src/core/framing";
import type { Img, Kit } from "../src/core/kit";
import type { Timeline } from "../src/core/types";

const img = (w: number, h: number): Img => ({ w, h, px: new Uint8ClampedArray(w * h * 4) });
const piece = { approved: true, source: "user" as const };
const W = 320, H = 180;

function scene(bgW: number, bgH: number, camera = [{ t: 0, x: 0, y: 0 }], bg_scale = 1) {
  const tl: Timeline = {
    name: "f", duration: 5,
    shots: [{ id: "s1", type: "wide", start: 0, end: 5, bg: "cave", bg_scale, camera }],
    actors: [], fx: [], audio: [],
  };
  const kit: Kit = { chars: { hero: { view: "side", anims: { idle: { ...piece, frames: ["h.png"] } } } }, faces: {}, assets: { cave: { ...piece, kind: "bg", path: "bg.png" } } };
  const imgs: Record<string, Img> = { "bg.png": img(bgW, bgH), "h.png": img(20, 30) };
  return { tl, kit, run: () => framingIssues(tl, kit, (p) => imgs[p] ?? null, W, H) };
}

describe("framingIssues: background", () => {
  test("a background that covers the frame is fine", () => {
    expect(scene(320, 180).run()).toEqual([]);
  });
  test("too narrow: black at the right, Fill offers the smallest whole scale that covers", () => {
    const issues = scene(240, 180).run();
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("s1");
    expect(issues[0].msg).toContain("right");
    expect(issues[0].msg).toMatch(/^Shot 1: /); // a number, never the id s1
    expect(issues[0].fill).toBe(2);
  });
  test("a camera pan past the edge counts, and the fill keeps the pan", () => {
    const issues = scene(320, 180, [{ t: 0, x: 0, y: 0 }, { t: 5, x: 200, y: 0 }]).run();
    expect(issues[0].msg).toContain("right");
    expect(issues[0].fill).toBe(2); // 320 * 2 >= 320 + 200
  });
  test("camera left of 0: no scale fixes it, so no fill, and the message says move the camera", () => {
    const issues = scene(640, 360, [{ t: 0, x: -10, y: 0 }]).run();
    expect(issues[0].msg).toContain("left");
    expect(issues[0].msg).toContain("camera");
    expect(issues[0].fill).toBeUndefined();
  });
});

describe("framingIssues: actors", () => {
  test("standing half off the left edge for the whole shot is reported once", () => {
    const s = scene(320, 180);
    s.tl.actors = [{ id: "hero1", char: "hero", x: 4, y: 150, actions: [] }];
    const issues = s.run();
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("hero1");
    expect(issues[0].msg).toContain("left");
    expect(issues[0].msg).toContain("Shot 1");
    expect(issues[0].msg).not.toMatch(/hero1|s1/);
  });
  test("walking in from off screen is not reported", () => {
    const s = scene(320, 180);
    s.tl.actors = [{ id: "hero1", char: "hero", x: -30, y: 150, actions: [{ id: "a1", t: 0, do: "walk", to: [100, 150], dur: 2 }] }];
    expect(s.run()).toEqual([]);
  });
  test("fully inside is fine", () => {
    const s = scene(320, 180);
    s.tl.actors = [{ id: "hero1", char: "hero", x: 160, y: 150, actions: [] }];
    expect(s.run()).toEqual([]);
  });
});

describe("framingIssues: scaled characters", () => {
  test("framing_uses_scaled_bounds", () => {
    // 20x100 at scale 2 is 40x200 in a 180-high frame; feet at the bottom edge put the top at y -20
    const { tl, kit } = scene(320, 180);
    kit.chars.hero.scale = 2;
    tl.actors = [{ id: "ogre", char: "hero", x: 160, y: 180, actions: [] }];
    const imgs: Record<string, Img> = { "bg.png": img(320, 180), "h.png": img(20, 100) };
    const issues = framingIssues(tl, kit, (p) => imgs[p] ?? null, W, H);
    expect(issues.map((i) => i.msg)).toEqual(["hero is cut off by the top edge in Shot 1."]);
    kit.chars.hero.scale = undefined; // 100 high, fully inside
    expect(framingIssues(tl, kit, (p) => imgs[p] ?? null, W, H)).toEqual([]);
  });
});
