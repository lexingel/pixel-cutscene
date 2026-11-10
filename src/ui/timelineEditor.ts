import { validateTimeline } from "../core/timeline";
import { pose, shotAt } from "../core/acting";
import { camAt } from "../core/cam";
import { DUST_DUR } from "../core/moves";
import type { Action, CamKey, Shot, Timeline } from "../core/types";

// Pure timeline edits. Entries are addressed by their `id` (the validator keeps ids unique across
// shots, actors, actions, fx and audio); "(root)" addresses the timeline itself.
// Every op returns a new timeline, or the same one plus an error when the edit would not validate.
export type EditResult = { tl: Timeline; error?: string; id?: string };
type Obj = Record<string, any>;

export const FPS = 30;
export const snap = (t: number) => Math.round(t * FPS) / FPS;
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

export type Found =
  | { kind: "root"; e: Obj }
  | { kind: "shot"; e: Obj; i: number }
  | { kind: "actor"; e: Obj }
  | { kind: "action"; e: Obj; actor: Obj }
  | { kind: "fx" | "audio"; e: Obj };

export function find(tl: Timeline, id: string): Found | null {
  if (id === "(root)") return { kind: "root", e: tl };
  const i = tl.shots.findIndex((s) => s.id === id);
  if (i >= 0) return { kind: "shot", e: tl.shots[i], i };
  for (const a of tl.actors) {
    if (a.id === id) return { kind: "actor", e: a };
    const act = a.actions.find((x) => x.id === id);
    if (act) return { kind: "action", e: act, actor: a };
  }
  const f = tl.fx.find((x) => x.id === id);
  if (f) return { kind: "fx", e: f };
  const s = tl.audio.find((x) => x.id === id);
  return s ? { kind: "audio", e: s } : null;
}

// Clone, edit, then keep the result only if it adds no validation error (an already broken
// timeline stays editable, so a bad draft can be fixed by hand).
function edit(tl: Timeline, id: string, f: (copy: Timeline, at: Found) => string | void): EditResult {
  const copy = structuredClone(tl);
  const at = find(copy, id);
  if (!at) return { tl, error: `Nothing called ${id} in this timeline.` };
  const refused = f(copy, at);
  if (refused) return { tl, error: refused };
  const before = new Set(validateTimeline(tl));
  const fresh = validateTimeline(copy).filter((e) => !before.has(e));
  return fresh.length ? { tl, error: fresh[0] } : { tl: copy };
}

