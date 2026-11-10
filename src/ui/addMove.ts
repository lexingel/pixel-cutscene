import { pose, ANIM_FPS } from "../core/acting";
import { addLibraryFx } from "../core/fxLibrary";
import { charFrames } from "../core/frames";
import type { Img } from "../core/kit";
import type { Project } from "../core/project";
import type { Timeline } from "../core/types";
import { FPS, addAction, addEntry, find, setMove, snap, type EditResult } from "./timelineEditor";

const noImg = () => null;
const defaultDecode = async (b: Blob): Promise<Img> => (await import("./cast")).decode(b);

/**
 * Adds a move for an actor at t, as one timeline edit (so one undo step). `anim:breathe` also brings its
 * flame (see changeMove). `img` gives decoded frames (for the sprite's size).
 */
export async function addMove(
  p: Project, tl: Timeline, actorId: string, doId: string, t: number, img: (path: string) => Img | null = noImg,
  encode?: (img: Img) => Promise<Blob>, decodeImg: (b: Blob) => Promise<Img> = defaultDecode,
): Promise<EditResult> {
  const added = addAction(tl, actorId, { t, do: "idle" });
  if (added.error) return added;
  const r = await changeMove(p, added.tl, added.id!, doId, img, encode, decodeImg);
  return r.error ? r : { ...r, id: added.id };
}

/**
 * Makes an existing action do `doId`. `anim:breathe` also adds `fire/fire-breath` for the last third of the clip, at
 * the sprite's facing-side edge, 30% down from its top, flipped like the actor (same result, so one undo step).
 * Frames of the actor's character that are not decoded yet are decoded here.
 */
export async function changeMove(
  p: Project, tl: Timeline, actionId: string, doId: string, img: (path: string) => Img | null = noImg,
  encode?: (img: Img) => Promise<Blob>, decodeImg: (b: Blob) => Promise<Img> = defaultDecode,
): Promise<EditResult> {
  const at = find(tl, actionId);
  if (at?.kind !== "action") return { tl, error: `${actionId} is not an action.` };
  const moved = setMove(tl, actionId, doId, !!at.actor.flip);
  if (moved.error || doId !== "anim:breathe") return { ...moved, id: actionId };
  const t = at.e.t as number;
  const actor = find(moved.tl, at.actor.id)!.e as Timeline["actors"][number];

  const loaded = new Map<string, Img>();
  for (const a of Object.values(p.kit.chars[actor.char]?.anims ?? {})) {
    for (const path of a.frames) {
      const blob = p.files.get(path);
      if (blob && !img(path) && !loaded.has(path)) loaded.set(path, await decodeImg(blob));
    }
  }
  const have = (path: string) => img(path) ?? loaded.get(path) ?? null;
  const frames = charFrames(p.kit, have, false, (path) => have(path) !== null);
  const q = pose(actor, snap(t), frames);
  // not made yet: the generator returns 9 frames (frame_count 8 + the reference)
  const clip = (frames(actor.char, "breathe").length || 9) / ANIM_FPS;
  const w = q?.img?.w ?? 0, h = q?.img?.h ?? 0;
  const mouth = q ? { x: q.flip ? q.drawX : q.drawX + w, y: q.drawY + Math.round(h * 0.3) } : { x: actor.x, y: actor.y };
  const before = new Set(Object.keys(p.kit.assets));
  const fx = await addLibraryFx(p, "fire/fire-breath", undefined, encode);
  const flame = addEntry(moved.tl, "fx", {
    t: snap(t + (2 / 3) * clip), dur: Math.max(snap(clip / 3), 1 / FPS), fx, x: mouth.x, y: mouth.y, ...(q?.flip ? { flip: true } : {}),
  }, "f");
  if (flame.error && !before.has(fx)) {
    const a = p.kit.assets[fx];
    delete p.kit.assets[fx];
    if (a) p.files.delete(a.path);
  }
  return flame.error ? flame : { ...flame, id: actionId };
}
