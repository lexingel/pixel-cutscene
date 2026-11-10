import type { Img } from "./kit";

/** Scale2x (EPX): every pixel becomes 2x2; corners copy a neighbour only where an edge turns. No new colours. */
export function scale2x(src: Img): Img {
  const { w, h, px } = src;
  const out = new Uint8ClampedArray(w * h * 16);
  const p = (x: number, y: number) => ((Math.min(Math.max(y, 0), h - 1)) * w + Math.min(Math.max(x, 0), w - 1)) * 4;
  const same = (a: number, b: number) => px[a] === px[b] && px[a + 1] === px[b + 1] && px[a + 2] === px[b + 2] && px[a + 3] === px[b + 3];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const E = p(x, y), B = p(x, y - 1), D = p(x - 1, y), F = p(x + 1, y), H = p(x, y + 1);
      const edge = !same(B, H) && !same(D, F);
      const corner = [edge && same(D, B) ? D : E, edge && same(B, F) ? F : E, edge && same(D, H) ? D : E, edge && same(H, F) ? F : E];
      corner.forEach((s, i) => out.set(px.subarray(s, s + 4), ((y * 2 + (i >> 1)) * w * 2 + x * 2 + (i & 1)) * 4));
    }
  }
  return { w: w * 2, h: h * 2, px: out };
}
