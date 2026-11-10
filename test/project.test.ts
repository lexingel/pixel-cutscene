import "fake-indexeddb/auto";
// @ts-ignore node types are not part of the browser build
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
// @ts-ignore node types are not part of the browser build
import { tmpdir } from "node:os";
// @ts-ignore node types are not part of the browser build
import { join } from "node:path";
// @ts-ignore node types are not part of the browser build
import { spawnSync } from "node:child_process";
import { expect, test, vi } from "vitest";
import { fromZip, newProject, toZip, type Project } from "../src/core/project";
import { missingReport } from "../src/core/missing";
import { parseTimeline } from "../src/core/timeline";
import miniText from "./fixtures/mini.json?raw";

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const sample = (): Project => {
  const p = newProject("demo");
  p.step = 3;
  p.tl = parseTimeline(miniText).data;
  p.kit.faces.w = { neutral: { approved: true, source: "user", path: "faces/w/neutral.png" } };
  p.files.set("faces/w/neutral.png", new Blob([new Uint8Array([1, 2, 3, 255, 0])]));
  p.files.set("assets/a.ogg", new Blob([new Uint8Array([9, 8, 7])]));
  return p;
};

test("zip_roundtrip", async () => {
  const p = sample();
  const q = await fromZip(await toZip(p));
  expect([...q.files.keys()].sort()).toEqual([...p.files.keys()].sort());
  for (const [k, b] of p.files) expect(await bytes(q.files.get(k)!)).toEqual(await bytes(b));
  const { files: _a, ...a } = p;
  const { files: _b, ...b } = q;
  expect(b).toEqual(a);
  expect(p.canvas).toEqual({ W: 960, H: 540, exportScale: 2 });
});

test("zip_missing_manifest_message", async () => {
  const { zipSync } = await import("fflate");
  const noManifest = new Blob([zipSync({ "files/x.png": new Uint8Array([1]) })]);
  await expect(fromZip(noManifest)).rejects.toThrow(/project\.json/);
  const bad = new Blob([zipSync({ "project.json": new TextEncoder().encode("{nope") })]);
  await expect(fromZip(bad)).rejects.toThrow(/project\.json/);
  await expect(fromZip(new Blob([new Uint8Array([1, 2, 3])]))).rejects.toThrow(/zip/i);
});

test("reload_restores", async () => {
  const p = sample();
  p.kit.faces.w.neutral.approved = false;
  await (await import("../src/core/store")).saveProject(p);
  vi.resetModules();
  const s2 = await import("../src/core/store"); // a fresh store instance, as after a page reload
  const q = (await s2.loadProject(p.id))!;
  expect(q.step).toBe(3);
  expect(q.tl).toEqual(p.tl);
  expect(q.kit.faces.w.neutral.approved).toBe(false);
  expect(q.files.size).toBe(2);
  expect(await bytes(q.files.get("assets/a.ogg")!)).toEqual(new Uint8Array([9, 8, 7]));
  expect((await s2.listProjects()).map((x) => x.id)).toContain(p.id);
  await s2.deleteProject(p.id);
  expect(await s2.loadProject(p.id)).toBeNull();
});

const hasKit = existsSync("../kit_assets") && existsSync("D:/Claude/godot-guilds-system/assets/heroes/body_anim");
test.skipIf(!hasKit)("converter_rift", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "pcs-")), "rift.zip");
  const r = spawnSync("node", ["../tools/kit_to_zip.mjs", "../kits/guildhold.json", "../scenes/rift.json", out], { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  const p = await fromZip(new Blob([readFileSync(out)]));
  expect(missingReport(p.tl!, p.kit, false, (f: string) => p.files.has(f))).toEqual([]);
  // Godot fx offset is added to a top-left sprite; the web pivot is subtracted
  expect(p.kit.assets.portal_drowned.fx).toMatchObject({ cols: 10, frames: 72, fps: 30, loop: true, dx: 100, dy: 200 });
  expect(p.kit.assets.vo_nyxara_intro.kind).toBe("voice");
}, 60000);

test("old_project_zip_defaults_cast", async () => {
  const { zipSync } = await import("fflate");
  const { files: _f, cast: _c, ...meta } = sample();
  const q = await fromZip(new Blob([zipSync({ "project.json": new TextEncoder().encode(JSON.stringify(meta)) })]));
  expect(q.cast).toEqual({});
  expect(q.step).toBe(3);
  expect(newProject("n").step).toBe(2);
});

test("zip_bad_cast_becomes_empty", async () => {
  const { zipSync } = await import("fflate");
  const { files: _f, ...meta } = sample();
  for (const cast of [null, [1], "x", 3]) {
    const q = await fromZip(new Blob([zipSync({ "project.json": new TextEncoder().encode(JSON.stringify({ ...meta, cast })) })]));
    expect(q.cast).toEqual({});
  }
  const ok = await fromZip(new Blob([zipSync({ "project.json": new TextEncoder().encode(JSON.stringify({ ...meta, cast: { a: { look: "l", anims: [] } } })) })]));
  expect(ok.cast).toEqual({ a: { look: "l", anims: [] } });
});

test("the sample zip opens with nothing missing and stays small", async () => {
  const bytes = readFileSync("public/sample/sample.zip");
  expect(bytes.length).toBeLessThan(1.5 * 1024 * 1024);
  const p = await fromZip(new Blob([bytes]));
  expect(missingReport(p.tl!, p.kit, false, (k) => p.files.has(k))).toEqual([]);
});
