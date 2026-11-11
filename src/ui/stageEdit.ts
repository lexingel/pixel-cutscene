import { pose, shotAt } from "../core/acting";
import { camAt, round } from "../core/cam";
import { charFrames } from "../core/frames";
import { assetStatus, type Img, type Kit } from "../core/kit";
import type { Actor, CamKey, FxEntry, Timeline } from "../core/types";
import { find, setField, type EditResult } from "./timelineEditor";

// Direct editing in the preview. Everything here is pure: points are canvas pixels (the camera is applied inside).
type ImgOf = (path: string) => Img | null;
export type Target = { id: string; key: "pos" | "to" };
type Box = { id: string; x: number; y: number; w: number; h: number };

export const AIM_R = 24; // the aim handle sits this far from the effect's origin
const inside = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
const isWalk = (do_: string) => do_ === "walk" || do_ === "move";

/** The camera in a wide shot at t; null in a close-up or an empty timeline (nothing to pick there). */
export function camNow(tl: Timeline, t: number): { x: number; y: number } | null {
  const s = tl.shots.length ? shotAt(tl, t) : null;
  return s && s.type === "wide" ? camAt(s.camera, t) : null;
}

/** An effect's drawn box on the canvas, null while it is not on screen (mirrors drawFx). */
function fxBox(tl: Timeline, kit: Kit, img: ImgOf, t: number, cam: { x: number; y: number }, f: FxEntry): Box | null {
  const a = kit.assets[f.fx], m = a?.fx;
  const sheet = a && m && assetStatus(kit, f.fx, false, (p) => img(p) !== null) === "ok" ? img(a.path) : null;
  if (!a || !m || !sheet) return null;
  const dur = (f as { dur?: number }).dur;
  const i = Math.floor((t - f.t) * (m.fps || 12) + 0.0001);
  if (i < 0 || (dur !== undefined && t >= f.t + dur) || !(m.loop || i < m.frames || (f as { hold?: boolean }).hold)) return null;
  const fw = sheet.w / m.cols, fh = sheet.h / Math.ceil(m.frames / m.cols);
  const ox = f.flip ? fw - 1 - m.dx : m.dx;
  return { id: f.id, x: round(f.x) - ox - cam.x, y: round(f.y) - m.dy - cam.y, w: fw, h: fh };
}

/** The id of what is under canvas point (x, y) at time t: an effect's origin dot, then the front-most actor, then an effect's box. */
export function hitTest(tl: Timeline, kit: Kit, img: ImgOf, t: number, x: number, y: number): string | null {
  const cam = camNow(tl, t);
  if (!cam) return null;
  const frames = charFrames(kit, img, false, (p) => img(p) !== null);
  const fx = [...tl.fx].reverse().flatMap((f) => (fxBox(tl, kit, img, t, cam, f) ? [f] : []));
  const dot = fx.find((f) => Math.abs(x - (round(f.x) - cam.x)) <= 6 && Math.abs(y - (round(f.y) - cam.y)) <= 6);
  if (dot) return dot.id;
  const actors = tl.actors
    .map((a) => ({ id: a.id, q: pose(a, t, frames) }))
    .filter((e) => e.q?.img)
    .sort((a, b) => a.q!.feet.y - b.q!.feet.y) // the render order: lower feet are drawn later, ties keep timeline order
    .reverse(); // front first
  for (const e of actors) {
    const q = e.q!;
    if (inside({ id: e.id, x: q.drawX + q.shake - cam.x, y: q.drawY - cam.y, w: q.img!.w, h: q.img!.h }, x, y)) return e.id;
  }
  for (const f of fx) if (inside(fxBox(tl, kit, img, t, cam, f)!, x, y)) return f.id;
  return null;
}

