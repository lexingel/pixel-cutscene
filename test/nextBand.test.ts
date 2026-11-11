import { describe, expect, it } from "vitest";
import { bandState } from "../src/ui/nextBand";

describe("bandState", () => {
  it("hidden without a timeline", () => expect(bandState(null)).toBeNull());
  it("ready at zero rows", () => expect(bandState([])).toEqual({ text: "Ready to export", ready: true }));
  it("hidden when nothing is in the scene", () => expect(bandState([], true)).toBeNull());
  it("keeps the band when only effect or audio pieces are missing", () => expect(bandState(["sfx_rumble"], true)).toEqual({ text: "1 piece waits for you: sfx rumble", ready: false }));
  it("says words, not raw ids", () => expect(bandState(["hero look_around"])?.text).toBe("1 piece waits for you: hero look around"));
  it("names the one piece", () => expect(bandState(["hero walk"])).toEqual({ text: "1 piece waits for you: hero walk", ready: false }));
  it("counts several", () => expect(bandState(["a", "b", "c"])).toEqual({ text: "3 pieces wait for you", ready: false }));
});
