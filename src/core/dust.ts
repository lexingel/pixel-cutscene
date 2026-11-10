import type { Img } from "./kit";

const PAD_X = 16, PAD_UP = 12; // the furthest a pixel drifts: (0.4 * 40) sideways, (0.4 * 30) up
const FADE = 0.4;
const ASH = [0x4a, 0x44, 0x40];

/** Integer hash of (seed, x, y) to [0, 1). No Math.random: same input, same bytes. */
export function seededRandom(seed: number, x: number, y: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(x + 1, 0x85ebca6b) ^ Math.imul(y + 1, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * The sprite at crumble progress u (0..1), in a canvas grown to hold drifting pixels.
 * (dx, dy) is where the canvas's top-left sits relative to the sprite's own top-left.
 */
export function crumble(img: Img, u: number, seed: number): { img: Img; dx: number; dy: number } {
  const { w, h } = img;
  const cw = w + 2 * PAD_X, ch = h + PAD_UP;
  const px = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = img.px[i + 3];
      if (a === 0) continue;
      const r = seededRandom(seed, x, y) * 0.6 + (1 - y / h) * 0.2;
      const end = Math.min(r + FADE, 1); // all gone by u = 1
      let ox = x, oy = y, alpha = a;
      if (u >= r) {
        const k = u - r;
        alpha = Math.round(a * Math.max(0, 1 - k / (end - r)));
        ox = x + Math.round(k * 40 * (seededRandom(seed + 7919, x, y) - 0.5) * 2);
        oy = y - Math.round(k * 30);
      }
      if (alpha <= 0) continue;
      const j = ((oy + PAD_UP) * cw + ox + PAD_X) * 4;
      if (alpha < px[j + 3]) continue;
      px[j] = img.px[i]; px[j + 1] = img.px[i + 1]; px[j + 2] = img.px[i + 2]; px[j + 3] = alpha;
    }
  }
  // ash on the feet line: grows in while the sprite breaks up, full at u = 0.5, gone at u = 1
  const ashA = Math.round(255 * (u <= 0.5 ? u / 0.5 : Math.max(0, (1 - u) / 0.5)));
  if (ashA > 0) {
    for (let x = 0; x < w; x++) {
      const j = ((h - 1 + PAD_UP) * cw + x + PAD_X) * 4;
      if (px[j + 3] >= ashA) continue; // never on top of a pixel still standing
      px[j] = ASH[0]; px[j + 1] = ASH[1]; px[j + 2] = ASH[2]; px[j + 3] = ashA;
    }
  }
  return { img: { w: cw, h: ch, px }, dx: -PAD_X, dy: -PAD_UP };
}
