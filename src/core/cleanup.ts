import type { Img } from "./kit";

// Frame clean-up for generated sprite animations, ported from the local PixTools kit (speck_fix, fill_pinholes,
// palette_lock, ground_snap, clean_frames' binary alpha). Every step only removes, moves or recolours pixels; none draws.

const copy = (im: Img): Img => ({ w: im.w, h: im.h, px: new Uint8ClampedArray(im.px) });
const l1 = (p: Uint8ClampedArray, i: number, q: ArrayLike<number>, j: number) =>
  Math.abs(p[i] - q[j]) + Math.abs(p[i + 1] - q[j + 1]) + Math.abs(p[i + 2] - q[j + 2]);
const key = (p: Uint8ClampedArray, i: number) => (p[i] << 16) | (p[i + 1] << 8) | p[i + 2];

/** Alpha 128 and up becomes 255, the rest 0: kills the soft glow and smears a generator leaves at the edges. */
export function binaryAlpha(im: Img): { img: Img; n: number } {
  const img = copy(im);
  let n = 0;
  for (let i = 3; i < img.px.length; i += 4) {
    const a = img.px[i];
    if (a === 0 || a === 255) continue;
    img.px[i] = a >= 128 ? 255 : 0;
    n++;
  }
  return { img, n };
}

/** How often each opaque colour is used across these frames; one found in two or more frames counts as used everywhere. */
export function colourCounts(imgs: Img[]): Map<number, number> {
  const count = new Map<number, number>(), firstIn = new Map<number, number>();
  imgs.forEach((im, n) => {
    for (let i = 0; i < im.px.length; i += 4) {
      if (!im.px[i + 3]) continue;
      const k = key(im.px, i);
      if (!firstIn.has(k)) firstIn.set(k, n);
      // a generator's specks almost never repeat exactly in another frame; a drawn detail (an eye) does
      count.set(k, firstIn.get(k) === n ? (count.get(k) ?? 0) + 1 : Infinity);
    }
  });
  return count;
}

/**
 * A pixel unlike all its opaque neighbours (> tol) whose exact colour is rare (<= rare uses) takes their median; one with
 * no opaque neighbour goes. `count` defaults to this frame alone; pass the whole animation's so a one-pixel detail drawn
 * in every frame (an eye) counts as used, not as noise.
 */
export function speckFix(im: Img, tol = 120, rare = 2, count = colourCounts([im])): { img: Img; n: number } {
  const img = copy(im), { w, h } = im, src = im.px, px = img.px;
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!src[i + 3]) continue;
      const nb: number[] = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if ((dy || dx) && yy >= 0 && yy < h && xx >= 0 && xx < w && src[(yy * w + xx) * 4 + 3]) nb.push((yy * w + xx) * 4);
        }
      if (!nb.length) {
        px[i + 3] = 0;
        n++;
        continue;
      }
      if (count.get(key(src, i))! > rare || nb.length < 2 || !nb.every((j) => l1(src, i, src, j) > tol)) continue;
      for (let c = 0; c < 3; c++) {
        const v = nb.map((j) => src[j + c]).sort((a, b) => a - b), m = v.length >> 1;
        px[i + c] = v.length % 2 ? v[m] : Math.floor((v[m - 1] + v[m]) / 2);
      }
      n++;
    }
  return { img, n };
}

/** A transparent pixel whose four neighbours are all opaque takes their most common colour (ties: the darkest). */
export function fillPinholes(im: Img): { img: Img; n: number } {
  const img = copy(im), { w, h } = im, src = im.px;
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3]) continue;
      const nb = [i - w * 4, i + w * 4, i - 4, i + 4];
      if (!nb.every((j) => src[j + 3])) continue;
      const score = (j: number) => nb.filter((k) => key(src, k) === key(src, j)).length * 1000 - (src[j] + src[j + 1] + src[j + 2]);
      const best = nb.reduce((a, b) => (score(b) > score(a) ? b : a));
      img.px.set([src[best], src[best + 1], src[best + 2], 255], i);
      n++;
    }
  return { img, n };
}

/** Every opaque colour used by these frames. */
export function paletteOf(imgs: Img[]): number[][] {
  const s = new Map<number, number[]>();
  for (const im of imgs) for (let i = 0; i < im.px.length; i += 4) if (im.px[i + 3]) s.set(key(im.px, i), [im.px[i], im.px[i + 1], im.px[i + 2]]);
  return [...s.values()];
}

/** Opaque pixels within maxDist (L1) of a palette colour snap to the nearest one; farther ones (a real new colour) stay. */
export function paletteLock(im: Img, pal: number[][], maxDist = 60): { img: Img; n: number } {
  const img = copy(im), px = img.px, memo = new Map<number, number[] | null>();
  let n = 0;
  if (!pal.length) return { img, n };
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const k = key(px, i);
    let to = memo.get(k);
    if (to === undefined) {
      let best = pal[0], d = Infinity;
      for (const c of pal) {
        const e = l1(px, i, c, 0);
        if (e < d) (d = e), (best = c);
      }
      memo.set(k, (to = d > 0 && d <= maxDist ? best : null));
    }
    if (to) {
      px.set(to, i);
      n++;
    }
  }
  return { img, n };
}

const lowestRow = (im: Img) => {
  for (let y = im.h - 1; y >= 0; y--) for (let x = 0; x < im.w; x++) if (im.px[(y * im.w + x) * 4 + 3]) return y;
  return -1;
};

/** A frame whose lowest pixel floats above `feet` moves down onto it (whole pixels); frames on or below it stay. */
export function groundSnap(im: Img, feet: number): { img: Img; moved: number } {
  const low = lowestRow(im);
  if (low < 0 || low >= feet) return { img: copy(im), moved: 0 };
  const d = feet - low, img: Img = { w: im.w, h: im.h, px: new Uint8ClampedArray(im.px.length) };
  img.px.set(im.px.subarray(0, (im.h - d) * im.w * 4), d * im.w * 4);
  return { img, moved: d };
}

export type CleanReport = { alpha: number; specks: number; snapped: number; lowered: number; pinholes: number };

/**
 * The PixTools order: binary alpha, specks, palette lock (to the reference frames' colours), ground (onto the
 * reference's feet line, same-size frames only), pinholes. With no reference the palette and ground steps are skipped.
 */
export function cleanAnim(frames: Img[], ref: Img[] | null, ground: boolean): { frames: Img[]; report: CleanReport } {
  const report: CleanReport = { alpha: 0, specks: 0, snapped: 0, lowered: 0, pinholes: 0 };
  const pal = ref?.length ? paletteOf(ref) : [];
  const feet = ref?.length ? lowestRow(ref[0]) : -1;
  const solid = frames.map((f) => {
    const r = binaryAlpha(f);
    report.alpha += r.n;
    return r.img;
  });
  const count = colourCounts([...solid, ...(ref ?? [])]);
  const out = solid.map((f) => {
    let r = speckFix(f, 120, 2, count);
    report.specks += r.n;
    r = paletteLock(r.img, pal);
    report.snapped += r.n;
    let img = r.img;
    if (ground && feet >= 0 && f.w === ref![0].w && f.h === ref![0].h) {
      const g = groundSnap(img, feet);
      img = g.img;
      report.lowered += g.moved ? 1 : 0;
    }
    r = fillPinholes(img);
    report.pinholes += r.n;
    return r.img;
  });
  return { frames: out, report };
}
