import { describe, expect, it } from "vitest";
import { validateTimeline } from "../src/core/timeline";
import { frameZoom, renderFrame, zoomAt } from "../src/core/render";
import { zoomFrame } from "../src/core/raster";
import type { Img } from "../src/core/kit";
import type { Timeline, WideShot } from "../src/core/types";
import { insertShot, panShot, splitShot, transition } from "../src/ui/timelineEditor";

const tl = (): Timeline => ({
  name: "t", duration: 6,
  shots: [{ id: "s1", type: "wide", start: 0, end: 6, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
  actors: [], fx: [], audio: [],
});

describe("insertShot", () => {
  it("puts a shot of the given length at t and the old shot carries on after it", () => {
    const r = insertShot(tl(), 2, 2, { zoom: { from: 3, to: 3, x: 10, y: 20 } });
    expect(r.error).toBeUndefined();
    expect(r.tl.shots.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 4], [4, 6]]);
    expect((r.tl.shots[1] as WideShot).zoom).toEqual({ from: 3, to: 3, x: 10, y: 20 });
    expect(r.tl.shots[1].id).toBe(r.id);
    expect((r.tl.shots[2] as WideShot).zoom).toBeUndefined();
    expect(validateTimeline(r.tl)).toEqual([]);
  });
  it("runs to the shot's end when there is no length (or it would pass the end)", () => {
    expect(insertShot(tl(), 2, undefined, {}).tl.shots.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 6]]);
    expect(insertShot(tl(), 5, 2, {}).tl.shots.map((s) => [s.start, s.end])).toEqual([[0, 5], [5, 6]]);
  });
  it("at a shot's start it replaces that span instead of making an empty shot", () => {
    const r = insertShot(tl(), 0, 2, { zoom: { from: 2, to: 2, x: 0, y: 0 } });
    expect(r.tl.shots.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 6]]);
    expect(validateTimeline(r.tl)).toEqual([]);
  });
  it("a close-up portrait becomes a closeup shot", () => {
    const r = insertShot(tl(), 1, 2, { type: "closeup", face: "ann", expr: "neutral" });
    expect(r.tl.shots[1]).toMatchObject({ type: "closeup", face: "ann", expr: "neutral", start: 1, end: 3 });
    expect(validateTimeline(r.tl)).toEqual([]);
  });
});

describe("panShot", () => {
  it("moves the camera across the overflow of the background from t to the shot end", () => {
    const r = panShot(tl(), 2, "right", { x: 100, y: 0 });
    expect(r.error).toBeUndefined();
    const s = r.tl.shots[1] as WideShot;
    expect([s.start, s.end]).toEqual([2, 6]);
    expect(s.camera).toEqual([{ t: 2, x: 0, y: 0 }, { t: 6, x: 100, y: 0 }]);
  });
  it("refuses when there is nothing to pan to", () => expect(panShot(tl(), 2, "left", { x: 100, y: 0 }).error).toMatch(/background/));
});

describe("transition", () => {
  it("sets a fade, flash or shake on the shot under t", () => {
    let r = transition(tl(), 1, "fade_in");
    expect((r.tl.shots[0] as WideShot).fade_in).toBe(0.5);
    r = transition(r.tl, 1, "flash");
    expect(r.tl.shots[0].flash).toBe(0.3);
    r = transition(r.tl, 1, "shake");
    expect(r.tl.shots[0].shake).toBe(0.5);
    expect(validateTimeline(r.tl)).toEqual([]);
  });
});

