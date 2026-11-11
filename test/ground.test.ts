// @ts-expect-error: node types are not part of this browser project; vitest runs in node
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { findGround } from "../src/core/ground";
import type { Img } from "../src/core/kit";
import { decodePng } from "./png";

const bands = (w: number, parts: [number, number[]][]): Img => {
  const h = parts.reduce((n, [rows]) => n + rows, 0), px = new Uint8ClampedArray(w * h * 4);
  let y = 0;
  for (const [rows, c] of parts) for (let i = 0; i < rows; i++, y++) for (let x = 0; x < w; x++) px.set(c, (y * w + x) * 4);
  return { w, h, px };
};

describe("findGround", () => {
  test("feet halfway down the floor strip under the sky", () => {
    expect(findGround(bands(8, [[60, [40, 60, 200, 255]], [40, [40, 140, 40, 255]]]))).toBe(80);
  });
  test("a speckled floor is still one strip", () => {
    const im = bands(8, [[60, [40, 60, 200, 255]], [40, [40, 140, 40, 255]]]);
    for (let y = 61; y < 100; y += 3) im.px.set([60, 150, 50, 255], (y * 8 + 3) * 4);
    expect(findGround(im)).toBe(80);
  });
  test("no clear floor in the lower part: none", () => {
    expect(findGround(bands(8, [[100, [90, 90, 90, 255]]]))).toBeUndefined(); // one colour top to bottom
    expect(findGround(bands(8, [[30, [40, 60, 200, 255]], [70, [40, 140, 40, 255]]]))).toBeUndefined(); // "floor" up to the top: a wall, not ground
  });
  test("the test field: grass over a sand strip", () => {
    const im = decodePng(readFileSync(new URL("./fixtures/bg/field.png", import.meta.url)).toString("base64"));
    expect(findGround(im)).toBe(170);
  });
});
