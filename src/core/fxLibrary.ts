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

const assetIdOf = (id: string, angle?: number) => {
  const a = Math.round(angle ?? 0);
  return id.split("/")[1] + (a ? `_a${a}` : "");
};

/** Bakes a library effect (aimed `angle` whole degrees, 0 = as drawn) into an approved fx asset; returns its id. */
export async function addLibraryFx(p: Project, id: string, angle?: number, encode = defaultEncode): Promise<string> {
  // reuse only this library effect at this angle; a user asset that happens to share the short name is left alone
  let assetId = assetIdOf(id, angle);
  for (let a = p.kit.assets[assetId]; a; a = p.kit.assets[assetId]) {
    if (a.source === "pixelfx" && a.ref === id) return assetId;
    assetId += "_";
  }
  const mod = await loadFx(id);
  const a = Math.round(angle ?? 0);
  const b = bakeFx(mod, a ? { angle: (a * Math.PI) / 180 } : {}, 30);
  const path = freePath(p, "fx/", `${assetId}.png`);
  p.files.set(path, await encode(b.sheet));
  p.kit.assets[assetId] = {
    approved: true, source: "pixelfx", ref: id, kind: "fx", path,
    fx: { cols: b.cols, frames: b.frames, fps: 30, loop: b.loop, dx: b.dx, dy: b.dy },
  };
  return assetId;
}

/** Re-aims an fx entry: bakes the new angle and points the entry (fx and angle) at it. */
export async function rebakeFx(p: Project, tl: Timeline, entryId: string, angle: number, encode = defaultEncode): Promise<EditResult> {
  const entry = tl.fx.find((f) => f.id === entryId);
  if (!entry) return { tl, error: `No effect called ${entryId}.` };
  const old = entry.fx, a = p.kit.assets[old];
  const id = a?.source === "pixelfx" ? a.ref : undefined;
  if (!id) return { tl, error: `${old} is not a library effect.` };
  const next = await addLibraryFx(p, id, angle, encode);
  const r = setField(tl, entryId, "fx", next);
  return r.error ? r : setField(r.tl, entryId, "angle", Math.round(angle)); // old sheet stays so Undo keeps working
}

/** The effect's middle frame, for the drawer. */
export async function fxThumb(id: string): Promise<Img> {
  const mod = await loadFx(id);
  const [w, h] = mod.meta.size as [number, number];
  const n = Math.max(1, Math.round(mod.meta.duration * 30) + (mod.meta.loop ? 0 : 1));
  const mid = Math.floor(n / 2);
  return { w, h, px: renderFxFrames(mod, {}, 30, mid + 1)[mid] };
}
