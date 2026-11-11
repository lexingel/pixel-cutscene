import { ANIM_FPS, pose, shotAt } from "./acting";
import { camAt, round } from "./cam";
import { crumble, hashString } from "./dust";
import { charFrames } from "./frames";
import { assetStatus, faceStatus, type Img, type Kit } from "./kit";
import { mouthAt } from "./mouth";
import { blit, crop, fade, fill } from "./raster";
import { bubblesAt, drawBox, drawBubble } from "./bubbles";
import type { FxEntry, Shot, Timeline } from "./types";
import { sceneTime } from "./timewarp";

export type RenderInput = {
  tl: Timeline;
  kit: Kit;
  img: (path: string) => Img | null;
  draft: boolean;
  W: number;
  H: number;
  mark?: boolean; // false: a draft is stamped later (an exported slice gets its mark after the cut)
};

// 5x7 glyphs for the watermark, one string per row.
const GLYPHS: Record<string, string[]> = {
  D: ["1111.", "1...1", "1...1", "1...1", "1...1", "1...1", "1111."],
  R: ["1111.", "1...1", "1...1", "1111.", "1.1..", "1..1.", "1...1"],
  A: [".111.", "1...1", "1...1", "11111", "1...1", "1...1", "1...1"],
  F: ["11111", "1....", "1....", "1111.", "1....", "1....", "1...."],
  T: ["11111", "..1..", "..1..", "..1..", "..1..", "..1..", "..1.."],
};

export function watermark(out: Img): void {
  // small, top-right: the action is usually low in the frame (feet on the floor)
  const k = Math.max(1, Math.floor(out.h / 180));
  const x0 = out.w - 4 * k - 29 * k, y0 = 4 * k;
  [..."DRAFT"].forEach((ch, n) => {
    GLYPHS[ch].forEach((row, gy) => {
      for (let gx = 0; gx < 5; gx++) {
        if (row[gx] !== "1") continue;
        const x = x0 + (n * 6 + gx) * k, y = y0 + gy * k;
        for (let dy = 0; dy < k; dy++) {
          for (let dx = 0; dx < k; dx++) {
            const px = x + dx, py = y + dy;
            if (px >= 0 && py >= 0 && px < out.w && py < out.h) out.px.set([255, 255, 255, 255], (py * out.w + px) * 4);
          }
        }
      }
    });
  });
}

/** Every visible pixel mixed half and half with a colour, alpha kept: the sprite still shows through. */
function tint(img: Img, c: number[]): Img {
  const px = new Uint8ClampedArray(img.px);
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0) for (let k = 0; k < 3; k++) px[i + k] = Math.round((px[i + k] + c[k]) / 2);
  return { w: img.w, h: img.h, px };
}

function mirror(img: Img): Img {
  const px = new Uint8ClampedArray(img.px.length);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    px.set(img.px.subarray((y * img.w + img.w - 1 - x) * 4, (y * img.w + img.w - x) * 4), (y * img.w + x) * 4);
  }
  return { w: img.w, h: img.h, px };
}

type FxLive = FxEntry & { dur?: number; hold?: boolean }; // stage.gd also reads dur and hold

const LAYER: Record<string, number> = { back: -1, "": 0, front: 1 };
export const SHADOW_ALPHA = 0.35;
/** A ground shadow's half width and half height for a sprite this tall (constant per character, so it never flickers). */
export const shadowSize = (h: number) => {
  const rx = Math.max(3, Math.round(h / 8));
  return { rx, ry: Math.max(1, Math.round(rx / 3)) };
};
/** A flat pixel oval darkening the ground under feet (x, y); `k` fades it (a crumbling actor). Mirrors stage.gd. */
function shadow(out: Img, x: number, y: number, h: number, k: number): void {
  const { rx, ry } = shadowSize(h);
  const keep = 1 - SHADOW_ALPHA * k;
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy / (ry + 1)) ** 2));
    const yy = y + dy;
    if (yy < 0 || yy >= out.h) continue;
    for (let xx = Math.max(0, x - half); xx <= Math.min(out.w - 1, x + half); xx++) {
      const i = (yy * out.w + xx) * 4;
      for (let c = 0; c < 3; c++) out.px[i + c] = Math.round(out.px[i + c] * keep);
    }
  }
}

