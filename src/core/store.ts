import type { Project } from "./project";

// IndexedDB "pcs": one record per project; `files` is the Map's entries (Blobs are structured-cloneable).
// v2 adds "snaps": whole copies of a project (versions), indexed by project id, and "meta" for small settings.
type Rec = { id: string; name: string; updated: number; meta: Omit<Project, "files">; files: [string, Blob][] };
type SnapRec = { key?: number; pid: string; kind: "auto" | "manual"; at: number; label: string; rec: Rec };
export type Snap = { key: number; pid: string; kind: "auto" | "manual"; at: number; label: string; name: string };

/** Autosave keeps a version at most this often, and only the newest AUTO_KEEP of them; named versions stay. */
export const AUTO_EVERY = 5 * 60_000;
export const AUTO_KEEP = 5;

const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open("pcs", 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("snaps")) db.createObjectStore("snaps", { keyPath: "key", autoIncrement: true }).createIndex("pid", "pid");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>, store = "projects"): Promise<T> {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const t = db.transaction(store, mode);
    const q = f(t.objectStore(store));
    t.oncomplete = () => (db.close(), res(q.result));
    t.onerror = t.onabort = () => (db.close(), rej(t.error));
  });
}

const toRec = (p: Project, at = Date.now()): Rec => {
  const { files, ...meta } = p;
  return { id: p.id, name: p.name, updated: at, meta: structuredClone(meta), files: [...files] };
};
const fromRec = (r: Rec): Project => ({ ...r.meta, cast: r.meta.cast ?? {}, files: new Map(r.files) }); // cast: projects saved before it existed

export async function saveProject(p: Project): Promise<void> {
  await tx("readwrite", (s) => s.put(toRec(p)));
}

export async function loadProject(id: string): Promise<Project | null> {
  const r = (await tx("readonly", (s) => s.get(id))) as Rec | undefined;
  return r ? fromRec(r) : null;
}

/** `thumb` is the first shot's background, for the Home card. */
export async function listProjects(): Promise<{ id: string; name: string; updated: number; thumb?: Blob }[]> {
  const all = (await tx("readonly", (s) => s.getAll())) as Rec[];
  return all
    .map(({ id, name, updated, meta, files }) => {
      const bg = meta.tl?.shots[0]?.bg; // an asset id, or (older zips) the file path itself
      const path = bg && (meta.kit?.assets?.[bg]?.path ?? bg);
      return { id, name, updated, thumb: path ? files.find(([k]) => k === path)?.[1] : undefined };
    })
    .sort((a, b) => b.updated - a.updated);
}

export async function deleteProject(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
  for (const v of await listSnapshots(id)) await deleteSnapshot(v.key);
}

// ---- versions

const snapsOf = async (pid: string) => ((await tx("readonly", (s) => s.index("pid").getAll(pid), "snaps")) as Required<SnapRec>[]).sort((a, b) => b.at - a.at || b.key - a.key);

/** Stores a whole copy of the project as it is now. */
export async function snapshot(p: Project, kind: SnapRec["kind"], label = "", at = Date.now()): Promise<void> {
  const rec: SnapRec = { pid: p.id, kind, at, label, rec: toRec(p, at) };
  await tx("readwrite", (s) => s.add(rec), "snaps");
}

/** Called on autosave: a version when the last automatic one is AUTO_EVERY old, then only the newest AUTO_KEEP stay. */
export async function autoSnapshot(p: Project, at = Date.now()): Promise<boolean> {
  const autos = (await snapsOf(p.id)).filter((v) => v.kind === "auto");
  if (autos.length && at - autos[0].at < AUTO_EVERY) return false;
  await snapshot(p, "auto", "", at);
  for (const old of autos.slice(AUTO_KEEP - 1)) await deleteSnapshot(old.key);
  return true;
}

/** Newest first. */
export async function listSnapshots(pid: string): Promise<Snap[]> {
  return (await snapsOf(pid)).map(({ key, pid, kind, at, label, rec }) => ({ key, pid, kind, at, label, name: rec.name }));
}

export async function loadSnapshot(key: number): Promise<Project | null> {
  const v = (await tx("readonly", (s) => s.get(key), "snaps")) as SnapRec | undefined;
  return v ? fromRec(v.rec) : null;
}

export async function deleteSnapshot(key: number): Promise<void> {
  await tx("readwrite", (s) => s.delete(key), "snaps");
}

/** Small values that are not part of a project (the backup folder's handle). */
export const getMeta = async <T>(k: string) => (await tx("readonly", (s) => s.get(k), "meta")) as T | undefined;
export async function setMeta(k: string, v: unknown): Promise<void> {
  if (v === undefined) await tx("readwrite", (s) => s.delete(k), "meta");
  else await tx("readwrite", (s) => s.put(v, k), "meta");
}
