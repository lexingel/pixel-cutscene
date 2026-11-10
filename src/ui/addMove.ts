import { pose, ANIM_FPS } from "../core/acting";
import { addLibraryFx, clampReach, loadFx, naturalReach } from "../core/fxLibrary";
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

// a breath burns this long; the breathe clip holds its last frame (jaws open) meanwhile
const FLAME_DUR = 1;

/**
 * The mouth of a sprite facing right, in its own pixels: the gap between the jaws a few columns behind the snout tip
 * (its front column's right edge, the gap's middle row); a closed mouth gives the snout tip. Null for an empty sprite.
 */
export function findMouth(im: Img): { x: number; y: number } | null {
  const op = (x: number, y: number) => im.px[(y * im.w + x) * 4 + 3] > 0;
  let tip: { x: number; y: number } | null = null;
  for (let x = im.w - 1; x >= 0 && !tip; x--) for (let y = 0; y < Math.ceil(im.h * 0.6); y++) if (op(x, y)) { tip = { x, y }; break; }
  if (!tip) return null;
  const top = Math.max(0, tip.y - Math.round(im.h * 0.1)), bottom = Math.min(im.h - 1, tip.y + Math.max(8, Math.round(im.h * 0.25)));
  for (let x = tip.x; x >= Math.max(0, tip.x - Math.max(4, Math.round(im.w / 6))); x--) {
    // an opaque run, then a transparent gap, then opaque again: the open jaws
    let y = top;
    while (y <= bottom && !op(x, y)) y++;
    while (y <= bottom && op(x, y)) y++;
    const g0 = y;
    while (y <= bottom && !op(x, y)) y++;
    if (y <= bottom && y > g0) return { x: x + 1, y: Math.floor((g0 + y - 1) / 2) };
  }
  return { x: tip.x + 1, y: tip.y };
}

type Frames = (char: string, anim: string) => Img[];

// The character's frames (scale 2 doubled), decoding the ones `img` does not have yet.
async function framesOf(p: Project, char: string, img: (path: string) => Img | null, decodeImg: (b: Blob) => Promise<Img>): Promise<Frames> {
  const loaded = new Map<string, Img>();
  for (const a of Object.values(p.kit.chars[char]?.anims ?? {})) {
    for (const path of a.frames) {
      const blob = p.files.get(path);
      if (blob && !img(path) && !loaded.has(path)) loaded.set(path, await decodeImg(blob));
    }
  }
  const have = (path: string) => img(path) ?? loaded.get(path) ?? null;
  return charFrames(p.kit, have, false, (path) => have(path) !== null);
}

// Where and when a breath that starts at t burns: the last third of the clip, at the mouth of the frame showing then
// (else the sprite's facing edge, 30% down), flipped like the actor.
function flameAt(actor: Timeline["actors"][number], t: number, frames: Frames) {
  // not made yet: the generator returns 9 frames (frame_count 8 + the reference)
  const clip = (frames(actor.char, "breathe").length || 9) / ANIM_FPS;
  const ft = snap(t + (2 / 3) * clip);
  const q = pose({ ...actor, actions: [{ id: "_", t, do: "anim:breathe" }] }, ft, frames);
  if (!q?.img) return { t: ft, x: actor.x, y: actor.y, flip: !!q?.flip };
  const w = q.img.w, h = q.img.h, m = findMouth(q.img) ?? { x: w, y: Math.round(h * 0.3) };
  return { t: ft, x: q.flip ? q.drawX + w - m.x : q.drawX + m.x, y: q.drawY + m.y, flip: q.flip };
}

/**
 * After a character's breathe animation is (re)made: each breathe flame of its actors moves to the new mouth and
 * timing (the flame nearest after each breathe action, within 2 s). Aim and length stay. Same timeline when none.
 */
export async function replaceFlames(
  p: Project, tl: Timeline, char: string, img: (path: string) => Img | null = noImg, decodeImg: (b: Blob) => Promise<Img> = defaultDecode,
): Promise<Timeline> {
  const isFlame = (f: Timeline["fx"][number]) => p.kit.assets[f.fx]?.ref === "fire/fire-breath";
  const breaths = tl.actors.filter((a) => a.char === char).flatMap((a) => a.actions.filter((x) => x.do === "anim:breathe").map((x) => ({ a, t: x.t })));
  if (!breaths.length || !tl.fx.some(isFlame)) return tl;
  const frames = await framesOf(p, char, img, decodeImg);
  const fx = tl.fx.map((f) => ({ ...f }));
  const used = new Set<number>();
  let changed = false;
  for (const b of breaths) {
    let best = -1;
    fx.forEach((f, i) => {
      if (!used.has(i) && isFlame(f) && f.t >= b.t - 1e-6 && f.t <= b.t + 2 && (best < 0 || f.t < fx[best].t)) best = i;
    });
    if (best < 0) continue;
    used.add(best);
    const at0 = flameAt(b.a, b.t, frames);
    Object.assign(fx[best], { t: at0.t, x: at0.x, y: at0.y });
    changed = true;
  }
  return changed ? { ...tl, fx } : tl;
}

/** How far a flame from `at` must carry to reach the nearest other actor it faces (1 = as drawn, in half steps, up to 4). */
export function reachTo(tl: Timeline, self: Timeline["actors"][number], at: { x: number; flip: boolean }, natural: number): number {
  let d = Infinity;
  for (const a of tl.actors) {
    const dx = (a.x - at.x) * (at.flip ? -1 : 1);
    if (a.id !== self.id && dx > 0) d = Math.min(d, dx);
  }
  return d === Infinity ? 1 : clampReach(Math.ceil((d / natural) * 2) / 2);
}

/**
 * Makes an existing action do `doId`. `anim:breathe` also adds `fire/fire-breath` from two thirds into the clip for
 * FLAME_DUR, at the mouth (see flameAt), flipped like the actor (same result, so one undo step).
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

  const frames = await framesOf(p, actor.char, img, decodeImg);
  const at0 = flameAt(actor, t, frames);
  const before = new Set(Object.keys(p.kit.assets));
  const reach = reachTo(moved.tl, actor, at0, naturalReach(await loadFx("fire/fire-breath")));
  const fx = await addLibraryFx(p, "fire/fire-breath", undefined, encode, reach);
  const flame = addEntry(moved.tl, "fx", {
    t: at0.t, dur: FLAME_DUR, fx, x: at0.x, y: at0.y, ...(at0.flip ? { flip: true } : {}), ...(reach > 1 ? { reach } : {}),
  }, "f");
  if (flame.error && !before.has(fx)) {
    const a = p.kit.assets[fx];
    delete p.kit.assets[fx];
    if (a) p.files.delete(a.path);
  }
  return flame.error ? flame : { ...flame, id: actionId };
}
