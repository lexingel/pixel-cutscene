import type { Project } from "./project";

// IndexedDB "pcs" v1: one record per project; `files` is the Map's entries (Blobs are structured-cloneable).
type Rec = { id: string; name: string; updated: number; meta: Omit<Project, "files">; files: [string, Blob][] };

const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open("pcs", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("projects", { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const t = db.transaction("projects", mode);
    const q = f(t.objectStore("projects"));
    t.oncomplete = () => (db.close(), res(q.result));
    t.onerror = t.onabort = () => (db.close(), rej(t.error));
  });
}

export async function saveProject(p: Project): Promise<void> {
  const { files, ...meta } = p;
  const rec: Rec = { id: p.id, name: p.name, updated: Date.now(), meta, files: [...files] };
  await tx("readwrite", (s) => s.put(rec));
}

export async function loadProject(id: string): Promise<Project | null> {
  const r = (await tx("readonly", (s) => s.get(id))) as Rec | undefined;
  return r ? { ...r.meta, cast: r.meta.cast ?? {}, files: new Map(r.files) } : null; // cast: projects saved before it existed
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
}
