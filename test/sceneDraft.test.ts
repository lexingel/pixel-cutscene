import { expect, test } from "vitest";
import { buildScenePrompt, EXAMPLE } from "../src/ai/scenePrompt";
import { draftScene, extractJson } from "../src/ai/sceneDraft";
import { validateTimeline } from "../src/core/timeline";
import type { Kit } from "../src/core/kit";
import type { PaidTicket } from "../src/ai/confirm";
import type { Timeline } from "../src/core/types";

const ai = { provider: "anthropic", model: "m", key: "k" } as const;
const keys = { ai };
const ticket = {} as PaidTicket;
const canvas = { W: 960, H: 540 };
const piece = { approved: true, source: "user" as const };
const kit: Kit = {
  chars: { hero: { view: "side", anims: { idle: { ...piece, frames: ["a"] }, walk: { ...piece, frames: ["b"] } } }, ghost: { view: "side", anims: { idle: { ...piece, frames: ["c"] } } } },
  faces: { hero: { neutral: { ...piece, path: "f" } }, ghost: { neutral: { approved: false, source: "pixellab", path: "g" } } },
  assets: {
    cave: { ...piece, kind: "bg", path: "p" },
    boom: { ...piece, kind: "fx", path: "p" },
    theme: { ...piece, kind: "music", path: "p" },
    hit: { ...piece, kind: "sfx", path: "p" },
  },
};
const good = (): Timeline => ({
  name: "t", duration: 10, shots: [{ id: "s1", type: "wide", start: 0, end: 10, bg_scale: 2, camera: [{ t: 0, x: 0, y: 0 }] }], actors: [], fx: [], audio: [],
});
const stub = (...replies: string[]) => {
  const calls: string[] = [];
  const fn = async (_ai: unknown, _s: string, u: string) => (calls.push(u), replies[calls.length - 1] ?? replies.at(-1)!);
  return { fn: fn as never, calls };
};

test("example_is_valid", () => expect(validateTimeline(EXAMPLE)).toEqual([]));

test("prose_wrapped_json_extracted", async () => {
  expect(extractJson('Sure!\n```json\n{"a":{"b":1}}\n```\nEnjoy')).toEqual({ a: { b: 1 } });
  expect(extractJson("no json")).toBeNull();
  const s = stub("Here you go: " + JSON.stringify(good()) + " hope it helps");
  const r = await draftScene(keys, kit, canvas, "a cave", null, ticket, s.fn);
  expect(r.ok).toBe(true);
});

test("broken_then_repaired", async () => {
  const s = stub("{not json", JSON.stringify(good()));
  const r = await draftScene(keys, kit, canvas, "a cave", null, ticket, s.fn);
  expect(r.ok).toBe(true);
  expect(s.calls.length).toBe(2);
});

test("still_invalid_after_repair_keeps_current", async () => {
  const cur = good();
  const snap = structuredClone(cur);
  const bad = { ...good(), duration: 0 };
  const s = stub(JSON.stringify(bad));
  const r = await draftScene(keys, kit, canvas, "a cave", cur, ticket, s.fn);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain("duration");
  expect(s.calls.length).toBe(2);
  expect(cur).toEqual(snap);
});

test("locked_survives_redraft", async () => {
  const cur = good();
  cur.fx.push({ id: "keep", t: 1, fx: "boom", x: 1, y: 2, locked: true });
  const r = await draftScene(keys, kit, canvas, "a cave", cur, ticket, stub(JSON.stringify(good())).fn);
  expect(r.ok && r.tl.fx.map((f) => f.id)).toEqual(["keep"]);
});

test("prompt_lists_faceless_char_as_no_closeups", () => {
  const { system, user } = buildScenePrompt(kit, canvas, "a cave", null);
  expect(system).toMatch(/ghost[^\n]*no close-ups/);
  expect(system).not.toMatch(/hero[^\n]*no close-ups/);
  expect(system).toContain("theme");
  expect(system).toContain("960");
  expect(system).toContain("Return only JSON.");
  expect(user).toContain("a cave");
});

