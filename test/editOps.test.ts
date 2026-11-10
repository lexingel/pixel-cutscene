import { expect, test } from "vitest";
import { validateTimeline } from "../src/core/timeline";
import type { Timeline } from "../src/core/types";
import { camAt } from "../src/core/cam";
import { newProject } from "../src/core/project";
import { swaps, targetOf, useOwnFiles } from "../src/ui/approvals";
import {
  History, addAction, addEntry, deleteEntry, moveEntry, moveShotEdge, resizeEntry, setCamera, setField, splitShot,
} from "../src/ui/timelineEditor";

const tl = (): Timeline => ({
  name: "t", duration: 5,
  shots: [
    { id: "s1", type: "wide", start: 0, end: 3, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] },
    { id: "s2", type: "wide", start: 3, end: 5, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] },
  ],
  actors: [{ id: "hero1", char: "hero", x: 10, y: 100, actions: [{ id: "a1", t: 1, do: "walk", to: [50, 100], dur: 2 }] }],
  fx: [], audio: [],
});

test("move_snaps_to_frame", () => {
  const r1 = moveEntry(tl(), "a1", 1.01);
  expect(r1.error).toBeUndefined();
  expect(r1.tl.actors[0].actions[0].t).toBe(1);
  expect(moveEntry(tl(), "a1", 1.02).tl.actors[0].actions[0].t).toBe(31 / 30);
  expect(resizeEntry(tl(), "a1", 0.51).tl.actors[0].actions[0].dur).toBe(0.5);
  expect(moveEntry(tl(), "a1", 9).tl.actors[0].actions[0].t).toBe(5); // clamped to the scene
});

test("shot_edge_keeps_tiling", () => {
  const r = moveShotEdge(tl(), "s1", "s2", 2.01);
  expect(r.error).toBeUndefined();
  expect(r.tl.shots[0].end).toBe(2);
  expect(r.tl.shots[1].start).toBe(2);
  expect(validateTimeline(r.tl)).toEqual([]);
  // past the next shot's end would leave an empty shot: refused
  const bad = moveShotEdge(tl(), "s1", "s2", 5.5);
  expect(bad.error).toBeTruthy();
  // deleting a shot hands its time to a neighbour
  const d = deleteEntry(tl(), "s2");
  expect(d.tl.shots).toHaveLength(1);
  expect(d.tl.shots[0].end).toBe(5);
  expect(validateTimeline(d.tl)).toEqual([]);
});

test("invalid_edit_rejected_unchanged", () => {
  const before = tl();
  const r = setField(before, "a1", "do", "fly");
  expect(r.tl).toBe(before);
  expect(r.error).toMatch(/unknown action/);
  expect(before.actors[0].actions[0].do).toBe("walk");
  expect(setField(before, "nope", "t", 1).error).toBeTruthy();
  // valid edits return a new timeline and leave the old one alone
  const ok = setField(before, "a1", "dur", 3);
  expect(ok.tl).not.toBe(before);
  expect(ok.tl.actors[0].actions[0].dur).toBe(3);
  expect(before.actors[0].actions[0].dur).toBe(2);
  const add = addAction(before, "hero1", { t: 4, do: "idle" });
  expect(add.tl.actors[0].actions).toHaveLength(2);
  expect(validateTimeline(add.tl)).toEqual([]);
});

test("undo_redo", () => {
  const h = new History();
  const a = tl();
  const b = moveEntry(a, "a1", 2).tl;
  const c = moveEntry(b, "a1", 3).tl;
  h.push(a);
  h.push(b);
  expect(h.undo(c)).toBe(b);
  expect(h.undo(b)).toBe(a);
  expect(h.undo(a)).toBeNull();
  expect(h.redo(a)).toBe(b);
  expect(h.redo(b)).toBe(c);
  expect(h.redo(c)).toBeNull();
  h.undo(c);
  h.push(b); // a new edit clears redo
  expect(h.redo(c)).toBeNull();
  for (let i = 0; i < 150; i++) h.push(a);
  let n = 0;
  while (h.undo(a)) n++;
  expect(n).toBe(100);
});

const panned = (): Timeline => {
  const d = tl();
  d.shots = [{ id: "s1", type: "wide", start: 0, end: 5, bg_scale: 1, fade_in: 0.5, fade_out: 0.5, camera: [{ t: 0, x: 0, y: 0 }, { t: 4, x: 100, y: 0 }] }];
  d.audio = [{ id: "m1", t: 0, clip: "music1", kind: "music" }];
  return d;
};

test("split_shot_fades_and_camera", () => {
  const r = splitShot(panned(), "s1", 2.01);
  expect(r.error).toBeUndefined();
  const [a, b] = r.tl.shots as any[];
  expect([a.start, a.end, b.start, b.end]).toEqual([0, 2, 2, 5]);
  expect(b.id).toBe(r.id);
  expect(a.fade_in).toBe(0.5);
  expect(a.fade_out).toBeUndefined(); // the cut is not a fade
  expect(b.fade_in).toBeUndefined();
  expect(b.fade_out).toBe(0.5);
  // camera keys are in scene time (render.ts calls camAt(shot.camera, t) with the absolute t),
  // so both halves keep the full key list and the pan carries on across the cut
  for (const t of [1, 2, 3, 4.5]) expect(camAt((t < 2 ? a : b).camera, t)).toEqual(camAt((panned().shots[0] as any).camera, t));
  expect(validateTimeline(r.tl)).toEqual([]);
  expect(splitShot(panned(), "s1", 5).error).toBeTruthy();
  expect(splitShot(panned(), "a1", 2).error).toBeTruthy();
});

