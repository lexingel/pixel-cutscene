import { readyChars } from "./kit";
import type { Project } from "./project";

// Pure cast data edits; the UI (src/ui/cast.ts) adds dialogs and toasts.
export const charDir = (name: string) => `chars/${name}/`;
export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const frameNum = (path: string) => Number(baseName(path).match(/(\d+)\.[^.]*$/)?.[1] ?? Infinity);

// Natural order by the trailing number of the file name; unnumbered files last, by name.
export const sortFrames = (paths: string[]) =>
  [...paths].sort((a, b) => frameNum(a) - frameNum(b) || (a < b ? -1 : a > b ? 1 : 0));

// A free path in `dir` for `file`: file.png, file_2.png, file_3.png, ...
export function freePath(p: Project, dir: string, file: string): string {
  const dot = file.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ""];
  let path = dir + file;
  for (let i = 2; p.files.has(path); i++) path = `${dir}${stem}_${i}${ext}`;
  return path;
}

// Files of a character that no animation lists (guessAnims' "?" bucket).
export function unassigned(p: Project, name: string): string[] {
  const used = new Set(Object.values(p.kit.chars[name]?.anims ?? {}).flatMap((a) => a.frames));
  return [...p.files.keys()].filter((k) => k.startsWith(charDir(name)) && !used.has(k));
}

export function dropChar(p: Project, name: string): void {
  delete p.kit.chars[name];
  p.files.delete(`refs/${name}.png`); // a generated character's reference (src/gen/pixellab.ts refPath)
  for (const k of [...p.files.keys()]) if (k.startsWith(charDir(name)) || k.startsWith(`orig/${charDir(name)}`)) p.files.delete(k); // orig/: frames from before Clean up
}

// Moves an unassigned file into `anim`, keeping frames in natural order and every path unique.
export function assignFrame(p: Project, name: string, path: string, anim: string): void {
  const blob = p.files.get(path);
  const c = p.kit.chars[name];
  if (!blob || !c || !unassigned(p, name).includes(path)) return;
  p.files.delete(path);
  const to = freePath(p, `${charDir(name)}${anim}/`, baseName(path));
  p.files.set(to, blob);
  const a = (c.anims[anim] ??= { approved: true, source: "user", frames: [] });
  a.frames = sortFrames([...a.frames, to]);
}

// Opening a zip whose id is already stored locally imports it as a copy, so a backup never replaces newer work.
export const importAs = (p: Project, localIds: string[]): Project =>
  localIds.includes(p.id) ? { ...p, id: crypto.randomUUID(), name: `${p.name} (copy)` } : p;

// Characters the scene asked for that cannot be used yet (no approved idle).
export const pendingChars = (p: Project): string[] => {
  const ready = readyChars(p.kit, (f) => p.files.has(f));
  return Object.keys(p.cast).filter((c) => !ready.includes(c));
};

// Merges a draft's cast: an edited look stays unless empty; anims follow the draft. Own keys only,
// so an id like "__proto__" or "constructor" never reaches Object.prototype.
export function mergeCast(p: Project, entries: { id: string; look: string; anims: string[] }[]): void {
  for (const c of entries) {
    if (c.id === "__proto__") continue;
    const had = Object.hasOwn(p.cast, c.id) ? p.cast[c.id] : undefined;
    p.cast[c.id] = { look: had?.look.trim() ? had.look : c.look, anims: c.anims };
  }
}
