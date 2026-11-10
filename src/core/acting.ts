import { round } from "./cam";
import type { Actor, Shot, Timeline } from "./types";
import type { Img } from "./kit";

export const ANIM_FPS = 12;

export type Pose = {
  img: Img | null;
  feet: { x: number; y: number };
  flip: boolean;
  drawX: number;
  drawY: number;
  anim: string;
  frame: number;
  flash: boolean; // red hit flash
  shake: number; // x offset in px
  dust: number | null; // 0..1 crumble progress, null when not crumbling
  gone: boolean; // crumbled away for good
};

/**
 * An actor's pose at time t, worked out from scratch every call (scrubbing equals playing).
 * `frames` returns a character's frames for an anim; an empty array means missing.
 * Returns null before the actor appears.
 */
export function pose(actor: Actor, t: number, frames: (char: string, anim: string) => Img[]): Pose | null {
  if (actor.appear !== undefined && t < actor.appear) return null;
  const sorted = [...actor.actions].sort((a, b) => a.t - b.t);
  const di = sorted.findIndex((a) => a.do === "dust" && a.t <= t);
  if (di >= 0) {
    // freeze on the pose at the moment the dust starts; everything after it is ignored
    const d = sorted[di], dur = d.dur ?? 0;
    const u = dur > 0 ? (t - d.t) / dur : 1;
    const base = pose({ ...actor, appear: undefined, actions: sorted.slice(0, di) }, d.t, frames)!;
    const gone = u >= 1;
    return { ...base, img: gone ? null : base.img, flash: false, shake: 0, dust: gone ? 1 : u, gone };
  }
  let fx = actor.x, fy = actor.y;
  let flip = actor.flip ?? false;
  let anim = "idle";
  let animT = t; // time inside the current animation
  let once = false; // play once and hold the last frame
  let bob = 0;
  let flash = false, shake = 0;
  for (const act of sorted) {
    const t0 = act.t;
    if (t < t0) break;
    const dur = act.dur ?? 0;
    const u = dur > 0 ? (t - t0) / dur : 1;
    const live = dur > 0 && t < t0 + dur;
    const what = act.do;
    switch (what) {
      case "walk":
      case "move": {
        const [tx, ty] = act.to ?? [fx, fy];
        if (live) {
          fx += (tx - fx) * u;
          fy += (ty - fy) * u;
          if (what === "walk") { anim = "walk"; animT = t - t0; once = false; }
        } else {
          fx = tx; fy = ty;
          if (what === "walk") { anim = "idle"; animT = t - t0 - dur; once = false; }
        }
        break;
      }
      case "look_around": {
        anim = "idle"; animT = t - t0; once = false;
        if (live) {
          const flipped = u >= 0.25 && u < 0.75;
          flip = flip !== flipped;
          const since = t - t0 - (flipped ? 0.25 * dur : 0.75 * dur);
          if (u >= 0.25 && since >= 0 && since < 1 / ANIM_FPS) bob = 1;
        }
        break;
      }
      case "startle":
        if (live) { anim = "hurt"; animT = Math.min(t - t0, 1 / ANIM_FPS); once = true; } // frames 1-2, hold 2
        else { anim = "idle"; animT = t - t0 - dur; once = false; }
        break;
      case "hurt": {
        const e = t - t0;
        flash = e < 2 / ANIM_FPS - 1e-9;
        shake = [2, -2, 1, -1][Math.floor(e * 30 + 0.0001)] ?? 0;
        const hf = frames(actor.char, "hurt");
        if (hf.length && e < hf.length / ANIM_FPS) { anim = "hurt"; animT = e; once = true; }
        break;
      }
      case "idle":
        anim = "idle"; animT = t - t0; once = false;
        break;
      default:
        if (what.startsWith("anim:")) { anim = what.slice(5); animT = t - t0; once = true; }
    }
  }
  let fr = frames(actor.char, anim);
  if (!fr.length) { fr = frames(actor.char, "idle"); once = false; } // preview stand-in, loops; missingReport blocks export
  let idx = Math.floor(animT * ANIM_FPS + 0.0001);
  let img: Img | null = null;
  if (fr.length) {
    idx = once ? Math.min(idx, fr.length - 1) : ((idx % fr.length) + fr.length) % fr.length;
    img = fr[idx];
  }
  const feet = { x: round(fx), y: round(fy) };
  return {
    img, feet, flip,
    drawX: feet.x - Math.floor((img?.w ?? 0) / 2),
    drawY: feet.y - (img?.h ?? 0) - bob,
    anim, frame: idx, flash, shake, dust: null, gone: false,
  };
}

/** The shot whose start <= t < end; the last shot at t == duration. */
export function shotAt(tl: Pick<Timeline, "shots">, t: number): Shot {
  return tl.shots.find((s) => t >= s.start && t < s.end) ?? tl.shots[tl.shots.length - 1];
}
