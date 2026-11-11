import { expect, test } from "vitest";
import { opaqueBox, peaks, snapEdge } from "../src/ui/timelineView";

test("peaks: the loudest sample per bucket, 0..1", () => {
  const d = new Float32Array([0, 0.5, -1, 0.25, 0, 0, -0.1, 0.2]);
  expect(peaks(d, 4).map((x) => +x.toFixed(3))).toEqual([0.5, 1, 0, 0.2]); // Float32: 0.2 is 0.2000000029
  expect(peaks(new Float32Array(0), 3)).toEqual([0, 0, 0]);
});

test("snapEdge: the start or the end lands on the nearest edge within reach", () => {
  expect(snapEdge(1.02, 0.5, [1, 3], 0.05)).toEqual({ t: 1, at: 1 }); // start onto 1
  expect(snapEdge(2.46, 0.5, [1, 3], 0.05)).toEqual({ t: 2.5, at: 3 }); // end onto 3
  expect(snapEdge(2, 0.5, [1, 3], 0.05)).toEqual({ t: 2 }); // nothing near
});

test("opaqueBox: the box around the non-transparent pixels", () => {
  const px = new Uint8ClampedArray(4 * 4 * 4);
  px[(1 * 4 + 2) * 4 + 3] = 255;
  px[(3 * 4 + 1) * 4 + 3] = 255;
  expect(opaqueBox({ w: 4, h: 4, px })).toEqual({ x: 1, y: 1, w: 2, h: 3 });
  expect(opaqueBox({ w: 2, h: 2, px: new Uint8ClampedArray(16) })).toBeNull();
});
