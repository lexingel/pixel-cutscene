import type { Img } from "./kit";

/** Draw src onto dst at (x, y): integer scale, nearest-neighbour, alpha over. Clipped to dst. */
export function blit(dst: Img, src: Img, x: number, y: number, scale = 1, flip = false): void {
  const { px: d } = dst, { px: s } = src;
  const y0 = Math.max(0, y), y1 = Math.min(dst.h, y + src.h * scale);
  const x0 = Math.max(0, x), x1 = Math.min(dst.w, x + src.w * scale);
  for (let dy = y0; dy < y1; dy++) {
    const sy = Math.floor((dy - y) / scale);
    for (let dx = x0; dx < x1; dx++) {
      let sx = Math.floor((dx - x) / scale);
      if (flip) sx = src.w - 1 - sx;
      const i = (sy * src.w + sx) * 4, j = (dy * dst.w + dx) * 4;
      const a = s[i + 3];
      if (a === 0) continue;
      if (a === 255) {
        d[j] = s[i]; d[j + 1] = s[i + 1]; d[j + 2] = s[i + 2]; d[j + 3] = 255;
        continue;
      }
      const k = 255 - a;
      d[j] = (s[i] * a + d[j] * k) / 255;
      d[j + 1] = (s[i + 1] * a + d[j + 1] * k) / 255;
      d[j + 2] = (s[i + 2] * a + d[j + 2] * k) / 255;
      d[j + 3] = a + (d[j + 3] * k) / 255;
    }
  }
}

export function fill(dst: Img, [r, g, b, a]: [number, number, number, number]): void {
  for (let j = 0; j < dst.px.length; j += 4) {
    dst.px[j] = r; dst.px[j + 1] = g; dst.px[j + 2] = b; dst.px[j + 3] = a;
  }
}

/** Fade towards black: alpha 0 leaves the image alone, 1 makes it black. */
export function fade(dst: Img, alpha: number): void {
  if (alpha <= 0) return;
  const k = 1 - Math.min(alpha, 1);
  for (let j = 0; j < dst.px.length; j += 4) {
    dst.px[j] *= k; dst.px[j + 1] *= k; dst.px[j + 2] *= k;
  }
}

/** A copy of the w x h rectangle at (x, y); parts outside img stay transparent. */
export function crop(img: Img, x: number, y: number, w: number, h: number): Img {
  const out: Img = { w, h, px: new Uint8ClampedArray(w * h * 4) };
  for (let r = 0; r < h; r++) {
    const sy = y + r;
    if (sy < 0 || sy >= img.h) continue;
    for (let c = 0; c < w; c++) {
      const sx = x + c;
      if (sx < 0 || sx >= img.w) continue;
      out.px.set(img.px.subarray((sy * img.w + sx) * 4, (sy * img.w + sx) * 4 + 4), (r * w + c) * 4);
    }
  }
  return out;
}

/**
 * src zoomed by z around (fx, fy), written at k output pixels per pixel into out (src.w*k x src.h*k).
 * With k > 1 every art pixel becomes a whole number of output pixels (z is rounded to steps of 1/k);
 * the view is pulled in so it never shows past the picture's edges.
 */
export function zoomFrame(src: Img, z: number, fx: number, fy: number, k: number, out: Uint8ClampedArray): void {
  const P = Math.max(1, k * z); // output pixels per art pixel: whole at a whole zoom, fractional (smooth) while zooming
  const W = src.w * k, H = src.h * k;
  const cl = (c: number, n: number) => { const half = (n * k) / (2 * P); return Math.min(Math.max(c, half), n - half); };
  const cx = cl(fx, src.w), cy = cl(fy, src.h);
  const s = new Uint32Array(src.px.buffer, src.px.byteOffset, src.w * src.h);
  const d = new Uint32Array(out.buffer, out.byteOffset, W * H);
  const col = Array.from({ length: W }, (_, X) => Math.min(src.w - 1, Math.max(0, Math.floor(cx + (X + 0.5 - W / 2) / P))));
  for (let Y = 0; Y < H; Y++) {
    const sy = Math.min(src.h - 1, Math.max(0, Math.floor(cy + (Y + 0.5 - H / 2) / P)));
    for (let X = 0; X < W; X++) d[Y * W + X] = s[sy * src.w + col[X]];
  }
}
