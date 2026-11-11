import { expect, test } from "vitest";
import { newProject, type Project } from "../src/core/project";
import { addStarter, coverScale, startingBg } from "../src/core/starter";

const pack = (): Project => {
  const p = newProject("pack");
  p.kit.chars.knight = { view: "side", anims: { idle: { approved: true, source: "user", frames: ["chars/knight/idle/0.png"] } } };
  p.kit.assets.dusk = { approved: true, source: "user", kind: "bg", path: "bg/dusk.png" };
  p.kit.assets.calm = { approved: true, source: "user", kind: "music", path: "audio/calm.ogg" };
  for (const f of ["chars/knight/idle/0.png", "bg/dusk.png", "audio/calm.ogg"]) p.files.set(f, new Blob([f]));
  p.tl = { name: "s", duration: 2, shots: [{ id: "s1", type: "wide", start: 0, end: 2, bg: "dusk", bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
    actors: [{ id: "k1", char: "knight", x: 50, y: 160, actions: [] }, { id: "k2", char: "knight", x: 90, y: 168, actions: [] }], fx: [], audio: [] };
  return p;
};

test("the starter pack adds its characters, background and music with their files", () => {
  const p = newProject("mine");
  expect(addStarter(p, pack())).toEqual(["knight", "dusk", "calm"]);
  expect(p.kit.chars.knight.anims.idle.frames).toEqual(["chars/knight/idle/0.png"]);
  expect(p.kit.assets.dusk.path).toBe("bg/dusk.png");
  expect([...p.files.keys()].sort()).toEqual(["audio/calm.ogg", "bg/dusk.png", "chars/knight/idle/0.png"]);
});

test("the starter pack never replaces what the project already has", () => {
  const p = newProject("mine");
  p.kit.chars.knight = { view: "side", anims: {} };
  p.files.set("bg/dusk.png", new Blob(["my own"]));
  expect(addStarter(p, pack())).toEqual(["calm"]); // dusk's file path is taken, so dusk is left out too
  expect(p.kit.chars.knight.anims).toEqual({});
  expect(addStarter(p, pack())).toEqual([]); // twice adds nothing
});

test("a new timeline starts on the kit's first background, scaled up to cover the scene", () => {
  const p = newProject("mine");
  p.canvas = { W: 480, H: 270, exportScale: 4 };
  expect(startingBg(p)).toBeNull(); // no background in the kit
  addStarter(p, pack());
  expect(startingBg(p)).toBe("dusk");
  expect(coverScale(p.canvas, { w: 320, h: 180 })).toBe(2);
  expect(coverScale(p.canvas, { w: 960, h: 540 })).toBe(1);
});

test("the starter background brings its feet line, learnt from where the sample's actors stand", () => {
  const p = newProject("mine");
  addStarter(p, pack());
  expect(p.kit.assets.dusk.ground).toBe(168);
});
