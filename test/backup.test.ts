import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import { newProject } from "../src/core/project";
import { AUTO_EVERY, AUTO_KEEP, autoSnapshot, deleteProject, listSnapshots, loadProject, loadSnapshot, saveProject, snapshot } from "../src/core/store";

const MIN = 60_000;

test("autosave makes a version at most every 5 minutes and keeps the newest 5", async () => {
  expect(AUTO_EVERY).toBe(5 * MIN);
  expect(AUTO_KEEP).toBe(5);
  const p = newProject("auto");
  await saveProject(p);
  const t0 = 1_000_000;
  expect(await autoSnapshot(p, t0)).toBe(true);
  expect(await autoSnapshot(p, t0 + 4 * MIN)).toBe(false); // too soon
  for (let i = 1; i <= 6; i++) {
    p.name = `auto ${i}`;
    expect(await autoSnapshot(p, t0 + i * 5 * MIN)).toBe(true);
  }
  const s = await listSnapshots(p.id);
  expect(s.map((x) => x.name)).toEqual(["auto 6", "auto 5", "auto 4", "auto 3", "auto 2"]); // newest first, oldest dropped
  expect(s.every((x) => x.kind === "auto")).toBe(true);
});

test("a named version is never pruned, and restoring brings the old state back", async () => {
  const p = newProject("named");
  p.description = "first draft";
  p.files.set("bg/a.png", new Blob([new Uint8Array([1, 2, 3])]));
  await saveProject(p);
  await snapshot(p, "manual", "Before the dragon", 10);
  p.description = "changed";
  p.files.delete("bg/a.png");
  for (let i = 1; i <= 7; i++) await autoSnapshot(p, 10 + i * AUTO_EVERY);
  const s = await listSnapshots(p.id);
  expect(s.filter((x) => x.kind === "auto")).toHaveLength(5);
  const named = s.find((x) => x.kind === "manual")!;
  expect(named.label).toBe("Before the dragon");
  const old = (await loadSnapshot(named.key))!;
  expect(old.id).toBe(p.id);
  expect(old.description).toBe("first draft");
  expect(new Uint8Array(await old.files.get("bg/a.png")!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
});

test("deleting a project deletes its versions, not another project's", async () => {
  const a = newProject("a"), b = newProject("b");
  await saveProject(a);
  await saveProject(b);
  await snapshot(a, "manual", "keep?", 1);
  await snapshot(b, "manual", "keep!", 1);
  await deleteProject(a.id);
  expect(await listSnapshots(a.id)).toEqual([]);
  expect(await listSnapshots(b.id)).toHaveLength(1);
});

test("a database from before versions existed opens with its projects intact", async () => {
  vi.resetModules();
  indexedDB.deleteDatabase("pcs");
  await new Promise<void>((res, rej) => {
    const r = indexedDB.open("pcs", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("projects", { keyPath: "id" });
    r.onsuccess = () => {
      const p = newProject("old one");
      const { files: _f, ...meta } = p;
      const t = r.result.transaction("projects", "readwrite");
      t.objectStore("projects").put({ id: "old", name: "old one", updated: 1, meta: { ...meta, id: "old" }, files: [] });
      t.oncomplete = () => (r.result.close(), res());
      t.onerror = () => rej(t.error);
    };
  });
  const s = await import("../src/core/store");
  expect((await s.loadProject("old"))?.name).toBe("old one");
  const q = (await s.loadProject("old"))!;
  await s.snapshot(q, "manual", "first", 1);
  expect(await s.listSnapshots("old")).toHaveLength(1);
  expect(loadProject).toBeTypeOf("function");
});

test("the backup zip name is safe for any file system and unique per project", async () => {
  const { backupName } = await import("../src/core/folderBackup");
  expect(backupName({ id: "abcdef1234567", name: 'Dragon: "act 1" / take 2?' })).toBe("Dragon_ _act 1_ _ take 2_-abcdef12.zip");
  expect(backupName({ id: "12345678x", name: "  " })).toBe("cutscene-12345678.zip");
});
