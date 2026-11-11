// Time effects: what moment of the scene is on screen at output time t. Outside an effect the two are the same,
// so every bar keeps its place and the sound (which plays in output time) stays in step.
import type { Timeline } from "./types";

/** hold: the picture stops on its first frame, then carries on where the scene has got to (a freeze, a hit-stop).
 * slow: a speed ramp, quick in and out and `rate` × speed at its middle, ending back in step.
 * The ramp is u + (1-r)/2π·sin 2πu: its speed 1 + (1-r)·cos 2πu is 2-r at the ends and r in the middle, never below 0. */
export function sceneTime(tl: Timeline, t: number): number {
  for (const s of tl.time ?? []) {
    if (t < s.t || t >= s.t + s.dur) continue;
    if (s.kind === "hold") return s.t;
    const u = (t - s.t) / s.dur, r = s.rate ?? 0.25;
    return s.t + s.dur * (u + ((1 - r) / (2 * Math.PI)) * Math.sin(2 * Math.PI * u));
  }
  return t;
}
