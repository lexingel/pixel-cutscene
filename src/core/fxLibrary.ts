import { bakeFx, renderFxFrames } from "./fxBake";
import { freePath } from "./cast";
import type { Img } from "./kit";
import type { Project } from "./project";
import type { Timeline } from "./types";
import { setField, type EditResult } from "../ui/timelineEditor";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FxModule = { meta: any; [k: string]: any };

// Lazy: each effect is its own chunk, loaded only when baked or previewed.
const MODULES = import.meta.glob("../../vendor/pixelfx/src/fx/*/*.js") as Record<string, () => Promise<FxModule>>;

const parts = (path: string) => {
  const m = /\/fx\/([^/]+)\/([^/]+)\.js$/.exec(path)!;
  return { category: m[1], file: m[2], id: `${m[1]}/${m[2]}` };
};

const SKIP = new Set(["categories", "index"]);
const byId = new Map<string, () => Promise<FxModule>>();
export const FX_LIST: { id: string; category: string; name: string }[] = [];
for (const [path, load] of Object.entries(MODULES)) {
  const { category, file, id } = parts(path);
  if (file.startsWith("_") || SKIP.has(file)) continue;
  byId.set(id, load);
  FX_LIST.push({ id, category, name: file.replace(/-/g, " ") });
}

const cache = new Map<string, Promise<FxModule>>();
export function loadFx(id: string): Promise<FxModule> {
  const load = byId.get(id);
  if (!load) return Promise.reject(new Error(`No library effect ${id}`));
  if (!cache.has(id)) cache.set(id, load().catch((e) => (cache.delete(id), Promise.reject(e))));
  return cache.get(id)!;
}

const defaultEncode = async (img: Img): Promise<Blob> => (await import("../ui/cast")).encode(img);

const assetIdOf = (id: string, angle?: number, reach = 1) => {
  const a = Math.round(angle ?? 0), r = Math.round(reach * 10);
  return id.split("/")[1] + (a ? `_a${a}` : "") + (r > 10 ? `_r${r}` : "");
};

/** Reach steps a library effect takes (its options list `reach`): 1 = as drawn, up to 4x as far. */
export const REACH_MAX = 4;
export const clampReach = (r: number) => Math.min(REACH_MAX, Math.max(1, Math.round(r * 2) / 2));
export const takesReach = (mod: FxModule) => "reach" in (mod.meta.options ?? {});

/** The effect's module with its cell grown to hold a longer reach (it reaches along +x from its origin). */
function reached(mod: FxModule, reach: number): FxModule {
  if (reach <= 1 || !takesReach(mod)) return mod;
  const [w, h] = mod.meta.size as [number, number], ox = (mod.meta.origin as [number, number])[0];
  return { ...mod, meta: { ...mod.meta, size: [Math.round(ox + (w - ox) * reach), h] } };
}

/** How far an effect reaches as drawn, in px from its origin. */
export const naturalReach = (mod: FxModule) => (mod.meta.size as [number, number])[0] - (mod.meta.origin as [number, number])[0];

/**
 * Bakes a library effect (aimed `angle` whole degrees, 0 = as drawn; `reach` x as far, for effects that take it)
 * into an approved fx asset; returns its id.
 */
export async function addLibraryFx(p: Project, id: string, angle?: number, encode = defaultEncode, reach = 1): Promise<string> {
  const mod0 = await loadFx(id);
  reach = takesReach(mod0) ? clampReach(reach) : 1;
  // reuse only this library effect at this angle and reach; a user asset that happens to share the short name is left alone
  let assetId = assetIdOf(id, angle, reach);
  for (let a = p.kit.assets[assetId]; a; a = p.kit.assets[assetId]) {
    if (a.source === "pixelfx" && a.ref === id) return assetId;
    assetId += "_";
  }
  const mod = reached(mod0, reach);
  const a = Math.round(angle ?? 0);
  const b = bakeFx(mod, { ...(a ? { angle: (a * Math.PI) / 180 } : {}), ...(reach > 1 ? { reach } : {}) }, 30);
  const path = freePath(p, "fx/", `${assetId}.png`);
  p.files.set(path, await encode(b.sheet));
  p.kit.assets[assetId] = {
    approved: true, source: "pixelfx", ref: id, kind: "fx", path,
    fx: { cols: b.cols, frames: b.frames, fps: 30, loop: b.loop, dx: b.dx, dy: b.dy },
  };
  return assetId;
}

/** Re-aims (or re-reaches) an fx entry: bakes the new angle and reach and points the entry (fx, angle, reach) at it. */
export async function rebakeFx(
  p: Project, tl: Timeline, entryId: string, angle: number, encode = defaultEncode, reach?: number,
): Promise<EditResult> {
  const entry = tl.fx.find((f) => f.id === entryId);
  if (!entry) return { tl, error: `No effect called ${entryId}.` };
  const old = entry.fx, a = p.kit.assets[old];
  const id = a?.source === "pixelfx" ? a.ref : undefined;
  if (!id) return { tl, error: `${old} is not a library effect.` };
  const rc = clampReach(reach ?? entry.reach ?? 1);
  const next = await addLibraryFx(p, id, angle, encode, rc);
  let r = setField(tl, entryId, "fx", next); // old sheet stays so Undo keeps working
  if (!r.error) r = setField(r.tl, entryId, "angle", Math.round(angle));
  if (!r.error && (rc > 1 || entry.reach !== undefined)) r = setField(r.tl, entryId, "reach", rc > 1 ? rc : undefined);
  return r;
}

/** The effect's middle frame, for the drawer. */
export async function fxThumb(id: string): Promise<Img> {
  const mod = await loadFx(id);
  const [w, h] = mod.meta.size as [number, number];
  const n = Math.max(1, Math.round(mod.meta.duration * 30) + (mod.meta.loop ? 0 : 1));
  const mid = Math.floor(n / 2);
  return { w, h, px: renderFxFrames(mod, {}, 30, mid + 1)[mid] };
}

/** Bakes every fx entry that names a library effect ("fire/fire-breath", as a drafted scene does) and points it at the
 * baked asset; kit ids and unknown names are left alone (unknown ones show in Needs approval). Returns how many it baked. */
export async function bakeDraftFx(p: Project, encode = defaultEncode): Promise<number> {
  let n = 0;
  for (const f of p.tl?.fx ?? []) {
    if (p.kit.assets[f.fx] || !byId.has(f.fx)) continue;
    f.fx = await addLibraryFx(p, f.fx, f.angle, encode, f.reach ?? 1);
    n++;
  }
  return n;
}

/** Points an fx entry at a library effect (baked at the entry's angle and reach): for a missing effect in Needs approval. */
export async function useLibraryFx(p: Project, tl: Timeline, entryId: string, libId: string, encode = defaultEncode): Promise<EditResult> {
  const entry = tl.fx.find((f) => f.id === entryId);
  if (!entry) return { tl, error: `No effect called ${entryId}.` };
  return setField(tl, entryId, "fx", await addLibraryFx(p, libId, entry.angle, encode, entry.reach ?? 1));
}
