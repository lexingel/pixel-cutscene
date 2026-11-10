import { expect, test } from "vitest";
import miniText from "./fixtures/mini.json?raw";
import { parseTimeline, keepLocked } from "../src/core/timeline";
import type { Timeline } from "../src/core/types";

const mini = (): any => JSON.parse(miniText);
const errs = (d: unknown) => parseTimeline(JSON.stringify(d)).errors;
const has = (e: string[], part: string) => e.some((x) => x.includes(part));

test("mini parses clean", () => {
  const r = parseTimeline(miniText);
  expect(r.errors).toEqual([]);
  expect(r.ok).toBe(true);
  expect(r.data?.name).toBe("mini");
});

// The rift scene lives in the parent repo only; the published web/ repo skips this.
const riftText = Object.values(import.meta.glob("../../scenes/rift.json", { query: "?raw", import: "default", eager: true }))[0] as string | undefined;
test.skipIf(!riftText)("rift_loads", () => {
  const r = parseTimeline(riftText!);
  expect(r.errors).toEqual([]);
  expect(r.ok).toBe(true);
});

test("kit_optional", () => {
  const d = mini();
  delete d.kit;
  expect(errs(d)).toEqual([]);
});

test("broken json gives one (root) error", () => {
  const r = parseTimeline('{"name": ');
  expect(r.ok).toBe(false);
  expect(r.errors).toHaveLength(1);
  expect(r.errors[0].startsWith("(root)")).toBe(true);
  expect(r.data).toBeNull();
});

test("top level must be an object", () => {
  expect(parseTimeline("[]").errors[0]).toBe("(root): top level must be an object");
});

test("unknown action names a1.do", () => {
  const d = mini();
  d.actors[0].actions[0].do = "wlak";
  expect(has(errs(d), "a1.do")).toBe(true);
});

test("anim:<name> is an action", () => {
  const d = mini();
  d.actors[0].actions[0].do = "anim:cast";
  expect(errs(d)).toEqual([]);
});

test("action past the end names a1.t", () => {
  const d = mini();
  d.actors[0].actions[0].t = 31;
  d.duration = 30;
  d.shots[1].end = 30;
  expect(has(errs(d), "a1.t")).toBe(true);
});

test("overlapping / gapped shots name the later shot", () => {
  let d = mini();
  d.shots[1].start = 5;
  expect(has(errs(d), "s2")).toBe(true);
  d = mini();
  d.shots[1].start = 7;
  expect(has(errs(d), "s2")).toBe(true);
});

test("duplicate id reported", () => {
  const d = mini();
  d.fx[0].id = "a1";
  expect(has(errs(d), "duplicate")).toBe(true);
});

test("fractional closeup_scale reported", () => {
  const d = mini();
  d.closeup_scale = 2.5;
  expect(has(errs(d), "closeup_scale")).toBe(true);
});

test("fields the stage needs are validated", () => {
  let d = mini();
  delete d.fx[0].x;
  expect(has(errs(d), "f1.x")).toBe(true);
  d = mini();
  delete d.shots[0].camera[1].x;
  expect(has(errs(d), "s1.camera")).toBe(true);
  d = mini();
  d.actors[0].flip = "yes";
  expect(has(errs(d), "warrior.flip")).toBe(true);
  d = mini();
  delete d.audio[0].clip;
  expect(has(errs(d), "m1.clip")).toBe(true);
  d = mini();
  d.actors[0].actions = "walk";
  expect(has(errs(d), "warrior.actions")).toBe(true);
});

test("path-like name rejected", () => {
  const d = mini();
  d.name = "../tests";
  expect(has(errs(d), "(root).name")).toBe(true);
});

test("keepLocked: locked action survives redraft; unlocked takes new draft", () => {
  const old = mini();
  old.actors[0].actions[0].t = 1.5;
  old.actors[0].actions[0].locked = true;
  old.fx[0].locked = true;
  old.audio[0].vol_db = -20;
  const fresh = mini();
  fresh.fx = [];
  const m = keepLocked(old, fresh);
  expect(m.actors[0].actions[0].t).toBe(1.5);
  expect(m.fx).toHaveLength(1);
  expect(m.fx[0].id).toBe("f1");
  expect(m.audio[0].vol_db).toBe(-6);
});

test("keepLocked: locked action kept with its dropped actor", () => {
  const old = mini();
  old.actors[0].actions[1].locked = true;
  const fresh = mini();
  fresh.actors = [];
  const m = keepLocked(old, fresh);
  expect(m.actors).toHaveLength(1);
  expect(m.actors[0].actions).toHaveLength(1);
  expect(m.actors[0].actions[0].id).toBe("a2");
});

test("keepLocked: locked shot replaces the new shots it overlaps", () => {
  const old = mini();
  old.shots[1].start = 5;
  old.shots[0].end = 5;
  old.shots[1].locked = true;
  const m = keepLocked(old, mini());
  expect(m.shots).toHaveLength(2);
  expect(m.shots[1].start).toBe(5);
});

test("keepLocked does not mutate its inputs", () => {
  const old: Timeline = mini();
  const fresh: Timeline = mini();
  const snap = JSON.stringify(fresh);
  keepLocked(old, fresh);
  expect(JSON.stringify(fresh)).toBe(snap);
});

test("fx_reach_is_1_to_4", () => {
  const d = JSON.parse(miniText);
  d.fx = [{ id: "f1", t: 0, fx: "x", x: 0, y: 0, reach: 2.5 }, { id: "f2", t: 0, fx: "x", x: 0, y: 0, reach: 5 }];
  const e = errs(d).join("\n");
  expect(e).not.toContain("f1.reach");
  expect(e).toContain("f2.reach: must be 1 to 4");
});