/** One frame at time t, a pure function of (timeline, kit, t). Mirrors stage.gd seek(). */
export function renderFrame(p: RenderInput, t: number, out: Img): void {
  const { tl, draft } = p;
  const outT = Math.min(Math.max(t, 0), tl.duration);
  t = sceneTime(tl, outT); // a time effect picks which moment is on screen
  const shot = shotAt(tl, t);
  drawShot(p, shot, t, out);

  const into = t - shot.start, left = shot.end - t;
  // how the shot comes in: from the shot before (dissolve, wipe) or out of black (iris); hard pixel edges, no new colours
  const tr = shot.transition, i = tl.shots.indexOf(shot);
  if (tr && into < tr.dur) {
    const k = into / tr.dur;
    if (tr.kind === "iris") iris(out, k);
    else if (i > 0) {
      const prev: Img = { w: out.w, h: out.h, px: new Uint8ClampedArray(out.px.length) };
      drawShot(p, tl.shots[i - 1], t, prev);
      for (let y = 0; y < out.h; y++)
        for (let x = 0; x < out.w; x++) {
          const showNew = tr.kind === "wipe" ? x < k * out.w : (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 < k;
          if (!showNew) for (let c = 0, j = (y * out.w + x) * 4; c < 4; c++) out.px[j + c] = prev.px[j + c];
        }
    }
  }
  if ((shot.iris_out ?? 0) > 0 && left < shot.iris_out!) iris(out, left / shot.iris_out!);
  const aIn = (shot.fade_in ?? 0) > 0 ? 1 - into / shot.fade_in! : 0;
  const aOut = (shot.fade_out ?? 0) > 0 ? 1 - left / shot.fade_out! : 0;
  fade(out, Math.min(Math.max(aIn, aOut, 0), 1));
  const aFlash = (shot.flash ?? 0) > 0 ? 1 - into / shot.flash! : 0;
  if (aFlash > 0) for (let j = 0; j < out.px.length; j += 4) for (let c = 0; c < 3; c++) out.px[j + c] += (255 - out.px[j + c]) * aFlash;
  const bar = Math.min(tl.letterbox ?? 0, out.h >> 1) * out.w * 4; // cinema bars over everything but the draft mark
  if (bar) for (const [a, b] of [[0, bar], [out.px.length - bar, out.px.length]]) for (let j = a; j < b; j += 4) out.px.fill(0, j, j + 3);
  if (draft && p.mark !== false && !frameZoom(p, outT)) watermark(out); // a zoomed frame gets its mark after the zoom (exporter), at its normal size
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // 4x4 ordered dither thresholds
/** Black outside a circle in the middle whose radius is k of the way to the corners. */
function iris(out: Img, k: number): void {
  const cx = out.w / 2, cy = out.h / 2, r2 = (k * Math.hypot(cx, cy)) ** 2;
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++)
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r2) out.px.fill(0, (y * out.w + x) * 4, (y * out.w + x) * 4 + 3);
}

