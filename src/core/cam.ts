import type { CamKey } from "./types";

// GDScript round(): halves go away from zero (Math.round would send -0.5 up).
export const round = (n: number) => Math.sign(n) * Math.round(Math.abs(n));
const smoothstep = (u: number) => u * u * (3 - 2 * u);

/** Camera position at time t: smoothstep between keys, held at both ends, whole pixels. */
export function camAt(keys: CamKey[], t: number): { x: number; y: number } {
  if (!keys.length) return { x: 0, y: 0 };
  const ks = [...keys].sort((a, b) => a.t - b.t);
  const at = (k: CamKey) => ({ x: round(k.x), y: round(k.y) });
  if (t <= ks[0].t) return at(ks[0]);
  for (let i = 1; i < ks.length; i++) {
    const a = ks[i - 1], b = ks[i];
    if (t < b.t) {
      const u = smoothstep((t - a.t) / Math.max(b.t - a.t, 0.0001));
      return { x: round(a.x + (b.x - a.x) * u), y: round(a.y + (b.y - a.y) * u) };
    }
  }
  return at(ks[ks.length - 1]);
}
