import { expect, test } from "vitest";
import miniText from "../../tests/fixtures/mini.json?raw";
import { animStatus, faceStatus, assetStatus, type Kit } from "../src/core/kit";
import { missingReport, NEEDS } from "../src/core/missing";
import type { Timeline } from "../src/core/types";

const tl = (): Timeline => JSON.parse(miniText);
const fx = { cols: 1, frames: 1, fps: 8, loop: false, dx: 0, dy: 0 };
const kit = (): Kit => ({
  chars: {
    legend_warrior: {
      view: "side",
      anims: {
        idle: { approved: true, source: "user", frames: ["i1.png", "i2.png"] },
        walk: { approved: false, source: "pixellab", frames: ["w1.png"] },
      },
    },
  },
  faces: {
    warrior: {
      neutral: { approved: true, source: "user", path: "f_n.png" },
      amazed: { approved: false, source: "pixellab", path: "f_a.png" },
    },
  },
  assets: {
    bg1: { approved: true, source: "user", kind: "bg", path: "bg1.png" },
    boom: { approved: true, source: "pixelfx", kind: "fx", path: "boom.png", fx },
    sting: { approved: false, source: "elevenlabs", kind: "sfx", path: "sting.ogg" },
  },
});

test("anim status: unapproved, draft, missing", () => {
  expect(animStatus(kit(), "legend_warrior", "idle")).toBe("ok");
  expect(animStatus(kit(), "legend_warrior", "walk")).toBe("unapproved");
  expect(animStatus(kit(), "legend_warrior", "walk", true)).toBe("ok");
  expect(animStatus(kit(), "legend_warrior", "hurt", true)).toBe("missing");
  expect(animStatus(kit(), "nobody", "idle", true)).toBe("missing");
});

test("missing files count as missing, even in draft", () => {
  const has = (p: string) => p !== "w1.png" && p !== "f_a.png" && p !== "sting.ogg";
  expect(animStatus(kit(), "legend_warrior", "walk", true, has)).toBe("missing");
  expect(faceStatus(kit(), "warrior", "amazed", true, has)).toBe("missing");
  expect(assetStatus(kit(), "sting", true, has)).toBe("missing");
  expect(animStatus(kit(), "legend_warrior", "idle", false, has)).toBe("ok");
});

test("face and asset status", () => {
  expect(faceStatus(kit(), "warrior", "neutral")).toBe("ok");
  expect(faceStatus(kit(), "warrior", "amazed")).toBe("unapproved");
  expect(faceStatus(kit(), "warrior", "amazed", true)).toBe("ok");
  expect(faceStatus(kit(), "warrior", "nope")).toBe("missing");
  expect(assetStatus(kit(), "sting")).toBe("unapproved");
  expect(assetStatus(kit(), "sting", true)).toBe("ok");
  expect(assetStatus(kit(), "zzz", true)).toBe("missing");
});

test("NEEDS table", () => {
  expect(NEEDS).toEqual({ walk: "walk", look_around: "idle", startle: "hurt", idle: "idle" });
});

test("missingReport on mini", () => {
  const rep = missingReport(tl(), kit());
  const line = (what: string, why: string, by: string) =>
    rep.some((r) => r.what.includes(what) && r.why === why && r.used_by === by);
  expect(line("walk", "unapproved", "a1")).toBe(true);
  expect(line("rift_vista", "missing", "s1")).toBe(true);
  expect(rep.some((r) => r.what.includes("idle"))).toBe(false);
  const d = missingReport(tl(), kit(), true);
  expect(d.some((r) => r.why === "unapproved")).toBe(false);
  expect(d.some((r) => r.why === "missing")).toBe(true);
});

test("missingReport covers faces, anim: actions, fx and audio", () => {
  const t = tl();
  t.shots.push({ id: "c1", type: "closeup", start: 0, end: 1, face: "warrior", expr: "amazed" });
  t.actors[0].actions.push({ id: "a9", t: 5, do: "anim:cast" }, { id: "a8", t: 6, do: "startle" });
  t.fx.push({ id: "x1", t: 0, fx: "boom", x: 0, y: 0 }, { id: "x2", t: 0, fx: "gone", x: 0, y: 0 });
  t.audio.push({ id: "u1", t: 0, clip: "sting", kind: "sfx" });
  const rep = missingReport(t, kit());
  const line = (what: string, why: string, by: string) =>
    rep.some((r) => r.what.includes(what) && r.why === why && r.used_by === by);
  expect(line("face warrior amazed", "unapproved", "c1")).toBe(true);
  expect(line("cast", "missing", "a9")).toBe(true);
  expect(line("hurt", "missing", "a8")).toBe(true);
  expect(line("gone", "missing", "x2")).toBe(true);
  expect(rep.some((r) => r.used_by === "x1")).toBe(false);
  expect(line("sting", "unapproved", "u1")).toBe(true);
});