/** The canvas box of what is selected (an actor, the actor of a selected move, or an effect) at t; null when it is not on screen. */
export function selBox(tl: Timeline, kit: Kit, img: ImgOf, t: number, id: string | null): Box | null {
  const cam = camNow(tl, t);
  const at = id && cam ? find(tl, id) : null;
  if (!at || !cam) return null;
  if (at.kind === "fx") return fxBox(tl, kit, img, t, cam, at.e as FxEntry);
  const a = (at.kind === "actor" ? at.e : at.kind === "action" ? at.actor : null) as Actor | null;
  const q = a && pose(a, t, charFrames(kit, img, false, (p) => img(p) !== null));
  return a && q?.img ? { id: a.id, x: q.drawX + q.shake - cam.x, y: q.drawY - cam.y, w: q.img.w, h: q.img.h } : null;
}

/** What a drag on this actor or effect edits: an actor's walk/move under way or last finished at t moves its destination, else the actor. */
export function dragTarget(tl: Timeline, id: string, t: number): Target {
  const a = tl.actors.find((x) => x.id === id);
  const w = a?.actions.filter((x) => isWalk(x.do) && x.to && x.t <= t).sort((p, q) => p.t - q.t).pop();
  return w ? { id: w.id, key: "to" } : { id, key: "pos" };
}

/** What the arrow keys move for the selected entry; null when it is nothing movable. */
export function nudgeTarget(tl: Timeline, id: string | null, t: number): Target | null {
  const at = id ? find(tl, id) : null;
  if (!id || !at) return null;
  if (at.kind === "actor") return dragTarget(tl, id, t);
  if (at.kind === "fx") return { id, key: "pos" };
  return at.kind === "action" && isWalk(at.e.do) && at.e.to ? { id, key: "to" } : null;
}

/** The ground line of the wide shot showing at t, if it has one. */
export function groundAt(tl: Timeline, t: number): number | undefined {
  const s = tl.shots.length ? shotAt(tl, t) : null;
  return s?.type === "wide" ? s.ground : undefined;
}

/** Moves the target by whole pixels (dx, dy rounded). Feet (an actor, a walk's end) snap to `ground` when near it. */
export function moveBy(tl: Timeline, target: Target, dx: number, dy: number, ground?: number): EditResult {
  const at = find(tl, target.id);
  if (!at) return { tl, error: `Nothing called ${target.id}.` };
  const ax = Math.round(dx), ay = Math.round(dy);
  if (target.key === "to") {
    const to = at.e.to as [number, number] | undefined;
    return to ? setField(tl, target.id, "to", [to[0] + ax, snapGround(to[1] + ay, ground)]) : { tl, error: `${target.id} has no destination.` };
  }
  const y = (at.e.y as number) + ay;
  const r = setField(tl, target.id, "x", (at.e.x as number) + ax);
  return r.error ? r : setField(r.tl, target.id, "y", at.kind === "actor" ? snapGround(y, ground) : y);
}

export type Walk = { id: string; from: [number, number]; to: [number, number]; box: Box };

/** Each walk/move of an actor: where it starts, where it ends, and the ghost box (the actor's size) there. Scene coordinates. */
export function walks(tl: Timeline, kit: Kit, img: ImgOf, actor: Actor): Walk[] {
  const frames = charFrames(kit, img, false, (p) => img(p) !== null);
  const sorted = [...actor.actions].sort((a, b) => a.t - b.t);
  return sorted.flatMap((a, i) => {
    if (!isWalk(a.do) || !a.to) return [];
    const q = pose({ ...actor, appear: undefined, actions: sorted.slice(0, i) }, a.t, frames);
    const w = q?.img?.w ?? 0, h = q?.img?.h ?? 0;
    const [x, y] = a.to;
    return [{ id: a.id, from: [q?.feet.x ?? actor.x, q?.feet.y ?? actor.y] as [number, number], to: [x, y] as [number, number], box: { id: a.id, x: x - Math.floor(w / 2), y: y - h, w, h } }];
  });
}

/** The walk whose ghost box is under canvas point (x, y), the nearest ghost winning. */
export function ghostAt(ws: Walk[], cam: { x: number; y: number }, x: number, y: number): string | null {
  return ws.find((w) => inside({ ...w.box, x: w.box.x - cam.x, y: w.box.y - cam.y }, x, y))?.id ?? null;
}

