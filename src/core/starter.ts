import type { Project } from "./project";

// The starter pack: the sample's characters, background, effect and music, so a new project is not an empty black
// stage. Pieces whose name or file the project already uses are left out; nothing of the user's is replaced.
export function addStarter(p: Project, pack: Project): string[] {
  const added: string[] = [];
  const free = (paths: string[]) => paths.every((f) => pack.files.has(f) && !p.files.has(f));
  const take = (paths: string[]) => paths.forEach((f) => p.files.set(f, pack.files.get(f)!));
  for (const [name, c] of Object.entries(pack.kit.chars)) {
    const paths = Object.values(c.anims).flatMap((a) => a.frames);
    if (p.kit.chars[name] || !free(paths)) continue;
    take(paths);
    p.kit.chars[name] = structuredClone(c);
    added.push(name);
  }
  for (const [id, a] of Object.entries(pack.kit.assets)) {
    if (p.kit.assets[id] || !free([a.path])) continue;
    take([a.path]);
    const copy = (p.kit.assets[id] = structuredClone(a));
    // a background's feet line: the lowest feet the pack's own timeline puts on a shot using it, in the image's pixels
    const shot = pack.tl?.shots.find((s) => s.type === "wide" && s.bg === id);
    const feet = shot?.type === "wide" ? Math.max(...(pack.tl?.actors.map((x) => x.y) ?? [])) : -Infinity;
    if (a.kind === "bg" && shot?.type === "wide" && feet > 0) copy.ground ??= Math.round(feet / shot.bg_scale);
    added.push(id);
  }
  return added;
}

/** The kit's first approved wide background: what a new timeline's first shot starts on. */
export const startingBg = (p: Project): string | null =>
  Object.entries(p.kit.assets).find(([, a]) => a.kind === "bg" && a.approved && p.files.has(a.path))?.[0] ?? null;

/** The whole-number scale at which a background covers the scene. */
export const coverScale = (c: { W: number; H: number }, img: { w: number; h: number }) => Math.max(1, Math.ceil(Math.max(c.W / img.w, c.H / img.h)));
