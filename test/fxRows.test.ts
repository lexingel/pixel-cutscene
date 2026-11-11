import { expect, test } from "vitest";
import type { Timeline } from "../src/core/types";
import { validateTimeline } from "../src/core/timeline";
import { addFxRow, fxRows, removeFxRow, setField, shiftFxLocks, shiftRows } from "../src/ui/timelineEditor";

const tl = (): Timeline => ({
  name: "t", duration: 10,
  shots: [{ id: "s1", type: "wide", start: 0, end: 10, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
  actors: [],
  fx: [{ id: "f1", t: 2, fx: "spark", x: 5, y: 6 }, { id: "f2", t: 3, fx: "spark", x: 5, y: 6, row: 2 }], audio: [],
});

test("rows: as many as fx_rows asks, or enough for the highest row used", () => {
  expect(fxRows(tl())).toBe(3);
  expect(fxRows({ ...tl(), fx: [] })).toBe(1);
  expect(fxRows({ ...tl(), fx: [], fx_rows: 4 })).toBe(4);
});

test("addFxRow opens one more empty row", () => {
  const r = addFxRow(tl());
  expect(r.error).toBeUndefined();
  expect(fxRows(r.tl)).toBe(4);
});

test("removeFxRow takes out an empty row; the rows above move down", () => {
  const r = removeFxRow(tl(), 1);
  expect(r.error).toBeUndefined();
  expect(r.tl.fx.map((f) => f.row ?? 0)).toEqual([0, 1]);
  expect(fxRows(r.tl)).toBe(2);
  expect(removeFxRow(tl(), 2).error).toMatch(/not empty/);
  expect(removeFxRow({ ...tl(), fx: [] }, 0).error).toMatch(/last/);
});

test("a bar moves to another row with setField", () => {
  expect(setField(tl(), "f1", "row", 1).tl.fx[0].row).toBe(1);
});

test("row and fx_rows are validated", () => {
  expect(validateTimeline({ ...tl(), fx_rows: 0 })).toContain("(root).fx_rows: must be a whole number, 1 to 64");
  const t = tl();
  t.fx[0].row = -1;
  expect(validateTimeline(t)).toContain("f1.row: must be a whole number, 0 to 63");
  t.fx[0].row = 64;
  expect(validateTimeline(t)).toContain("f1.row: must be a whole number, 0 to 63");
  expect(validateTimeline({ ...tl(), fx_rows: 1e8 })).toContain("(root).fx_rows: must be a whole number, 1 to 64");
  expect(addFxRow({ ...tl(), fx_rows: 64 }).error).toBeTruthy();
});

import { rulerTicks } from "../src/ui/timelineEditor";
test("ruler: labels stay ~48 px apart; finer marks when zoomed in", () => {
  const out = rulerTicks(60, 4); // a minute in 240 px: a label every 15 s
  expect(out.filter((x) => x.label).map((x) => x.label)).toEqual(["0", "15", "30", "45"]);
  const one = rulerTicks(8, 100).filter((x) => x.t < 1); // 100 px a second: labels at whole seconds, a mark every 0.1
  expect(one.map((x) => [x.t, x.label])).toEqual([[0, "0"], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => [k / 10, undefined])]);
  const close = rulerTicks(2, 1600).filter((x) => x.t < 0.1); // 1600 px a second: labels every 0.1 s, a mark every frame
  expect(close.map((x) => x.label)).toEqual(["0", undefined, undefined]);
  expect(rulerTicks(2, 1600).find((x) => Math.abs(x.t - 0.5) < 1e-9)?.label).toBe("0.5");
});

test("removing an effects row keeps each lock on the row it was on", () => {
  // rows 0..3, row 1 taken out: row 2 becomes row 1, row 3 becomes row 2; actor and audio locks stay
  expect(shiftFxLocks(["fx", "fx1", "fx2", "fx3", "hero1", "audio"], 1)).toEqual(["fx", "fx1", "fx2", "hero1", "audio"]);
  expect(shiftFxLocks(["fx2"], 0)).toEqual(["fx1"]);
  expect(shiftFxLocks(["fx1"], 0)).toEqual(["fx"]);
});

test("several effects move rows together, kept within 0-63", () => {
  const r = shiftRows(tl(), ["f1", "f2"], 1);
  expect(r.tl.fx.map((f) => f.row)).toEqual([1, 3]);
  expect(shiftRows(tl(), ["f1", "f2"], -2).tl.fx.map((f) => f.row ?? 0)).toEqual([0, 0]);
  expect(shiftRows({ ...tl(), fx: [{ ...tl().fx[0], row: 63 }] }, ["f1"], 5).tl.fx[0].row).toBe(63);
});
