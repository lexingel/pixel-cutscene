import { afterEach, expect, test, vi } from "vitest";
import { newProject } from "../src/core/project";
import { planAll } from "../src/ui/genAll";

afterEach(() => vi.unstubAllGlobals());
const keys = (k: object) => vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(k) });

function scene() {
  const p = newProject("t");
  p.files.set("chars/hero/idle/idle_0.png", new Blob([]));
  p.kit.chars.hero = { view: "side", anims: { idle: { approved: true, source: "user", frames: ["chars/hero/idle/idle_0.png"] } }, voice: "v1" };
  p.kit.chars.ghost = { view: "side", anims: {} }; // no reference: cannot be generated
  p.tl = {
    name: "t", duration: 8,
    shots: [{ id: "s1", type: "wide", start: 0, end: 8, bg: "cave", bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
    actors: [
      { id: "h1", char: "hero", x: 10, y: 10, actions: [{ id: "a1", t: 1, do: "walk", to: [50, 10], dur: 2 }, { id: "a2", t: 4, do: "anim:attack" }] },
      { id: "g1", char: "ghost", x: 90, y: 10, actions: [{ id: "a3", t: 1, do: "walk", to: [50, 10], dur: 2 }] },
    ],
    fx: [],
    audio: [
      { id: "vo1", t: 1, clip: "vo_hi", kind: "voice", line: "Stay close.", speaker: "hero" },
      { id: "sf1", t: 2, clip: "sfx_door", kind: "sfx", dur: 3 },
      { id: "mu1", t: 0, clip: "theme", kind: "music" },
    ],
  } as any;
  return p;
}

test("plan_counts_what_can_be_generated_and_its_cost", () => {
  keys({ pixellab: "k", elevenlabs: "e" });
  const plan = planAll(scene());
  // hero walk, hero attack, the cave backdrop; not ghost (no reference) nor music (library only)
  expect(plan.pixellab.map((j) => j.label).sort()).toEqual(["Generate background cave", "Generate hero attack", "Generate hero walk"]);
  expect(plan.gens).toEqual({ min: 3, max: 3 });
  expect(plan.eleven.map((j) => j.label).sort()).toEqual(["Generate sound sfx door", "Generate voice line vo hi"]);
  expect(plan.credits).toBe("Stay close.".length + 60);
  expect(plan.skipped).toBeGreaterThanOrEqual(2);
});

test("a_posed_character_costs_two_to_four_per_move", () => {
  keys({ pixellab: "k" });
  const p = scene();
  p.kit.chars.hero.pl = "c1";
  const plan = planAll(p);
  expect(plan.gens).toEqual({ min: 1 + 2 * 2, max: 1 + 2 * 4 });
  expect(plan.eleven).toEqual([]); // no ElevenLabs key
});
