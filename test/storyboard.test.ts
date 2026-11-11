import { expect, test } from "vitest";
import { validateTimeline } from "../src/core/timeline";
import type { Timeline } from "../src/core/types";
import { moveShot } from "../src/ui/timelineEditor";

const tl = (): Timeline => ({
  name: "t", duration: 3,
  shots: [
    { id: "s1", type: "wide", start: 0, end: 1, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] },
    { id: "s2", type: "wide", start: 1, end: 3, bg_scale: 1, camera: [{ t: 1, x: 0, y: 0 }, { t: 2, x: 50, y: 0 }], transition: { kind: "dissolve", dur: 0.5 } },
  ],
  actors: [{ id: "hero", char: "hero", x: 10, y: 10, appear: 0.2, actions: [{ id: "a1", t: 0.5, do: "idle" }, { id: "a2", t: 2, do: "idle" }] }],
  fx: [{ id: "f1", t: 1.5, fx: "x", x: 0, y: 0 }], audio: [{ id: "au1", t: 0, clip: "c", kind: "sfx" }],
  time: [{ id: "tm1", t: 2.5, dur: 0.1, kind: "hold" }],
});

test("moveShot: a shot moves with everything that starts inside it; the rest close up behind", () => {
  const r = moveShot(tl(), 1, 0);
  expect(r.error).toBeUndefined();
  const t = r.tl;
  expect(t.shots.map((s) => [s.id, s.start, s.end])).toEqual([["s2", 0, 2], ["s1", 2, 3]]);
  expect(t.actors[0].appear).toBe(2.2);
  expect(t.actors[0].actions.map((a) => [a.id, a.t])).toEqual([["a2", 1], ["a1", 2.5]]);
  expect((t.shots[0] as any).camera).toEqual([{ t: 0, x: 0, y: 0 }, { t: 1, x: 50, y: 0 }]);
  expect(t.fx[0].t).toBe(0.5);
  expect(t.audio[0].t).toBe(2);
  expect(t.time![0].t).toBe(1.5);
  expect(t.shots[0].transition).toBeUndefined(); // the first shot has nothing to dissolve from
  expect(validateTimeline(t)).toEqual([]);
  expect(moveShot(tl(), 0, 0).tl).toEqual(tl());
});