export function newId(tl: Timeline, prefix: string): string {
  const used = new Set<string>();
  const all: Obj[] = [...tl.shots, ...tl.actors, ...tl.fx, ...tl.audio, ...tl.actors.flatMap((a) => a.actions)];
  all.forEach((x) => used.add(x.id));
  let n = 1;
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

export const moveEntry = (tl: Timeline, id: string, t: number): EditResult =>
  edit(tl, id, (c, at) => {
    if (at.kind === "shot") return "Drag a shot's edge to change where it starts or ends.";
    if (at.kind === "actor") at.e.appear = clamp(snap(t), 0, c.duration);
    else if (at.kind === "root") return "The scene itself has no time to move.";
    else at.e.t = clamp(snap(t), 0, c.duration);
  });

export const resizeEntry = (tl: Timeline, id: string, dur: number): EditResult =>
  edit(tl, id, (_c, at) => {
    if (at.kind !== "action" && at.kind !== "fx") return "Only actions and effects have a duration (a sound lasts as long as its clip).";
    at.e.dur = Math.max(snap(dur), 1 / FPS);
  });

/** Moves the boundary between two neighbouring shots, so the shots stay tiled. */
export const moveShotEdge = (tl: Timeline, shotIdA: string, shotIdB: string, t: number): EditResult =>
  edit(tl, shotIdA, (c, at) => {
    const b = at.kind === "shot" ? c.shots[at.i + 1] : undefined;
    if (at.kind !== "shot" || b?.id !== shotIdB) return `${shotIdA} and ${shotIdB} are not neighbouring shots.`;
    const s = snap(t);
    if (s <= at.e.start || s >= b.end) return "A shot needs at least one frame.";
    at.e.end = b.start = s;
  });

export const addAction = (tl: Timeline, actorId: string, action: Omit<Action, "id">): EditResult => {
  const id = newId(tl, "a");
  const r = edit(tl, actorId, (_c, at) => {
    if (at.kind !== "actor") return `${actorId} is not an actor.`;
    at.e.actions.push({ id, ...action, t: snap(action.t) });
    at.e.actions.sort((x: Action, y: Action) => x.t - y.t);
  });
  return r.error ? r : { ...r, id };
};

/** Adds an actor, effect or sound with a fresh id. */
export function addEntry(tl: Timeline, list: "actors" | "fx" | "audio", entry: Obj, prefix: string): EditResult {
  const id = newId(tl, prefix);
  const r = edit(tl, "(root)", (c) => void (c[list] as Obj[]).push({ id, ...entry }));
  return r.error ? r : { ...r, id };
}

/** Splits the shot under t into two at t (the new half copies the shot's look). */
export const splitShot = (tl: Timeline, id: string, t: number): EditResult => {
  const nid = newId(tl, "s");
  const r = edit(tl, id, (c, at) => {
    if (at.kind !== "shot") return `${id} is not a shot.`;
    const s = snap(t);
    if (s <= at.e.start || s >= at.e.end) return "Put the playhead inside the shot to split it.";
    // camera keys are in scene time, so both halves keep the whole list and the pan runs on across the cut
    const half = { ...structuredClone(at.e), id: nid, start: s } as Shot;
    delete half.locked;
    delete half.flash; // flash and shake belong to the shot's start
    delete half.shake;
    delete half.fade_in; // a cut, not a fade: the first half keeps the fade-in, the second the fade-out
    delete at.e.fade_out;
    at.e.end = s;
    c.shots.splice(at.i + 1, 0, half);
  });
  return r.error ? r : { ...r, id: nid };
};

/** A new shot at t for len seconds (or to the end of the shot under t), shaped by patch; the old shot carries on after it. */
export function insertShot(tl: Timeline, t: number, len: number | undefined, patch: Obj): EditResult {
  if (!tl.shots.length) return { tl, error: "Add a shot first." };
  const s0 = shotAt(tl, t), a = snap(t);
  let cur = tl, id = s0.id;
  if (a > s0.start + 1e-6) {
    const r = splitShot(cur, id, a);
    if (r.error) return r;
    [cur, id] = [r.tl, r.id!];
  }
  if (len !== undefined && a + len < s0.end - 1e-6) {
    const r = splitShot(cur, id, a + len);
    if (r.error) return r;
    cur = r.tl;
  }
  const r = edit(cur, id, (_c, at) => {
    const e = at.e;
    if (patch.type === "closeup") ["camera", "bg_scale", "zoom"].forEach((k) => delete e[k]);
    Object.assign(e, patch);
  });
  return r.error ? r : { ...r, id };
}

export type PanDir = "left" | "right" | "up" | "down";
/** A shot from t to the end of the shot under t whose camera slides as far as the background reaches that way (extra = how much bigger than the frame it is). */
export function panShot(tl: Timeline, t: number, dir: PanDir, extra: { x: number; y: number }): EditResult {
  const s0 = tl.shots.length ? shotAt(tl, t) : null;
  if (!s0 || s0.type !== "wide") return { tl, error: "Move the playhead to a wide shot to pan." };
  const a = snap(t), c = camAt(s0.camera, a);
  const room = { left: c.x, right: extra.x - c.x, up: c.y, down: extra.y - c.y }[dir];
  if (room < 1) return { tl, error: `The background reaches no further ${dir} here, so there is nothing to pan to. Raise its bg scale to make it bigger than the frame.` };
  const d = { left: [-room, 0], right: [room, 0], up: [0, -room], down: [0, room] }[dir];
  return insertShot(tl, a, undefined, { camera: [{ t: a, x: c.x, y: c.y }, { t: s0.end, x: c.x + d[0], y: c.y + d[1] }] });
}

export type Transition = "fade_in" | "fade_out" | "flash" | "shake";
const TRANSITION_LEN: Record<Transition, number> = { fade_in: 0.5, fade_out: 0.5, flash: 0.3, shake: 0.5 };
/** Gives the shot under t a fade in or out, a white flash or a shake. */
export function transition(tl: Timeline, t: number, kind: Transition): EditResult {
  if (!tl.shots.length) return { tl, error: "Add a shot first." };
  const s = shotAt(tl, t);
  return { ...setField(tl, s.id, kind, Math.min(TRANSITION_LEN[kind], s.end - s.start)), id: s.id };
}

export const deleteEntry = (tl: Timeline, id: string): EditResult =>
  edit(tl, id, (c, at) => {
    switch (at.kind) {
      case "root":
        return "The scene itself cannot be deleted.";
      case "shot": {
        if (c.shots.length === 1) return "A scene needs at least one shot.";
        const [gone] = c.shots.splice(at.i, 1);
        if (at.i > 0) c.shots[at.i - 1].end = gone.end; // the previous shot takes over its time
        else c.shots[0].start = gone.start;
        return;
      }
      case "actor":
        c.actors = c.actors.filter((a) => a.id !== id);
        return;
      case "action":
        at.actor.actions = at.actor.actions.filter((a: Action) => a.id !== id);
        return;
      default:
        c[at.kind] = (c[at.kind] as Obj[]).filter((x) => x.id !== id) as any;
    }
  });

/** Changes an action's move and fills in what the new move needs (a destination, a duration). */
export const setMove = (tl: Timeline, actionId: string, doId: string, facingLeft: boolean): EditResult =>
  edit(tl, actionId, (_c, at) => {
    if (at.kind !== "action") return `${actionId} is not an action.`;
    const e = at.e as Action;
    e.do = doId;
    if ((doId === "walk" || doId === "move") && !e.to) {
      // where the actor stands at this t, ignoring this action itself
      const others = { ...at.actor, actions: at.actor.actions.filter((a: Action) => a.id !== actionId) };
      const p = pose(others as any, e.t, () => []);
      const [x, y] = p ? [p.feet.x, p.feet.y] : [at.actor.x, at.actor.y];
      e.to = [x + (facingLeft ? -64 : 64), y];
    }
    if ((doId === "walk" || doId === "move") && e.dur === undefined) e.dur = 1.5;
    if ((doId === "look_around" || doId === "startle") && e.dur === undefined) e.dur = 1;
    if (doId === "dust" && e.dur === undefined) e.dur = DUST_DUR;
  });

/** Sets one field; undefined removes it. Changing the scene's duration moves the last shot's end too. */
export const setField = (tl: Timeline, id: string, key: string, value: unknown): EditResult =>
  edit(tl, id, (c, at) => {
    if (key === "id") return "Ids cannot be changed here.";
    if (value === undefined) delete at.e[key];
    else at.e[key] = value;
    if (at.kind === "root" && key === "duration" && c.shots.length) c.shots[c.shots.length - 1].end = value as number;
  });

/** Replaces a wide shot's camera keys (scene time, snapped to frames, sorted). */
export const setCamera = (tl: Timeline, id: string, keys: CamKey[]): EditResult =>
  edit(tl, id, (_c, at) => {
    if (at.kind !== "shot" || at.e.type !== "wide") return `${id} is not a wide shot.`;
    at.e.camera = keys.map((k) => ({ ...k, t: snap(k.t) })).sort((a, b) => a.t - b.t);
  });

/** Undo and redo: the last 100 timelines. */
export class History {
  private past: Timeline[] = [];
  private future: Timeline[] = [];
  push(prev: Timeline): void {
    this.past.push(prev);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
  }
  undo(cur: Timeline): Timeline | null {
    const t = this.past.pop();
    if (t) this.future.push(cur);
    return t ?? null;
  }
  redo(cur: Timeline): Timeline | null {
    const t = this.future.pop();
    if (t) this.past.push(cur);
    return t ?? null;
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