test("add_entry_gives_fresh_ids", () => {
  const r = addEntry(tl(), "fx", { t: 1, fx: "spark", x: 5, y: 5 }, "f");
  expect(r.id).toBe("f1");
  expect(r.tl.fx).toEqual([{ id: "f1", t: 1, fx: "spark", x: 5, y: 5 }]);
  const r2 = addEntry(r.tl, "fx", { t: 2, fx: "spark", x: 5, y: 5 }, "f");
  expect(r2.id).toBe("f2");
  const actor = addEntry(tl(), "actors", { char: "hero", x: 1, y: 2, actions: [] }, "hero");
  expect(actor.id).toBe("hero2"); // hero1 is taken
  const bad = addEntry(tl(), "audio", { t: 1, clip: "x", kind: "loud" }, "sound");
  expect(bad.error).toMatch(/kind/);
  expect(bad.tl.audio).toHaveLength(0);
});

test("set_camera_sorts_and_snaps", () => {
  const r = setCamera(panned(), "s1", [{ t: 4.01, x: 100, y: 0 }, { t: 0, x: 0, y: 0 }, { t: 2.02, x: 50, y: 10 }]);
  expect(r.error).toBeUndefined();
  expect((r.tl.shots[0] as any).camera).toEqual([{ t: 0, x: 0, y: 0 }, { t: 61 / 30, x: 50, y: 10 }, { t: 4, x: 100, y: 0 }]);
  expect(setCamera(panned(), "s1", []).error).toMatch(/camera/);
  expect(setCamera(panned(), "a1", [{ t: 0, x: 0, y: 0 }]).error).toBeTruthy();
});

test("minor_op_guards", () => {
  expect(resizeEntry(panned(), "m1", 2).error).toBeTruthy(); // a sound's length is its clip's
  expect(moveShotEdge(tl(), "a1", "s2", 2).error).toBeTruthy(); // not a shot
});

const proj = () => {
  const p = newProject("t");
  p.tl = tl();
  p.tl.shots[1] = { id: "s2", type: "closeup", start: 3, end: 5, face: "hero", expr: "amazed", bg: "realm" };
  p.tl.actors[0].actions.push({ id: "a2", t: 4, do: "anim:cheer" });
  p.tl.fx = [{ id: "f1", t: 1, fx: "spark", x: 0, y: 0 }];
  p.tl.audio = [{ id: "v1", t: 1, clip: "line1", kind: "voice" }];
  p.files.set("chars/hero/idle/idle_0.png", new Blob(["i"]));
  p.files.set("chars/hero/hurt/hurt_0.png", new Blob(["h"]));
  p.kit.chars.hero = { view: "side", anims: {
    idle: { approved: true, source: "user", frames: ["chars/hero/idle/idle_0.png"] },
    hurt: { approved: false, source: "pixellab", frames: ["chars/hero/hurt/hurt_0.png"] },
  } };
  return p;
};
const row = (what: string, used_by: string) => ({ what, why: "missing" as const, used_by });

test("approvals_target_of", () => {
  const t = proj().tl!;
  expect(targetOf(t, row("hero walk", "a1"))).toEqual({ kind: "anim", char: "hero", anim: "walk" });
  expect(targetOf(t, row("hero cheer", "a2"))).toEqual({ kind: "anim", char: "hero", anim: "cheer" });
  expect(targetOf(t, row("hero idle", "hero1"))).toEqual({ kind: "anim", char: "hero", anim: "idle" });
  expect(targetOf(t, row("face hero amazed", "s2"))).toEqual({ kind: "face", face: "hero", expr: "amazed" });
  expect(targetOf(t, row("realm", "s2"))).toEqual({ kind: "asset", id: "realm", asset: "bg" });
  expect(targetOf(t, row("spark", "f1"))).toEqual({ kind: "asset", id: "spark", asset: "fx" });
  expect(targetOf(t, row("line1", "v1"))).toEqual({ kind: "asset", id: "line1", asset: "voice" });
  expect(targetOf(t, row("x", "gone"))).toBeNull();
});

test("approvals_swaps_need_nothing_new", () => {
  const p = proj();
  // walk needs walk frames, startle needs approved hurt, look_around needs to-less nothing but a dur (a1 has one)
  expect(swaps(p, p.tl!, "a1")).toEqual(["idle", "look_around", "move", "hurt", "dust", "anim:attack", "anim:breathe", "anim:idle"]);
  expect(swaps(p, p.tl!, "s2")).toEqual([]); // not an action
});

test("approvals_use_own_files", async () => {
  const p = proj();
  const png = (n: string) => new File(["x"], n, { type: "image/png" });
  await useOwnFiles(p, { kind: "anim", char: "hero", anim: "walk" }, [png("walk_10.png"), png("walk_2.png")]);
  expect(p.kit.chars.hero.anims.walk).toEqual({ approved: true, source: "user", frames: ["chars/hero/walk/walk_2.png", "chars/hero/walk/walk_10.png"] });
  expect(p.files.has("chars/hero/walk/walk_10.png")).toBe(true);
  await useOwnFiles(p, { kind: "face", face: "hero", expr: "amazed" }, [png("Face.PNG")]);
  expect(p.kit.faces.hero.amazed).toEqual({ approved: true, source: "user", path: "faces/hero/amazed.png" });
  await useOwnFiles(p, { kind: "asset", id: "line1", asset: "voice" }, [new File(["a"], "take.ogg")]);
  expect(p.kit.assets.line1).toEqual({ approved: true, source: "user", kind: "voice", path: "audio/line1.ogg" });
  // the fx branch decodes the PNG (createImageBitmap), so it is left to the browser
});
