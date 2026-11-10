import { describe, expect, test } from "vitest";
import { bakeFx } from "../src/core/fxBake";
import { loadFx } from "../src/core/fxLibrary";

// opaque pixels of one cell of a baked sheet
function opaque(b: ReturnType<typeof bakeFx>, frame: number): number {
  const cw = b.sheet.w / b.cols, ch = b.sheet.h / Math.ceil(b.frames / b.cols);
  const x0 = (frame % b.cols) * cw, y0 = Math.floor(frame / b.cols) * ch;
  let n = 0;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (b.sheet.px[((y0 + y) * b.sheet.w + x0 + x) * 4 + 3] > 0) n++;
  return n;
}

describe("bakeFx aimed", () => {
  test("aiming_keeps_the_whole_flame", async () => {
    const mod = await loadFx("fire/fire-breath");
    const flat = opaque(bakeFx(mod, {}, 30), 20);
    expect(flat).toBeGreaterThan(5000);
    for (const deg of [20, 60, 90, 180, -90, 270]) {
      const b = bakeFx(mod, { angle: (deg * Math.PI) / 180 }, 30);
      expect(opaque(b, 20) / flat, `${deg} deg`).toBeGreaterThanOrEqual(0.95);
    }
  });
  test("unaimed_bake_keeps_the_library_cell_and_pivot", async () => {
    const mod = await loadFx("fire/fire-breath");
    const b = bakeFx(mod, {}, 30);
    expect([b.sheet.w / b.cols, b.dx, b.dy]).toEqual([mod.meta.size[0], mod.meta.origin[0], mod.meta.origin[1]]);
  });
});