describe("zoom", () => {
  it("eases from `from` to `to` across the shot", () => {
    const s = { ...tl().shots[0], zoom: { from: 1, to: 3, x: 0, y: 0 } } as WideShot;
    expect(zoomAt(s, 0)).toBe(1);
    expect(zoomAt(s, 3)).toBeCloseTo(2);
    expect(zoomAt(s, 6)).toBe(3);
    expect(zoomAt(tl().shots[0], 3)).toBe(1);
  });
  const rainbow = (): Img => {
    const src: Img = { w: 8, h: 4, px: new Uint8ClampedArray(8 * 4 * 4) };
    for (let i = 0; i < 32; i++) src.px.set([i * 7, i, 0, 255], i * 4); // every pixel a different colour
    return src;
  };
  it("a whole-number zoom draws every art pixel as a whole number of output pixels", () => {
    const k = 3, out = new Uint8ClampedArray(8 * k * 4 * k * 4);
    zoomFrame(rainbow(), 2, 4, 2, k, out); // 2 at x3 = 6 output pixels per art pixel
    const row = Array.from({ length: 8 * k }, (_, x) => out[(2 * 8 * k + x) * 4]); // a middle row
    const runs: number[] = [];
    row.forEach((v, x) => (x && v === row[x - 1] ? runs[runs.length - 1]++ : runs.push(1)));
    expect(runs.slice(1, -1).every((n) => n === 6)).toBe(true); // inner runs; the edges may be cut
  });
  it("an animated zoom exported big moves smoothly, not in whole steps", () => {
    const k = 3, a = new Uint8ClampedArray(8 * k * 4 * k * 4), b = new Uint8ClampedArray(a.length);
    zoomFrame(rainbow(), 1.5, 4, 2, k, a);
    zoomFrame(rainbow(), 1.6, 4, 2, k, b);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
  it("keeps the focus in the frame (the view never leaves the picture)", () => {
    const src: Img = { w: 4, h: 2, px: new Uint8ClampedArray(4 * 2 * 4) };
    src.px.set([255, 0, 0, 255], 0); // top-left pixel red
    const out = new Uint8ClampedArray(4 * 2 * 4);
    zoomFrame(src, 2, 0, 0, 1, out); // zoom on the corner: the view clamps to the top-left quarter
    expect(Array.from(out.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(out.slice(4, 8))).toEqual([255, 0, 0, 255]); // one art pixel, two wide
  });
});

describe("flash and shake", () => {
  const img = () => ({ w: 4, h: 4, px: new Uint8ClampedArray(64) });
  const input = (t: Timeline) => ({ tl: t, kit: { chars: {}, faces: {}, assets: {} } as any, img: () => null, draft: false, W: 4, H: 4 });
  it("a flash starts white and fades back", () => {
    const t = tl();
    t.shots[0].flash = 0.3;
    const out = img();
    renderFrame(input(t), 0, out);
    expect(out.px[0]).toBe(255);
    renderFrame(input(t), 0.3, out);
    expect(out.px[0]).toBe(0);
  });
});

describe("review fixes", () => {
  it("a cut inside a zoom keeps the zoom going from where it was", () => {
    const t = tl();
    (t.shots[0] as WideShot).zoom = { from: 1, to: 3, x: 0, y: 0 };
    const mid = zoomAt(t.shots[0], 3);
    const [a, b] = splitShot(t, "s1", 3).tl.shots as WideShot[];
    expect(zoomAt(a, 0)).toBe(1);
    expect(zoomAt(a, 3)).toBeCloseTo(mid);
    expect(zoomAt(b, 3)).toBeCloseTo(mid);
    expect(zoomAt(b, 6)).toBe(3);
  });
  it("at the scene's end a new shot asks for the playhead to move back", () => {
    expect(insertShot(tl(), 6, 2, {}).error).toMatch(/before the end of the scene/);
  });
  it("a broken zoom, flash or shake is an error, not a black frame", () => {
    const t = tl() as any;
    t.shots[0].zoom = { from: "x", to: 2, x: 0, y: 0 };
    t.shots[0].flash = -1;
    t.shots[0].shake = "a";
    const e = validateTimeline(t).join(" | ");
    expect(e).toMatch(/s1\.zoom/);
    expect(e).toMatch(/s1\.flash/);
    expect(e).toMatch(/s1\.shake/);
    t.shots[0].zoom = { from: 0.5, to: 2, x: 0, y: 0 };
    expect(validateTimeline(t).join(" | ")).toMatch(/s1\.zoom/);
  });
  it("a zoom that follows an actor keeps them in view as they walk", () => {
    const t = tl();
    t.actors = [{ id: "a", char: "c", x: 50, y: 60, actions: [{ id: "w", t: 0, do: "walk", to: [150, 60], dur: 4 }] }];
    (t.shots[0] as WideShot).zoom = { from: 2, to: 2, x: 0, y: 0, actor: "a" };
    const piece = { approved: true, source: "user" as const, frames: ["c.png"] };
    const kit = { chars: { c: { view: "side", anims: { idle: piece, walk: piece } } }, faces: {}, assets: {} } as any;
    const im: Img = { w: 10, h: 20, px: new Uint8ClampedArray(800) };
    const p = { tl: t, kit, img: (k: string) => (k === "c.png" ? im : null), draft: false, W: 200, H: 120 };
    const z0 = frameZoom(p, 0)!, z1 = frameZoom(p, 2)!;
    expect(z0.x).toBeCloseTo(50, 0);
    expect(z1.x).toBeGreaterThan(z0.x + 5);
  });
});
