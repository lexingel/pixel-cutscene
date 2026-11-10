import { unzip, zip } from "fflate";
import type { Kit } from "./kit";
import type { Timeline } from "./types";

export type CastNeed = { look: string; anims: string[] };

export type Project = {
  id: string;
  name: string;
  step: 1 | 2 | 3 | 4; // 1 Cast, 2 Scene, 3 Tweak, 4 Export (stored numbers; the bar shows Scene first)
  description: string;
  tl: Timeline | null;
  kit: Kit;
  cast: Record<string, CastNeed>; // characters the scene asked for (old projects: {})
  files: Map<string, Blob>;
  canvas: { W: number; H: number; exportScale: number };
};

export const newProject = (name: string): Project => ({
  id: crypto.randomUUID(),
  name,
  step: 2,
  description: "",
  tl: null,
  kit: { chars: {}, faces: {}, assets: {} },
  cast: {},
  files: new Map(),
  canvas: { W: 960, H: 540, exportScale: 2 },
});

const pack = (d: Record<string, Uint8Array>) =>
  new Promise<Uint8Array>((res, rej) => zip(d, { level: 6 }, (e, o) => (e ? rej(e) : res(o))));
const unpack = (d: Uint8Array) =>
  new Promise<Record<string, Uint8Array>>((res, rej) => unzip(d, (e, o) => (e ? rej(e) : res(o))));

// project.json = everything except `files`; each file lives at files/<path>.
export async function toZip(p: Project): Promise<Blob> {
  const { files, ...meta } = p;
  const entries: Record<string, Uint8Array> = { "project.json": new TextEncoder().encode(JSON.stringify(meta, null, 1)) };
  for (const [path, blob] of files) entries["files/" + path] = new Uint8Array(await blob.arrayBuffer());
  return new Blob([await pack(entries)], { type: "application/zip" });
}

export async function fromZip(blob: Blob): Promise<Project> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = await unpack(new Uint8Array(await blob.arrayBuffer()));
  } catch {
    throw new Error("This is not a valid zip file.");
  }
  const raw = entries["project.json"];
  if (!raw) throw new Error("This zip has no project.json, so it is not a Pixel Cutscene project.");
  let m: Partial<Project>;
  try {
    m = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error("project.json in this zip is not valid JSON.");
  }
  if (!m || typeof m !== "object" || !m.id || !m.name || !m.kit || !m.canvas)
    throw new Error("project.json is missing required fields (id, name, kit, canvas).");
  const files = new Map<string, Blob>();
  for (const [k, v] of Object.entries(entries)) if (k.startsWith("files/") && !k.endsWith("/")) files.set(k.slice(6), new Blob([v]));
  const cast = m.cast && typeof m.cast === "object" && !Array.isArray(m.cast) ? m.cast : {};
  return { description: "", tl: null, step: 1, ...m, cast, files } as Project;
}
