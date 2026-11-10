import { composite, createFrame, createFx } from "../../vendor/pixelfx/src/core/index.js";
import type { Img } from "./kit";

// A pixelfx effect module: meta (size, origin, duration, loop) plus draw() or create().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FxModule = { meta: any; [k: string]: any };

/** One period for a loop; duration plus the empty end frame for a one-shot. */
const frameCount = (meta: FxModule["meta"], fps: number) => Math.max(1, Math.round(meta.duration * fps) + (meta.loop ? 0 : 1));

type Cell = { w: number; h: number; dx: number; dy: number };

/**
 * The cell an effect needs when it is aimed `angle` radians: the library cell's corners turned about the origin, so
 * nothing the effect draws is cut off. The origin pixel is (dx, dy). Unaimed, it is the library's own cell.
 */
function cellFor(meta: FxModule["meta"], angle: number): Cell {
  const [w, h] = meta.size as [number, number];
  const [ox, oy] = meta.origin as [number, number];
  if (!angle) return { w, h, dx: ox, dy: oy };
  const c = Math.cos(angle), s = Math.sin(angle);
  const pts = [[-ox, -oy], [w - ox, -oy], [-ox, h - oy], [w - ox, h - oy]].map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const dx = Math.ceil(-Math.min(...xs)) + 1, dy = Math.ceil(-Math.min(...ys)) + 1; // +1: slack for pixels the turn rounds outward
  return { dx, dy, w: dx + Math.ceil(Math.max(...xs)) + 2, h: dy + Math.ceil(Math.max(...ys)) + 2 };
}

/** RGBA bytes (w*h*4, transparent background) of the first n frames, stepped at exactly 1/fps. */
export function renderFxFrames(mod: FxModule, opts: object, fps: number, n: number, cell?: Cell): Uint8ClampedArray[] {
  const [w, h] = cell ? [cell.w, cell.h] : (mod.meta.size as [number, number]);
  const [ox, oy] = cell ? [cell.dx, cell.dy] : (mod.meta.origin as [number, number]);
  const frame = createFrame(w, h, 0, 0);
  const inst = createFx(mod, { x: ox, y: oy, ...opts });
  const out: Uint8ClampedArray[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) inst.update(1 / fps);
    frame.color.fill(0);
    frame.light.fill(0);
    inst.draw(frame);
    out.push(composite(frame, new Uint8ClampedArray(w * h * 4), null));
  }
  return out;
}

/**
 * Bake an effect into a sprite sheet. The pivot (dx, dy) is the effect's origin inside each cell:
 * draw the cell at (x - dx, y - dy) to put the origin on (x, y).
 */
export function bakeFx(mod: FxModule, opts: object, fps = 30) {
  const cell = cellFor(mod.meta, (opts as { angle?: number }).angle ?? 0);
  const { w, h, dx, dy } = cell;
  const frames = frameCount(mod.meta, fps);
  const cols = Math.ceil(Math.sqrt(frames)), rows = Math.ceil(frames / cols);
  if (cols * rows < frames) throw new Error(`sheet ${cols}x${rows} too small for ${frames} frames`);
  const sheet: Img = { w: cols * w, h: rows * h, px: new Uint8ClampedArray(cols * w * rows * h * 4) };
  renderFxFrames(mod, opts, fps, frames, cell).forEach((px, i) => {
    const cx = (i % cols) * w, cy = Math.floor(i / cols) * h;
    for (let y = 0; y < h; y++) sheet.px.set(px.subarray(y * w * 4, (y + 1) * w * 4), ((cy + y) * sheet.w + cx) * 4);
  });
  return { sheet, cols, frames, fps, loop: !!mod.meta.loop, dx, dy };
}
