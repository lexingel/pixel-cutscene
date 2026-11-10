import { describe, expect, test } from "vitest";
import { FX_LIST, addLibraryFx, rebakeFx } from "../src/core/fxLibrary";
import { newProject } from "../src/core/project";
import type { Img } from "../src/core/kit";
import type { Timeline } from "../src/core/types";
import { pngBytes } from "./png";

const encode = async (img: Img) => new Blob([pngBytes(img) as BlobPart]);

describe("fxLibrary", () => {
  test("list_has_fire_breath", () => {
    expect(FX_LIST).toContainEqual(expect.objectContaining({ id: "fire/fire-breath", category: "fire" }));
    expect(FX_LIST.some((f) => f.id.endsWith("/_lib"))).toBe(false);
  });
  test("add_bakes_an_approved_asset", async () => {
    const p = newProject("t");
    expect(await addLibraryFx(p, "fire/campfire", undefined, encode)).toBe("campfire");
    const a = p.kit.assets.campfire;
    expect(a.approved).toBe(true);
    expect(a.source).toBe("pixelfx");
    expect(p.files.has(a.path)).toBe(true);
    expect(a.fx!.frames).toBeGreaterThan(1);
  });
  test("rebake_keeps_old_sheet_for_undo", async () => {
    const p = newProject("t");
    await addLibraryFx(p, "fire/fire-breath", undefined, encode);
    const oldPath = p.kit.assets["fire-breath"].path;
    const tl = { fx: [{ id: "f1", t: 0, fx: "fire-breath", x: 5, y: 5 }], shots: [], actors: [], audio: [], duration: 1 } as unknown as Timeline;
    const r = await rebakeFx(p, tl, "f1", 30, encode);
    expect(r.error).toBeUndefined();
    expect(r.tl.fx[0].fx).toBe("fire-breath_a30");
    expect(r.tl.fx[0].angle).toBe(30);
    expect(p.kit.assets["fire-breath"]).toBeDefined();
    expect(p.files.has(oldPath)).toBe(true);
    expect(p.kit.assets["fire-breath_a30"]).toBeDefined();
  });
});

import { bakeFx } from "../src/core/fxBake";
import { loadFx, naturalReach } from "../src/core/fxLibrary";
describe("reach", () => {
  test("a_longer_reach_bakes_its_own_longer_sheet", async () => {
    const p = newProject("t");
    expect(await addLibraryFx(p, "fire/fire-breath", undefined, encode, 2)).toBe("fire-breath_r20");
    expect(await addLibraryFx(p, "fire/fire-breath", undefined, encode, 2.2)).toBe("fire-breath_r20"); // half steps, reused
    expect(await addLibraryFx(p, "fire/campfire", undefined, encode, 3)).toBe("campfire"); // no reach option: as drawn
    const mod = await loadFx("fire/fire-breath");
    expect(naturalReach(mod)).toBe(148);
    expect(p.kit.assets["fire-breath_r20"].fx!.dx).toBe(bakeFx(mod, {}).dx); // same origin, the cell grows forward
  });
  test("the_fire_really_carries_further", async () => {
    const mod = await loadFx("fire/fire-breath");
    const far = (reach: number) => {
      const [w, h] = mod.meta.size as number[], ox = mod.meta.origin[0], cw = Math.round(ox + (w - ox) * reach);
      const b = bakeFx({ ...mod, meta: { ...mod.meta, size: [cw, h] } }, reach > 1 ? { reach } : {});
      let m = 0;
      const W = b.sheet.w, cellW = W / b.cols;
      for (let i = 3; i < b.sheet.px.length; i += 4) if (b.sheet.px[i] > 0) m = Math.max(m, ((i - 3) / 4) % W % cellW);
      return m - b.dx;
    };
    const one = far(1), two = far(2);
    expect(two).toBeGreaterThan(one * 1.7);
  });
  test("rebake_sets_and_clears_reach", async () => {
    const p = newProject("t");
    await addLibraryFx(p, "fire/fire-breath", undefined, encode);
    const tl = { fx: [{ id: "f1", t: 0, fx: "fire-breath", x: 5, y: 5 }], shots: [], actors: [], audio: [], duration: 1 } as unknown as Timeline;
    const r = await rebakeFx(p, tl, "f1", 0, encode, 3);
    expect(r.tl.fx[0]).toMatchObject({ fx: "fire-breath_r30", reach: 3 });
    const aimed = await rebakeFx(p, r.tl, "f1", 20, encode); // re-aiming keeps the reach
    expect(aimed.tl.fx[0]).toMatchObject({ fx: "fire-breath_a20_r30", reach: 3, angle: 20 });
    const back = await rebakeFx(p, aimed.tl, "f1", 20, encode, 1);
    expect(back.tl.fx[0].fx).toBe("fire-breath_a20");
    expect("reach" in back.tl.fx[0]).toBe(false);
  });
});
