import { expect, test } from "vitest";
import { sceneNotes } from "../src/core/pacing";
import type { Timeline } from "../src/core/types";

const tl = (): Timeline => ({
  name: "t", duration: 12,
  shots: [{ id: "s1", type: "wide", start: 0, end: 12, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
  actors: [{ id: "h1", char: "hero", x: 10, y: 100, actions: [{ id: "a1", t: 1, do: "walk", to: [50, 100], dur: 2 }] }],
  fx: [], audio: [],
});

test("a_long_stretch_where_nothing_moves_is_noted", () => {
  const n = sceneNotes(tl());
  expect(n).toEqual([{ kind: "still", id: "h1", at: 3, msg: "Nothing moves from 3.0 s to 12.0 s." }]);
});

test("fx_camera_moves_and_lines_fill_the_gap", () => {
  const t = tl();
  t.fx.push({ id: "f1", t: 5, fx: "x", x: 0, y: 0, dur: 2 });
  (t.shots[0] as any).camera.push({ t: 7, x: 0, y: 0 }, { t: 10, x: 40, y: 0 });
  t.audio.push({ id: "m", t: 0, clip: "music", kind: "music" } as any); // music alone is not movement
  expect(sceneNotes(t)).toEqual([]); // 3-5 and 10-12 are short
  expect(sceneNotes({ ...t, actors: [] })).toEqual([]); // an empty scene has nothing to critique
});

test("a_long_shot_and_dialogue_without_a_close_up", () => {
  const t = tl();
  t.duration = 25;
  t.shots[0].end = 25;
  t.actors[0].actions.push({ id: "a2", t: 3, do: "say", text: "Hello", dur: 22 } as any);
  const n = sceneNotes(t);
  expect(n).toContainEqual({ kind: "long", id: "s1", at: 12.5, msg: "Shot 1 runs 25 s without a cut." });
  expect(n).toContainEqual({ kind: "talk", id: "h1", at: 3, msg: "There is dialogue but no close-up." });
  (t.shots[0] as any).zoom = { from: 3, to: 3, x: 0, y: 0, actor: "h1" };
  expect(sceneNotes(t).some((x) => x.kind === "talk")).toBe(false); // a zoom on the speaker is a close-up
});

test("speech_counts_for_as_long_as_it_reads", () => {
  const t = tl();
  const long = "A long line of words that takes a good while to read out loud here.";
  t.actors[0].actions.push({ id: "s", t: 3, do: "say", text: long } as any);
  t.audio.push({ id: "v", t: 8.5, clip: "c", kind: "voice", line: long } as any); // counted as 1 s, 3 s would show 4-8.5 still
  expect(sceneNotes(t).filter((n) => n.kind === "still")).toEqual([]);
});