/** One shot's picture at scene time t: background, actors, effects and speech (no fades or transitions). */
function drawShot(p: RenderInput, shot: Shot, t: number, out: Img): void {
  const { tl, kit, draft } = p;
  const has = (path: string) => p.img(path) !== null;
  const asset = (id: string) => (assetStatus(kit, id, draft, has) === "ok" ? kit.assets[id] : null);
  const assetImg = (id: string) => {
    const a = asset(id);
    return a ? p.img(a.path) : null;
  };
  fill(out, [0, 0, 0, 255]);
  if (shot.type === "closeup") {
    const bd = assetImg(shot.bg ?? "");
    if (bd) {
      const k = Math.max(Math.ceil(p.W / bd.w), Math.ceil(p.H / bd.h)); // smallest whole scale that covers
      blit(out, bd, Math.trunc((p.W - bd.w * k) / 2), Math.trunc((p.H - bd.h * k) / 2), k);
    }
    const fp = faceStatus(kit, shot.face, shot.expr, draft, has) === "ok" ? kit.faces[shot.face][shot.expr] : null;
    const m = fp?.mouths?.length ? mouthAt(tl, shot.face, t, fp.mouths.length) : null;
    const face = fp ? (m !== null && p.img(fp.mouths![m])) || p.img(fp.path) : null;
    if (face) {
      const k = tl.closeup_scale ?? 3;
      blit(out, face, Math.trunc((p.W - face.w * k) / 2), p.H - face.h * k, k);
    }
    for (const b of bubblesAt(tl, t, kit)) drawBox(out, b); // a close-up has no head to point at
  } else {
    const cam = camAt(shot.camera, t);
    const into = t - shot.start, sk = shot.shake ?? 0;
    if (into < sk) { // a quick tremor that dies away; a pure function of t
      const a = 3 * (1 - into / sk);
      cam.x += round(Math.sin(into * 71) * a);
      cam.y += round(Math.cos(into * 53) * a * 0.6);
    }
    const k = shot.bg_scale ?? 1;
    // a parallax layer at f times the camera, repeated across: far (0.5) behind the bg's see-through sky, near (1.5) over the actors
    const layer = (id: string | undefined, f: number) => {
      const im = assetImg(id ?? "");
      if (!im) return;
      const w = im.w * k, y = -round(cam.y * f);
      for (let x = -(((round(cam.x * f) % w) + w) % w); x < out.w; x += w) blit(out, im, x, y, k);
    };
    layer(shot.far, 0.5);
    const bg = assetImg(shot.bg ?? "");
    if (bg) blit(out, bg, -cam.x, -cam.y, k);

    const frames = charFrames(kit, p.img, draft, has);
    const posed = tl.actors
      .map((a) => ({ id: a.id, layer: a.layer, q: pose(a, t, frames) }))
      .filter((e) => e.q !== null && e.q.img !== null)
      .sort((a, b) => LAYER[a.layer ?? ""] - LAYER[b.layer ?? ""] || a.q!.feet.y - b.q!.feet.y); // stable: ties keep timeline order
    if (tl.shadows) for (const { q } of posed) shadow(out, q!.feet.x - cam.x, q!.feet.y - cam.y, q!.img!.h, 1 - (q!.dust ?? 0));
    for (const { id, q } of posed) {
      const x = q!.drawX + q!.shake - cam.x, y = q!.drawY - cam.y;
      let img = q!.img!;
      if (q!.flash) img = tint(img, [255, 59, 59]);
      if (q!.dust !== null) {
        const c = crumble(q!.flip ? mirror(img) : img, q!.dust, hashString(id));
        blit(out, c.img, x + c.dx, y + c.dy);
      } else blit(out, img, x, y, 1, q!.flip);
    }

    layer(shot.near, 1.5);
    const fx = tl.fx.flatMap((f) => fxFrame(p, f as FxLive, t, cam, asset) ?? []);
    if (shot.grade || shot.vignette) light(out, shot.grade, shot.vignette, shot.grade ? fx.map((f) => ({ x: f.x + f.img.w / 2, y: f.y + f.img.h / 2 })) : []);
    for (const f of fx) blit(out, f.img, f.x, f.y, 1, f.flip); // effects glow: drawn over the grade
    // speech over everything in the scene: a bubble over the speaker's head (top of the sprite, else 40 px over the feet)
    for (const b of bubblesAt(tl, t, kit)) {
      const a = b.style === "bubble" && b.actor ? tl.actors.find((x) => x.id === b.actor) : undefined;
      const q = a ? pose(a, t, frames) : null;
      if (q && !q.gone) drawBubble(out, b, q.feet.x - cam.x, (q.img ? q.drawY : q.feet.y - 40) - cam.y);
      else drawBox(out, b);
    }
  }
}

/** The zoom at t in this shot (1 when it has none). */
export function zoomAt(s: Shot, t: number): number {
  if (s.type !== "wide" || !s.zoom) return 1;
  const u = Math.min(Math.max((t - s.start) / Math.max(s.end - s.start, 0.0001), 0), 1);
  return s.zoom.from + (s.zoom.to - s.zoom.from) * u * u * (3 - 2 * u);
}
/** Where a close-up centres on a posed actor, in frame pixels: their middle, a little above (the face reads). */
export const actorFocus = (q: { drawX: number; drawY: number; img: Img }, cam: { x: number; y: number }) =>
  ({ x: q.drawX + q.img.w / 2 - cam.x, y: q.drawY + q.img.h * 0.35 - cam.y });
