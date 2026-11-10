import type { Img } from "./kit";

export const KNOWN_ANIMS = ["idle", "walk", "run", "attack", "skill", "hurt", "death", "windup", "cast"];
const A = KNOWN_ANIMS.join("|");
const reSuffix = new RegExp(`_(${A})_([0-9]+)[.]png$`, "i");
const reBare = new RegExp(`^(${A})[_-]?([0-9]+)[.]png$`, "i");

// Maps file paths to animation names (folder, then `<x>_<anim>_<n>.png`, then `<anim><n>.png`, `<anim>_<n>.png`, `<anim>-<n>.png`); the rest go to "?".
export function guessAnims(paths: string[]): Record<string, string[]> {
  const found: Record<string, { p: string; n: number }[]> = {};
  for (const p of paths) {
    const parts = p.split(/[/\\]/);
    const file = parts[parts.length - 1];
    const folder = parts.length > 1 ? parts[parts.length - 2].toLowerCase() : "";
    let anim = "?", n = 0;
    let m: RegExpMatchArray | null;
    if (KNOWN_ANIMS.includes(folder)) {
      anim = folder;
      n = Number(file.match(/(\d+)\.[^.]*$/)?.[1] ?? 0);
    } else if ((m = file.match(reSuffix))) [anim, n] = [m[1].toLowerCase(), Number(m[2])];
    else if ((m = file.match(reBare))) [anim, n] = [m[1].toLowerCase(), Number(m[2])];
    (found[anim] ??= []).push({ p, n });
  }
  const out: Record<string, string[]> = {};
  for (const [a, l] of Object.entries(found)) out[a] = l.sort((x, y) => x.n - y.n || (x.p < y.p ? -1 : 1)).map((f) => f.p);
  return out;
}

const same = (a: Uint8ClampedArray, i: number, j: number) =>
  (a[i + 3] === 0 && a[j + 3] === 0) || (a[i] === a[j] && a[i + 1] === a[j + 1] && a[i + 2] === a[j + 2] && a[i + 3] === a[j + 3]);

function uniform(img: Img, k: number): boolean {
  if (img.w % k || img.h % k) return false;
  const { w, h, px } = img;
  for (let by = 0; by < h; by += k)
    for (let bx = 0; bx < w; bx += k) {
      const o = (by * w + bx) * 4;
      for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) if (!same(px, o, ((by + y) * w + bx + x) * 4)) return false;
    }
  return true;
}

// Largest k <= 8 where every aligned k*k block is one colour; 1 if none.
export function gridScale(img: Img): number {
  for (let k = 8; k > 1; k--) if (uniform(img, k)) return k;
  return 1;
}

export function downscale(img: Img, k: number): Img {
  const w = Math.floor(img.w / k), h = Math.floor(img.h / k);
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * k * img.w + x * k) * 4;
      px.set(img.px.subarray(s, s + 4), (y * w + x) * 4);
    }
  return { w, h, px };
}

function colours(img: Img): number {
  const s = new Set<number>();
  for (let i = 0; i < img.px.length; i += 4)
    s.add(img.px[i + 3] === 0 ? 0 : ((img.px[i] << 24) | (img.px[i + 1] << 16) | (img.px[i + 2] << 8) | img.px[i + 3]) >>> 0 || 1);
  return s.size;
}

const blank = (img: Img) => {
  for (let i = 4; i < img.px.length; i += 4) if (!same(img.px, 0, i)) return false;
  return true;
};

export function checkSprite(imgs: Img[]): { ok: true; scale: number } | { ok: false; reason: string } {
  // blank/single-colour frames (hurt flashes, blinks) are uniform at any k, so they say nothing about scale
  const real = imgs.filter((i) => !blank(i));
  const scales = real.map(gridScale);
  const scale = scales[0] ?? 1;
  if (scales.some((s) => s !== scale)) return { ok: false, reason: "frames are drawn at different pixel sizes" };
  if (scale === 1 && real.some((i) => colours(i) > 4096)) return { ok: false, reason: "this doesn't look like pixel art" };
  return { ok: true, scale };
}
