import { GIFEncoder, applyPalette, quantize } from "gifenc";
import type { Img } from "../core/kit";
import { missingReport } from "../core/missing";
import type { Project } from "../core/project";
import { frameZoom, renderFrame, watermark } from "../core/render";
import { zoomFrame } from "../core/raster";
import { decode } from "../ui/cast";
import { MIX_RATE, decodeAudio, mixAudio } from "./audioMix";
import { openSink, pickCodec, type Container, type Quality } from "./encode";

export type ExportKind = "full" | "loop-webm" | "loop-gif";
export type ExportOpts = {
  draft: boolean;
  range?: [number, number]; // seconds; loops only
  kind?: ExportKind;
  onProgress(f: number): void;
  signal: AbortSignal;
  quality?: Quality; // full only: "share" makes a much smaller file
  slice?: { cx: number; out: [number, number] }; // full only: a 1080x1920 or 1080x1080 video of the scene slice centred on cx
};

/** A video of another shape (9:16, 1:1) from a W x H scene: a cw-wide slice at a whole scale k, centred in outW x outH on black. */
export function sliceFit(W: number, H: number, outW: number, outH: number) {
  const cw = Math.min(W, 2 * Math.round((H * outW) / outH / 2)); // even, so the slice and its offsets stay even
  const k = Math.max(1, Math.min(Math.floor(outW / cw), Math.floor(outH / H)));
  const even = (n: number) => 2 * Math.floor(n / 4);
  return { outW, outH, cw, k, ox: even(outW - cw * k), oy: even(outH - H * k), sliceX: (cx: number) => Math.min(W - cw, Math.max(0, Math.round(cx - cw / 2))) };
}

/** Copies the w x h rectangle at (x0, 0) of an sw-wide RGBA image onto dst (dw wide) at (ox, oy); the rest is black. */
export const verticalFit = (W: number, H: number) => sliceFit(W, H, 1080, 1920);

export function cropInto(src: Uint8ClampedArray, sw: number, x0: number, w: number, h: number, dst: Uint8ClampedArray, dw: number, ox: number, oy: number): Uint8ClampedArray {
  new Uint32Array(dst.buffer, dst.byteOffset, dst.length / 4).fill(new Uint32Array(new Uint8ClampedArray([0, 0, 0, 255]).buffer)[0]);
  for (let y = 0; y < h; y++) dst.set(src.subarray((y * sw + x0) * 4, (y * sw + x0 + w) * 4), ((oy + y) * dw + ox) * 4);
  return dst;
}

export class MissingError extends Error {
  constructor(public missing: ReturnType<typeof missingReport>) {
    super(`The export needs these first: ${missing.map((m) => `${m.what} (${m.why})`).join(", ")}.`);
  }
}

const FPS = 30, GIF_FPS = 15;
const tick = () => new Promise((r) => setTimeout(r, 0)); // let the page breathe between frames

/** Nearest-neighbour ×k: each native pixel becomes a k×k block. */
export function upscale(src: Img, k: number, out: Uint8ClampedArray): Uint8ClampedArray {
  const s = new Uint32Array(src.px.buffer, src.px.byteOffset, src.w * src.h);
  const d = new Uint32Array(out.buffer, out.byteOffset, out.length / 4);
  const W = src.w * k;
  for (let y = 0; y < src.h; y++) {
    const row = y * k * W;
    for (let x = 0; x < src.w; x++) d.fill(s[y * src.w + x], row + x * k, row + x * k + k);
    for (let r = 1; r < k; r++) d.copyWithin(row + r * W, row, row + W);
  }
  return out;
}

/** Exact palette while a frame has at most 256 colours (pixel art nearly always does), else quantized. Never dithered. */
function indexed(px: Uint8ClampedArray) {
  const u = new Uint32Array(px.buffer, px.byteOffset, px.length / 4);
  const seen = new Map<number, number>();
  const index = new Uint8Array(u.length);
  for (let i = 0; i < u.length; i++) {
    let c = seen.get(u[i]);
    if (c === undefined) {
      if (seen.size === 256) {
        const palette = quantize(px, 256);
        return { palette, index: applyPalette(px, palette) };
      }
      seen.set(u[i], (c = seen.size));
    }
    index[i] = c;
  }
  return { palette: [...seen.keys()].map((v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255]), index };
}

