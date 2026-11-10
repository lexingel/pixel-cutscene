import { describe, expect, it } from "vitest";
import { assignFrame, importAs, mergeCast, sortFrames, unassigned } from "../src/core/cast";
import { newProject } from "../src/core/project";

const blob = (s: string) => new Blob([s]);

function heroWithLoose(loose: string[]) {
  const p = newProject("t");
  p.kit.chars.hero = { view: "side", anims: { idle: { approved: true, source: "user", frames: [] } } };
  for (const f of ["idle_0.png", "idle_2.png"]) {
    p.files.set(`chars/hero/idle/${f}`, blob(f));
    p.kit.chars.hero.anims.idle.frames.push(`chars/hero/idle/${f}`);
  }
  for (const f of loose) p.files.set(`chars/hero/_unassigned/${f}`, blob("loose " + f));
  return p;
}

describe("sortFrames", () => {
  it("orders by the trailing number, naturally", () => {
    expect(sortFrames(["a/x10.png", "a/x2.png", "a/x1.png", "a/y.png"])).toEqual(["a/x1.png", "a/x2.png", "a/x10.png", "a/y.png"]);
  });
});

describe("assignFrame", () => {
  it("keeps frames in natural order when picked out of order", () => {
    const p = heroWithLoose(["f1.png", "f11.png", "f3.png"]);
    assignFrame(p, "hero", "chars/hero/_unassigned/f11.png", "walk");
    assignFrame(p, "hero", "chars/hero/_unassigned/f1.png", "walk");
    assignFrame(p, "hero", "chars/hero/_unassigned/f3.png", "walk");
    expect(p.kit.chars.hero.anims.walk.frames).toEqual(["chars/hero/walk/f1.png", "chars/hero/walk/f3.png", "chars/hero/walk/f11.png"]);
    assignFrame(p, "hero", "chars/hero/_unassigned/../x", "walk"); // unknown path: no-op
    expect(unassigned(p, "hero")).toEqual([]);
  });
  it("never overwrites or duplicates on a name collision", async () => {
    const p = heroWithLoose(["idle_2.png"]);
    assignFrame(p, "hero", "chars/hero/_unassigned/idle_2.png", "idle");
    const fr = p.kit.chars.hero.anims.idle.frames;
    expect(new Set(fr).size).toBe(fr.length);
    expect(fr).toHaveLength(3);
    expect(await p.files.get("chars/hero/idle/idle_2.png")!.text()).toBe("idle_2.png");
    expect(fr.filter((f) => !p.files.has(f))).toEqual([]);
    expect(fr).toContain("chars/hero/idle/idle_2_2.png");
  });
});

describe("importAs", () => {
  it("keeps the id when new, makes a copy when the id exists locally", () => {
    const p = newProject("Backup");
    expect(importAs(p, [])).toBe(p);
    const c = importAs(p, [p.id]);
    expect(c.id).not.toBe(p.id);
    expect(c.name).toBe("Backup (copy)");
    expect(p.id).toBeTruthy();
  });
});

describe("mergeCast", () => {
  it("keeps an edited look, takes new anims, and never touches the prototype", () => {
    const p = newProject("t");
    p.cast.ghost = { look: "mine", anims: [] };
    mergeCast(p, [
      { id: "ghost", look: "theirs", anims: ["float"] },
      { id: "constructor", look: "c", anims: [] },
      { id: "__proto__", look: "x", anims: [] },
    ]);
    expect(p.cast.ghost).toEqual({ look: "mine", anims: ["float"] });
    expect(Object.hasOwn(p.cast, "constructor")).toBe(true);
    expect(Object.getPrototypeOf(p.cast)).toBe(Object.prototype);
    expect(Object.keys(p.cast)).not.toContain("__proto__");
  });
});
