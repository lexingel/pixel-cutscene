import { expect, test } from "vitest";
import type { Timeline } from "../src/core/types";
import { validateTimeline } from "../src/core/timeline";
import { addFxRow, fxRows, removeFxRow, setField } from "../src/ui/timelineEditor";

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
  expect(validateTimeline({ ...tl(), fx_rows: 0 })).toContain("(root).fx_rows: must be a whole number, 1 or more");
  const t = tl();
  t.fx[0].row = -1;
  expect(validateTimeline(t)).toContain("f1.row: must be a whole number, 0 or more");
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