/** Renders the scene offline, frame by frame, and encodes it. Resolves only with a complete file. */
export async function exportVideo(p: Project, opts: ExportOpts, codec?: Container): Promise<Blob> {
  const tl = p.tl;
  if (!tl || !tl.shots.length) throw new Error("There is no scene to export yet. Build one in ③ Tweak.");
  const has = (path: string) => p.files.has(path);
  if (!opts.draft) {
    const missing = missingReport(tl, p.kit, false, has);
    if (missing.length) throw new MissingError(missing);
  }
  const kind = opts.kind ?? "full";
  const [a, b] = kind === "full" ? [0, tl.duration] : (opts.range ?? [0, tl.duration]);
  if (!(a >= 0 && b <= tl.duration && b > a)) throw new Error(`Pick a range inside 0 to ${tl.duration} s, with From before To.`);
  const fps = kind === "loop-gif" ? GIF_FPS : FPS;
  const n = Math.max(1, Math.round((b - a) * fps));
  const { W, H } = p.canvas;
  const vert = kind === "full" && opts.slice ? sliceFit(W, H, ...opts.slice.out) : null;
  const k = vert ? vert.k : kind === "full" ? p.canvas.exportScale : 1; // loops stay at native size
  const abort = () => new DOMException("The export was cancelled.", "AbortError");

  const imgs = new Map<string, Img>();
  for (const [path, blob] of p.files) {
    if (!/\.png$/i.test(path)) continue;
    try {
      imgs.set(path, await decode(blob));
    } catch {
      /* an unreadable picture renders as missing, as in the preview */
    }
  }
  const input = { tl, kit: p.kit, img: (path: string) => imgs.get(path) ?? null, draft: opts.draft, W, H, mark: !vert };
  const native: Img = { w: W, h: H, px: new Uint8ClampedArray(W * H * 4) };
  const big = k === 1 ? native.px : new Uint8ClampedArray(W * k * H * k * 4);
  const zoomed = new Uint8ClampedArray(W * k * H * k * 4);
  // the frame at time t, zoomed if its shot zooms; at k output pixels per pixel
  const frameAt = (t: number, kk: number) => {
    renderFrame(input, t, native);
    const z = frameZoom(input, t);
    if (z) {
      zoomFrame(native, z.z, z.x, z.y, kk, zoomed, kk === k && kind === "full" ? p.canvas.exportScale : kk); // zoom steps as in the preview, at any output scale
      if (input.draft && !vert) watermark({ w: W * kk, h: H * kk, px: zoomed.subarray(0, W * kk * H * kk * 4) });
      return zoomed;
    }
    return kk === 1 ? native.px : upscale(native, kk, big);
  };

  if (kind === "loop-gif") {
    const gif = GIFEncoder();
    for (let i = 0; i < n; i++) {
      if (opts.signal.aborted) throw abort();
      const { palette, index } = indexed(frameAt(a + i / fps, 1).slice(0, W * H * 4));
      gif.writeFrame(index, W, H, { palette, delay: 1000 / fps });
      opts.onProgress((i + 1) / n);
      await tick();
    }
    gif.finish();
    return new Blob([gif.bytes()], { type: "image/gif" });
  }

  const [outW, outH] = vert ? [vert.outW, vert.outH] : [W * k, H * k];
  const container = kind === "full" ? (codec ?? (await pickCodec(outW, outH))) : "webm";
  const sink = openSink(container, outW, outH, fps, kind === "full", kind === "full" ? opts.quality : "best"); // a store upscales a loop: keep it sharp
  const out = vert ? new Uint8ClampedArray(outW * outH * 4) : null;
  const x0 = vert ? vert.sliceX(opts.slice!.cx) * k : 0;
  // a vertical video: the slice of the frame at x0, on black
  const shown = (px: Uint8ClampedArray) => {
    if (!vert) return px;
    const o = cropInto(px, W * k, x0, vert.cw * k, H * k, out!, outW, vert.ox, vert.oy);
    if (opts.draft) watermark({ w: outW, h: outH, px: o });
    return o;
  };
  try {
    if (kind === "full") {
      const dctx = new OfflineAudioContext(2, 1, MIX_RATE);
      const mix = await mixAudio(p, (path) =>
        decodeAudio(dctx, p, path).catch(() => Promise.reject(new Error(`This browser could not read the sound file ${path}.`))));
      if (opts.signal.aborted) throw abort();
      await sink.audio(mix);
      if (opts.signal.aborted) throw abort();
    }
    for (let i = 0; i < n; i++) {
      if (opts.signal.aborted) throw abort();
      await sink.frame(shown(frameAt(a + i / fps, k)), i, i % (2 * fps) === 0);
      opts.onProgress((i + 1) / n);
      await tick();
    }
    if (opts.signal.aborted) throw abort();
    const blob = await sink.finish();
    if (opts.signal.aborted) throw abort(); // Cancel during the final flush still wins
    return blob;
  } finally {
    sink.close();
  }
}