/** What zoomFrame needs for the frame at t, or null when the shot is not zoomed. A zoom with an actor follows them. */
export function frameZoom(p: RenderInput, t: number): { z: number; x: number; y: number } | null {
  const { tl } = p;
  if (!tl.shots.length) return null;
  t = sceneTime(tl, Math.min(Math.max(t, 0), tl.duration)); // output time in, like renderFrame
  const s = shotAt(tl, t);
  const z = zoomAt(s, t);
  if (s.type !== "wide" || !s.zoom || z === 1) return null;
  const a = s.zoom.actor ? tl.actors.find((x) => x.id === s.zoom!.actor) : undefined;
  if (a) {
    const has = (path: string) => p.img(path) !== null;
    const q = pose(a, t, charFrames(p.kit, p.img, p.draft, has));
    if (q?.img) return { z, ...actorFocus(q as { drawX: number; drawY: number; img: Img }, camAt(s.camera, t)) };
  }
  return { z, x: s.zoom.x, y: s.zoom.y };
}

type FxMeta = NonNullable<Kit["assets"][string]["fx"]>;
/** A looping effect added from the library lasts this long until the user drags its end. */
export const LOOP_FX_DUR = 2;
export const newFxDur = (meta: FxMeta): number | undefined => (meta.loop ? LOOP_FX_DUR : undefined);
/** When an effect stops showing: its set duration, else a one-shot's last frame, else (an older loop) the scene's end. */
export const fxEnd = (f: { t: number; dur?: number }, meta: FxMeta, sceneEnd: number): number =>
  f.dur !== undefined ? f.t + f.dur : meta.loop ? sceneEnd : f.t + meta.frames / (meta.fps || ANIM_FPS);

const GRADES: Record<string, (r: number, g: number, b: number) => [number, number, number]> = {
  night: (r, g, b) => [r * 0.3, g * 0.4, b * 0.7 + 12],
  dusk: (r, g, b) => [r * 0.95 + 8, g * 0.68, b * 0.62],
  cold: (r, g, b) => [r * 0.72, g * 0.86, b + 10],
  sepia: (r, g, b) => {
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    return [l * 1.07 + 12, l * 0.9 + 6, l * 0.66];
  },
};
const LIGHT_R = 40; // how far an effect lights a graded scene, in pixels
/** The grade (one colour to one colour), less where an effect is near (the inner part fully, then a dither), then the vignette. */
function light(out: Img, grade: string | undefined, vignette: boolean | undefined, lights: { x: number; y: number }[]): void {
  const g = grade ? GRADES[grade] : null, cx = out.w / 2, cy = out.h / 2;
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const j = (y * out.w + x) * 4, th = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      if (g) {
        let lit = 0;
        for (const l of lights) lit = Math.max(lit, Math.min(1, 1.5 * (1 - Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y) / LIGHT_R)));
        if (lit <= th) {
          const c = g(out.px[j], out.px[j + 1], out.px[j + 2]);
          for (let k = 0; k < 3; k++) out.px[j + k] = Math.round(c[k]);
        }
      }
      if (vignette && (Math.hypot((x + 0.5 - cx) / cx, (y + 0.5 - cy) / cy) - 0.8) / 0.45 > th)
        for (let k = 0; k < 3; k++) out.px[j + k] = Math.round(out.px[j + k] * 0.55);
    }
}

/** An effect's picture at t and where it goes on the frame; null while it is not showing. */
function fxFrame(
  p: RenderInput, f: FxLive, t: number, cam: { x: number; y: number },
  asset: (id: string) => Kit["assets"][string] | null,
): { img: Img; x: number; y: number; flip: boolean } | null {
  const a = asset(f.fx);
  const meta = a?.fx;
  const sheet = a && meta ? p.img(a.path) : null;
  if (!a || !meta || !sheet) return null;
  const i = Math.floor((t - f.t) * (meta.fps || ANIM_FPS) + 0.0001);
  const within = f.dur === undefined || t < f.t + f.dur;
  if (i < 0 || !within || !(meta.loop || i < meta.frames || f.hold)) return null;
  const n = meta.loop ? ((i % meta.frames) + meta.frames) % meta.frames : Math.min(i, meta.frames - 1);
  const fw = sheet.w / meta.cols, fh = sheet.h / Math.ceil(meta.frames / meta.cols);
  const frame = crop(sheet, (n % meta.cols) * fw, Math.floor(n / meta.cols) * fh, fw, fh);
  const ox = f.flip ? fw - 1 - meta.dx : meta.dx; // mirrored about the origin column
  return { img: frame, x: round(f.x) - ox - cam.x, y: round(f.y) - meta.dy - cam.y, flip: !!f.flip };
}
