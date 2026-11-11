import { unzip, zip } from "fflate";
import type { Kit, SizeName } from "./kit";

const SIZES: SizeName[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
import type { Timeline } from "./types";

export type CastNeed = { look: string; anims: string[] };

export type Project = {
  id: string;
  name: string;
  step: 1 | 2 | 3 | 4; // 1 Cast, 2 Scene, 3 Tweak, 4 Export (stored numbers; the bar shows Scene first)
  description: string;
  beats?: string; // the planned beat list (two-step draft), as the user left it
  tl: Timeline | null;
  kit: Kit;
  cast: Record<string, CastNeed>; // characters the scene asked for (old projects: {})
  files: Map<string, Blob>;
  canvas: { W: number; H: number; exportScale: number };
  lockedRows?: string[]; // timeline rows (actor ids, "fx", "audio") whose bars don't move or delete
};

/** Scene sizes, each a whole-number scale of 1920x1080: smaller = chunkier pixels and bigger characters. */
export const CANVAS_SIZES = [
  { W: 320, H: 180, exportScale: 6 },
  { W: 480, H: 270, exportScale: 4 },
  { W: 640, H: 360, exportScale: 3 },
  { W: 960, H: 540, exportScale: 2 },
] as const;

/** Sets the scene size; only while nobody is placed yet (positions are scene pixels). Returns whether it changed. */
export function setCanvas(p: Project, c: Project["canvas"]): boolean {
  if (p.tl?.actors.length || p.tl?.fx.length) return false;
  p.canvas = { W: c.W, H: c.H, exportScale: c.exportScale };
  return true;
}

export const newProject = (name: string): Project => ({
  id: crypto.randomUUID(),
  name,
  step: 2,
  description: "",
  tl: null,
  kit: { chars: {}, faces: {}, assets: {} },
  cast: {},
  files: new Map(),
  canvas: { ...CANVAS_SIZES[1] },
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
  for (const [name, c] of Object.entries(m.kit.chars ?? {})) {
    if (c.scale !== undefined && c.scale !== 2) throw new Error(`Character ${name} has scale ${JSON.stringify(c.scale)}; only 2 is supported.`);
    if (c.size !== undefined && !SIZES.includes(c.size)) throw new Error(`Character ${name} has size ${JSON.stringify(c.size)}; use ${SIZES.join(", ")}.`);
  }
  const files = new Map<string, Blob>();
  for (const [k, v] of Object.entries(entries)) if (k.startsWith("files/") && !k.endsWith("/")) files.set(k.slice(6), new Blob([v]));
  const cast = m.cast && typeof m.cast === "object" && !Array.isArray(m.cast) ? m.cast : {};
  return { description: "", tl: null, step: 1, ...m, cast, files } as Project;
}
