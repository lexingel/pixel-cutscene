import { expect, test } from "vitest";
import { CAT_LABEL, catOfItem, catOfTrack } from "../src/ui/category";

test("library item kinds map to categories", () => {
  expect(catOfItem("char")).toBe("char");
  expect(catOfItem("fx")).toBe("fx");
  for (const k of ["clip", "track", "sound"] as const) expect(catOfItem(k)).toBe("sound");
});
test("timeline tracks map to categories", () => {
  expect(catOfTrack("shots")).toBe("place");
  expect(catOfTrack("actor")).toBe("char");
  expect(catOfTrack("fx")).toBe("fx");
  for (const k of ["dialogue", "sfx", "music"] as const) expect(catOfTrack(k)).toBe("sound");
});
test("labels", () => {
  expect(CAT_LABEL).toEqual({ char: "Character", place: "Place", fx: "Effect", sound: "Sound" });
});
