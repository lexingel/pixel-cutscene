import { ANIM_FPS, pose, shotAt } from "./acting";
import { camAt, round } from "./cam";
import { animStatus, assetStatus, faceStatus, type Img, type Kit } from "./kit";
import { blit, crop, fade, fill } from "./raster";
import type { FxEntry, Timeline } from "./types";

export type RenderInput = {
  tl: Timeline;
  kit: Kit;
  img: (path: string) => Img | null;
  draft: boolean;
  W: number;
  H: number;
};

// 5x7 glyphs for the watermark, one string per row.
const GLYPHS: Record<string, string[]> = {
  D: ["1111.", "1...1", "1...1", "1...1", "1...1", "1...1", "1111."],
  R: ["1111.", "1...1", "1...1", "1111.", "1.1..", "1..1.", "1...1"],
  A: [".111.", "1...1", "1...1", "11111", "1...1", "1...1", "1...1"],
  F: ["11111", "1....", "1....", "1111.", "1....", "1....", "1...."],
  T: ["11111", "..1..", "..1..", "..1..", "..1..", "..1..", "..1.."],
};

function watermark(out: Img): void {
  const k = Math.max(1, Math.floor(out.h / 60));
  const x0 = 4 * k, y0 = out.h - 4 * k - 7 * k;
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

type FxLive = FxEntry & { dur?: number; hold?: boolean }; // stage.gd also reads dur and hold

/** One frame at time t, a pure function of (timeline, kit, t). Mirrors stage.gd seek(). */
export function renderFrame(p: RenderInput, t: number, out: Img): void {
  const { tl, kit, draft } = p;
  const has = (path: string) => p.img(path) !== null;
  const asset = (id: string) => (assetStatus(kit, id, draft, has) === "ok" ? kit.assets[id] : null);
  const assetImg = (id: string) => {
    const a = asset(id);
    return a ? p.img(a.path) : null;
  };
  t = Math.min(Math.max(t, 0), tl.duration);
  fill(out, [0, 0, 0, 255]);
  const shot = shotAt(tl, t);

  if (shot.type === "closeup") {
    const bd = assetImg(shot.bg ?? "");
    if (bd) {
      const k = Math.max(Math.ceil(p.W / bd.w), Math.ceil(p.H / bd.h)); // smallest whole scale that covers
      blit(out, bd, Math.trunc((p.W - bd.w * k) / 2), Math.trunc((p.H - bd.h * k) / 2), k);
    }
    const face = faceStatus(kit, shot.face, shot.expr, draft, has) === "ok" ? p.img(kit.faces[shot.face][shot.expr].path) : null;
    if (face) {
      const k = tl.closeup_scale ?? 3;
      blit(out, face, Math.trunc((p.W - face.w * k) / 2), p.H - face.h * k, k);
    }
  } else {
    const cam = camAt(shot.camera, t);
    const bg = assetImg(shot.bg ?? "");
    if (bg) blit(out, bg, -cam.x, -cam.y, shot.bg_scale ?? 1);

    const frames = (char: string, anim: string): Img[] =>
      animStatus(kit, char, anim, draft, has) === "ok" ? kit.chars[char].anims[anim].frames.map((f) => p.img(f)!) : [];
    const posed = tl.actors
      .map((a) => pose(a, t, frames))
      .filter((q) => q !== null && q.img !== null)
      .sort((a, b) => a!.feet.y - b!.feet.y); // stable: ties keep timeline order
    for (const q of posed) blit(out, q!.img!, q!.drawX - cam.x, q!.drawY - cam.y, 1, q!.flip);

    for (const f of tl.fx) drawFx(p, f as FxLive, t, cam, out, asset);
  }

  const into = t - shot.start, left = shot.end - t;
  const aIn = (shot.fade_in ?? 0) > 0 ? 1 - into / shot.fade_in! : 0;
  const aOut = (shot.fade_out ?? 0) > 0 ? 1 - left / shot.fade_out! : 0;
  fade(out, Math.min(Math.max(aIn, aOut, 0), 1));
  if (draft) watermark(out);
}

function drawFx(
  p: RenderInput, f: FxLive, t: number, cam: { x: number; y: number }, out: Img,
  asset: (id: string) => Kit["assets"][string] | null,
): void {
  const a = asset(f.fx);
  const meta = a?.fx;
  const sheet = a && meta ? p.img(a.path) : null;
  if (!a || !meta || !sheet) return;
  const i = Math.floor((t - f.t) * (meta.fps || ANIM_FPS) + 0.0001);
  const within = f.dur === undefined || t < f.t + f.dur;
  if (i < 0 || !within || !(meta.loop || i < meta.frames || f.hold)) return;
  const n = meta.loop ? ((i % meta.frames) + meta.frames) % meta.frames : Math.min(i, meta.frames - 1);
  const fw = sheet.w / meta.cols, fh = sheet.h / Math.ceil(meta.frames / meta.cols);
  const frame = crop(sheet, (n % meta.cols) * fw, Math.floor(n / meta.cols) * fh, fw, fh);
  blit(out, frame, round(f.x) - meta.dx - cam.x, round(f.y) - meta.dy - cam.y);
}