// The stored angle is what the sheet was baked at; drawFx mirrors the sheet of a flipped effect, so it shows at 180 - angle.
const drawn = (f: FxEntry, deg: number) => (f.flip ? 180 - deg : deg);
const wrap = (deg: number) => {
  const d = ((deg % 360) + 360) % 360;
  return d > 180 ? d - 360 : d; // (-180, 180]
};

/** The aim handle's centre on the canvas for an effect with stored angle `deg` (0 = right, clockwise on screen): where its flame is drawn. */
export function aimHandle(f: FxEntry, cam: { x: number; y: number }, deg: number): { x: number; y: number } {
  const r = (drawn(f, deg) * Math.PI) / 180;
  return { x: round(f.x) - cam.x + Math.round(AIM_R * Math.cos(r)), y: round(f.y) - cam.y + Math.round(AIM_R * Math.sin(r)) };
}

/** The stored angle, in whole degrees rounded to 5, that makes the drawn effect point from its origin toward canvas point (x, y). */
export function aimAngle(f: FxEntry, cam: { x: number; y: number }, x: number, y: number): number {
  const deg = (Math.atan2(y - (round(f.y) - cam.y), x - (round(f.x) - cam.x)) * 180) / Math.PI;
  return wrap(drawn(f, Math.round(deg / 5) * 5));
}

/** The pointer (canvas px) is on the aim handle: within 8 screen px (`k` canvas px per screen px), at least 4 canvas px. */
export function onAimHandle(c: { x: number; y: number }, hd: { x: number; y: number }, k: number): boolean {
  const r = Math.max(4, 8 * k);
  return Math.abs(c.x - hd.x) <= r && Math.abs(c.y - hd.y) <= r;
}

export const GROUND_SNAP = 12;
/** Feet that land within GROUND_SNAP px of the shot's ground line stand on it. */
export function snapGround(y: number, ground: number | undefined): number {
  return typeof ground === "number" && Math.abs(y - ground) <= GROUND_SNAP ? ground : y;
}

/** Camera keys for shot `shotId` that keep `actorId` in the middle across the frame (w wide), linear between keys,
 * with the camera's height and the background's reach (`extra`, how far the camera can go) kept. Standing still adds no keys. */
export function followKeys(tl: Timeline, kit: Kit, img: ImgOf, shotId: string, actorId: string, w: number, _h: number, extra: { x: number; y: number }): CamKey[] {
  const s = tl.shots.find((x) => x.id === shotId), a = tl.actors.find((x) => x.id === actorId);
  if (!s || s.type !== "wide" || !a) return [];
  const frames = charFrames(kit, img, false, (p) => img(p) !== null);
  const step = 0.1, pts: CamKey[] = [];
  for (let t = s.start; t < s.end + step / 2; t += step) {
    const at = Math.min(t, s.end), q = pose(a, at, frames);
    const x = Math.min(Math.max(round((q?.feet.x ?? a.x) - w / 2), 0), Math.max(extra.x, 0));
    pts.push({ t: Math.round(at * 1000) / 1000, x, y: camAt(s.camera, at).y });
  }
  // keep only the points where the motion changes (within a pixel): Ramer–Douglas–Peucker on x over time
  const keep = new Set([0, pts.length - 1]);
  const rdp = (i: number, j: number) => {
    let far = -1, d = 1;
    for (let k = i + 1; k < j; k++) {
      const e = Math.abs(pts[k].x - (pts[i].x + ((pts[j].x - pts[i].x) * (pts[k].t - pts[i].t)) / (pts[j].t - pts[i].t)));
      if (e > d) (d = e), (far = k);
    }
    if (far < 0) return;
    keep.add(far);
    rdp(i, far);
    rdp(far, j);
  };
  rdp(0, pts.length - 1);
  const ks = pts.filter((_, i) => keep.has(i));
  return ks.map((k, i) => (i < ks.length - 1 ? { ...k, ease: "linear" as const } : k));
}
