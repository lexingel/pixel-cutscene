import { describe, expect, it } from "vitest";
import { moveLabel } from "../src/core/moves";
import { validateTimeline } from "../src/core/timeline";
import { setMove } from "../src/ui/timelineEditor";
import type { Timeline } from "../src/core/types";

const tl = (action: object): Timeline =>
  ({
    name: "t", duration: 5,
    shots: [{ id: "s1", type: "wide", start: 0, end: 5, bg: "", bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
    actors: [{ id: "h", char: "c", x: 100, y: 150, actions: [{ id: "a1", t: 0, do: "idle", ...action }] }],
    fx: [], audio: [],
  }) as any;

describe("moves", () => {
  it("labels", () => {
    const want: Record<string, string> = {
      idle: "Stand", walk: "Walk to…", move: "Move to…", look_around: "Look around", startle: "Startle",
      hurt: "Hurt", dust: "Turn to dust", "anim:attack": "Attack", "anim:breathe": "Breathe fire", "anim:x": "Play: x",
    };
    for (const k in want) expect(moveLabel(k)).toBe(want[k]);
  });
  it("idle_to_walk_gets_a_destination", () => {
    const r = setMove(tl({}), "a1", "walk", false);
    expect(r.error).toBeUndefined();
    const a = r.tl.actors[0].actions[0];
    expect(a.to).toEqual([164, 150]);
    expect(a.dur).toBe(1.5);
    expect(validateTimeline(r.tl)).toEqual([]);
  });
  it("facing_left_walks_left", () => {
    expect(setMove(tl({}), "a1", "walk", true).tl.actors[0].actions[0].to).toEqual([36, 150]);
  });
  it("keeps_an_existing_to", () => {
    const r = setMove(tl({ do: "walk", to: [10, 10], dur: 1 }), "a1", "move", false);
    expect(r.tl.actors[0].actions[0].to).toEqual([10, 10]);
  });
  it("hurt_and_dust_validate", () => {
    expect(validateTimeline(tl({ do: "hurt", t: 1 }))).toEqual([]);
    expect(validateTimeline(tl({ do: "dust", t: 1, dur: 1.5 }))).toEqual([]);
    expect(validateTimeline(tl({ do: "dust", t: 1 }))).toContain("a1.dur: dust needs a duration");
  });
});
