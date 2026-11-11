import { expect, test } from "vitest";
import type { Timeline } from "../src/core/types";
import { applyToOthers, copyMany, deleteMany, moveMany, pasteMany } from "../src/ui/timelineEditor";

const tl = (): Timeline => ({
  name: "t", duration: 10,
  shots: [{ id: "s1", type: "wide", start: 0, end: 10, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
  actors: [
    { id: "hero1", char: "hero", x: 10, y: 100, actions: [{ id: "a1", t: 1, do: "hurt" }, { id: "a2", t: 1.5, do: "dust", dur: 0.5 }] },
    { id: "hero2", char: "hero", x: 60, y: 100, actions: [] },
    { id: "hero3", char: "hero", x: 90, y: 100, actions: [{ id: "a3", t: 4, do: "startle" }] },
  ],
  fx: [{ id: "f1", t: 2, fx: "spark", x: 5, y: 6 }], audio: [],
});

test("copyMany keeps each bar's offset from the earliest; pasteMany lands them at the playhead on their own rows", () => {
  const t = tl();
  const clips = copyMany(t, ["f1", "a2", "a1", "s1"]); // a shot is not copied
  expect(clips.map((c) => [c.kind, c.dt])).toEqual([["action", 0], ["action", 0.5], ["fx", 1]]);
  const r = pasteMany(t, clips, 6);
  expect(r.error).toBeUndefined();
  expect(r.ids).toHaveLength(3);
  expect(r.tl.actors[0].actions.map((a) => [a.do, a.t])).toEqual([["hurt", 1], ["dust", 1.5], ["hurt", 6], ["dust", 6.5]]);
  expect(r.tl.fx.map((f) => f.t)).toEqual([2, 7]);
});

test("pasteMany onto another actor: moves from a single actor follow the chosen one", () => {
  const r = pasteMany(tl(), copyMany(tl(), ["a1", "a2"]), 3, "hero2");
  expect(r.tl.actors[1].actions.map((a) => [a.do, a.t])).toEqual([["hurt", 3], ["dust", 3.5]]);
  expect(r.tl.actors[0].actions).toHaveLength(2);
});

test("moveMany shifts every bar by the same amount and stops at the scene's start", () => {
  let r = moveMany(tl(), ["a1", "f1", "a3"], 0.5);
  expect([r.tl.actors[0].actions[0].t, r.tl.fx[0].t, r.tl.actors[2].actions[0].t]).toEqual([1.5, 2.5, 4.5]);
  r = moveMany(tl(), ["a1", "f1"], -3); // a1 would go below 0: the whole group stops at 0
  expect([r.tl.actors[0].actions[0].t, r.tl.fx[0].t]).toEqual([0, 1]);
});

test("deleteMany removes them all in one step", () => {
  const r = deleteMany(tl(), ["a1", "f1", "a3"]);
  expect(r.error).toBeUndefined();
  expect(r.tl.actors[0].actions.map((a) => a.id)).toEqual(["a2"]);
  expect(r.tl.fx).toEqual([]);
  expect(r.tl.actors[2].actions).toEqual([]);
});

test("applyToOthers gives every other actor the same move at the same time", () => {
  const r = applyToOthers(tl(), "a1");
  expect(r.ids).toHaveLength(2);
  expect(r.tl.actors[1].actions.map((a) => [a.do, a.t])).toEqual([["hurt", 1]]);
  expect(r.tl.actors[2].actions.map((a) => [a.do, a.t])).toEqual([["hurt", 1], ["startle", 4]]);
  expect(applyToOthers(tl(), "f1").error).toBeTruthy(); // only moves
});
