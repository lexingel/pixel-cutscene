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
