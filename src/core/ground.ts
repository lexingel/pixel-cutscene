import type { Img } from "./kit";

/**
 * Where feet stand on a side-view background: halfway down the floor strip along its bottom. The strip is the run
 * of rows, from the bottom up, whose mean colour stays near the strip's own mean (texture and specks average out).
 * None when the strip reaches above 40% of the height (a wall or one colour, not a floor) or the bottom is see-through.
 */
// ponytail: row-mean heuristic, checked on the sample, test field and several painted game backdrops; a perspective floor
// with strong tile lines can stop early (feet a little low). Upgrade: let the user drag the ground line (already editable).
export function findGround(im: Img, tol = 45): number | undefined {
  const row = (y: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = 0; x < im.w; x++) {
      const i = (y * im.w + x) * 4;
      if (im.px[i + 3] > 127) { r += im.px[i]; g += im.px[i + 1]; b += im.px[i + 2]; n++; }
    }
    return n ? [r / n, g / n, b / n] : null;
  };
  const last = row(im.h - 1);
  if (!last) return undefined;
  let band = last, n = 1, top = im.h - 1;
  for (let y = im.h - 2; y >= 0; y--) {
    const r = row(y);
    if (!r || Math.abs(r[0] - band[0]) + Math.abs(r[1] - band[1]) + Math.abs(r[2] - band[2]) > tol) break;
    band = band.map((c, k) => (c * n + r[k]) / (n + 1));
    n++;
    top = y;
  }
  return top < im.h * 0.4 ? undefined : top + ((im.h - top) >> 1);
}
