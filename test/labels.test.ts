import { describe, expect, test } from "vitest";
import { actorName, labelOf, shotName } from "../src/core/labels";
import type { Kit } from "../src/core/kit";
import type { Timeline } from "../src/core/types";

const kit = {
  chars: {}, faces: {},
  assets: {
    "fire-breath": { approved: true, source: "pixelfx", ref: "fire/fire-breath", kind: "fx", path: "x" },
    "fire-breath_a30": { approved: true, source: "pixelfx", ref: "fire/fire-breath", kind: "fx", path: "y" },
    torch: { approved: true, source: "user", kind: "fx", path: "z" },
  },
} as unknown as Kit;
const tl = {
  name: "t", duration: 5,
  shots: [
    { id: "s1", type: "wide", start: 0, end: 2, bg_scale: 1, camera: [] },
    { id: "s9", type: "closeup", start: 2, end: 5, face: "ann", expr: "sad" },
  ],
  actors: [
    { id: "actor1", char: "dragon", x: 0, y: 0, actions: [{ id: "a7", t: 1, do: "anim:breathe" }] },
    { id: "hero1", char: "hero", x: 0, y: 0, actions: [] },
    { id: "hero2", char: "hero", x: 0, y: 0, actions: [{ id: "a8", t: 1, do: "dust" }] },
  ],
  fx: [{ id: "f1", t: 1, fx: "fire-breath_a30", x: 0, y: 0 }, { id: "f2", t: 1, fx: "torch", x: 0, y: 0 }],
  audio: [{ id: "sound1", t: 0, clip: "boom", kind: "sfx" }],
} as unknown as Timeline;

describe("labels", () => {
  test("actors_use_the_character_name_numbered_only_when_shared", () => {
    expect(actorName(tl, "actor1")).toBe("dragon");
    expect(actorName(tl, "hero1")).toBe("hero 1");
    expect(actorName(tl, "hero2")).toBe("hero 2");
  });
  test("shots_are_numbered_by_order", () => {
    expect(shotName(tl, "s1")).toBe("Shot 1 · wide");
    expect(shotName(tl, "s9")).toBe("Shot 2 · close-up ann");
  });
  test("labels_never_show_ids", () => {
    expect(labelOf(tl, kit, "a7")).toBe("dragon · Breathe fire");
    expect(labelOf(tl, kit, "a8")).toBe("hero 2 · Turn to dust");
    expect(labelOf(tl, kit, "f1")).toBe("fire breath"); // no _a30
    expect(labelOf(tl, kit, "f2")).toBe("torch");
    expect(labelOf(tl, kit, "s9")).toBe("Shot 2 · close-up ann");
    expect(labelOf(tl, kit, "actor1")).toBe("dragon");
    expect(labelOf(tl, kit, "sound1")).toBe("boom");
  });
});
