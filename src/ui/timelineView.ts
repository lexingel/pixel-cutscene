import type { Img } from "../core/kit";

/** The loudest sample in each of n equal buckets, 0..1: a waveform outline. */
export function peaks(d: Float32Array, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!d.length) return out;
  for (let i = 0; i < d.length; i++) {
    const b = Math.min(n - 1, Math.floor((i * n) / d.length));
    out[b] = Math.max(out[b], Math.abs(d[i]));
  }
  return out;
}

/** A bar starting at t, len long: moved so its start or end sits on the nearest edge within tol, if any. */
export function snapEdge(t: number, len: number, edges: number[], tol: number): { t: number; at?: number } {
  let best: { t: number; at: number; d: number } | null = null;
  for (const e of edges)
    for (const [d, nt] of [[Math.abs(e - t), e], [Math.abs(e - t - len), e - len]])
      if (d <= tol && (!best || d < best.d)) best = { t: nt, at: e, d };
  return best ? { t: best.t, at: best.at } : { t };
}

/** The box around a picture's non-transparent pixels, or null when it is empty. */
export function opaqueBox(im: Img): { x: number; y: number; w: number; h: number } | null {
  let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++)
    for (let x = 0; x < im.w; x++)
      if (im.px[(y * im.w + x) * 4 + 3]) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