test("prompt_lists_unready_chars", () => {
  const k: Kit = structuredClone(kit);
  k.chars.wolf = { view: "side", anims: { idle: { approved: false, source: "pixellab", frames: ["w"] } } };
  const { system } = buildScenePrompt(k, canvas, "a cave", null);
  expect(system).toMatch(/not ready yet[^\n]*wolf/);
  expect(system).not.toMatch(/- wolf: animations/);
});

test("prompt_asks_for_cast", () => {
  const { system } = buildScenePrompt(kit, canvas, "a cave", null);
  expect(system).toContain('"timeline"');
  expect(system).toContain('"cast"');
  expect(system).toMatch(/"look"/);
  expect(system).toMatch(/"anims"/);
  expect(system).toContain("Prefer the kit's own ids where they fit.");
});

const wrapped = (cast: unknown) => JSON.stringify({ timeline: good(), cast });

test("draft_returns_cast", async () => {
  const r = await draftScene(keys, kit, canvas, "a cave", null, ticket, stub(wrapped([{ id: "ghost", look: "a pale ghost in rags", anims: ["float"] }])).fn);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.tl).toEqual(good());
    expect(r.cast).toEqual([{ id: "ghost", look: "a pale ghost in rags", anims: ["float"] }]);
  }
});

test("draft_accepts_bare_timeline", async () => {
  const r = await draftScene(keys, kit, canvas, "a cave", null, ticket, stub(JSON.stringify(good())).fn);
  expect(r.ok && r.cast).toEqual([]);
});

test("draft_drops_bad_cast_entries", async () => {
  const cast = ["x", null, { id: "Bad Id", look: "a" }, { look: "no id" }, { id: "wolf", look: 5, anims: ["walk", 3, "idle"] }, { id: "ghost", look: "pale" }];
  const r = await draftScene(keys, kit, canvas, "a cave", null, ticket, stub(wrapped(cast)).fn);
  expect(r.ok && r.cast).toEqual([{ id: "wolf", look: "", anims: ["walk"] }, { id: "ghost", look: "pale", anims: [] }]);
  const r2 = await draftScene(keys, kit, canvas, "a cave", null, ticket, stub(wrapped("nope")).fn);
  expect(r2.ok && r2.cast).toEqual([]);
});

test("draft_drops_prototype_cast_ids", async () => {
  const cast = ["__proto__", "constructor", "prototype", "ghost"].map((id) => ({ id, look: "x", anims: [] }));
  const r = await draftScene(keys, kit, canvas, "a cave", null, ticket, stub(wrapped(cast)).fn);
  expect(r.ok && r.cast.map((c) => c.id)).toEqual(["ghost"]);
});

test("draft_fills_missing_lists", async () => {
  const bare = { name: "t", duration: 10, shots: good().shots, actors: [{ id: "h1", char: "hero", x: 10, y: 10 }] };
  const r = await draftScene(keys, kit, canvas, "a cave", null, ticket, stub(JSON.stringify(bare)).fn);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.tl.fx).toEqual([]);
  expect(r.tl.audio).toEqual([]);
  expect(r.tl.actors[0].actions).toEqual([]);
});

test("redraft_invalid_after_keepLocked_keeps_current", async () => {
  // a locked middle shot plus one fresh full-length shot leaves the end uncovered
  const current: Timeline = {
    ...good(),
    shots: [
      { id: "s1", type: "wide", start: 0, end: 4, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] },
      { id: "s2", type: "wide", start: 4, end: 6, bg_scale: 1, camera: [{ t: 4, x: 0, y: 0 }], locked: true },
      { id: "s3", type: "wide", start: 6, end: 10, bg_scale: 1, camera: [{ t: 6, x: 0, y: 0 }] },
    ],
  } as Timeline;
  const before = JSON.stringify(current);
  const r = await draftScene(keys, kit, canvas, "a cave", current, ticket, stub(JSON.stringify(good())).fn);
  if (r.ok) expect(validateTimeline(r.tl)).toEqual([]);
  else expect(r.error).toMatch(/locked/i);
  expect(JSON.stringify(current)).toBe(before);
});
