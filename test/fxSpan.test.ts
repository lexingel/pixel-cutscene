import { describe, expect, it } from "vitest";
import { fxEnd, LOOP_FX_DUR, newFxDur } from "../src/core/render";

const loop = { cols: 4, frames: 8, fps: 12, loop: true, dx: 0, dy: 0 };
const once = { ...loop, loop: false };

describe("how long an effect lasts", () => {
  it("a set duration wins", () => expect(fxEnd({ t: 1, dur: 2 }, loop, 8)).toBe(3));
  it("a one-shot ends after its frames", () => expect(fxEnd({ t: 1 }, once, 8)).toBeCloseTo(1 + 8 / 12));
  it("an old loop with no duration runs to the end of the scene", () => expect(fxEnd({ t: 1 }, loop, 8)).toBe(8));
  it("a newly added loop gets a duration so it stops", () => {
    expect(newFxDur(loop)).toBe(LOOP_FX_DUR);
    expect(newFxDur(once)).toBeUndefined();
  });
});
