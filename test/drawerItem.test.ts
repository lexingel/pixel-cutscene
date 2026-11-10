import { expect, test } from "vitest";
import { knownItem, parseItem } from "../src/ui/drawer";
import type { Kit } from "../src/core/kit";

const kit = { chars: { hero: {} }, faces: {}, assets: { tone: {} } } as unknown as Kit;

test("parseItem refuses garbage, unknown kinds and empty ids", () => {
  for (const bad of ["", "nope", "null", "5", "[]", '{"kind":"boss"}', '{"kind":"char"}', '{"kind":"char","char":""}', '{"kind":"fx","id":3}', '{"kind":"track","id":null}'])
    expect(parseItem(bad), bad).toBeNull();
});

test("parseItem keeps valid items and drops extra fields", () => {
  expect(parseItem('{"kind":"char","char":"hero","x":1}')).toEqual({ kind: "char", char: "hero" });
  expect(parseItem('{"kind":"sound"}')).toEqual({ kind: "sound" });
  expect(parseItem('{"kind":"fx","id":"fire/campfire"}')).toEqual({ kind: "fx", id: "fire/campfire" });
});

test("knownItem uses own keys only", () => {
  expect(knownItem(kit, { kind: "char", char: "hero" })).toBe(true);
  expect(knownItem(kit, { kind: "char", char: "constructor" })).toBe(false);
  expect(knownItem(kit, { kind: "clip", clip: "toString" })).toBe(false);
  expect(knownItem(kit, { kind: "clip", clip: "tone" })).toBe(true);
  expect(knownItem(kit, { kind: "fx", id: "fire/nothing" })).toBe(false);
  expect(knownItem(kit, { kind: "fx", id: "fire/campfire" })).toBe(true);
});
