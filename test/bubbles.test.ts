import { describe, expect, test } from "vitest";
import { bubblesAt, glyphRows, hasGlyph, sayDur, textWidth, wrap } from "../src/core/bubbles";
import { renderFrame } from "../src/core/render";
import { validateTimeline } from "../src/core/timeline";
import { labelOf } from "../src/core/labels";
import { moveLabel } from "../src/core/moves";
import { setMove } from "../src/ui/timelineEditor";
import type { Img, Kit } from "../src/core/kit";
import type { Timeline } from "../src/core/types";

const solid = (w: number, h: number, c: number[]): Img => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(c, i * 4);
  return { w, h, px };
};
const at = (im: Img, x: number, y: number) => Array.from(im.px.slice((y * im.w + x) * 4, (y * im.w + x) * 4 + 4));
const count = (im: Img, rgba: number[], y0 = 0, y1 = im.h) => {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < im.w; x++) if (rgba.every((v, k) => im.px[(y * im.w + x) * 4 + k] === v)) n++;
  return n;
};
const kit = (): Kit => ({ chars: { hero: { view: "side", anims: { idle: { approved: true, source: "user", frames: ["h.png"] } } } }, faces: {}, assets: {} } as Kit);
const scene = (): Timeline => ({
  name: "t", duration: 10, shots: [{ id: "s1", type: "wide", start: 0, end: 10, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
  actors: [{ id: "hero1", char: "hero", x: 100, y: 100, actions: [{ id: "a1", t: 1, do: "say", text: "Run!", dur: 2 }] }],
  fx: [], audio: [],
});

describe("bubbles", () => {
  test("a_say_bubble_shows_for_its_duration_and_types_itself_out", () => {
    const tl = scene();
    expect(bubblesAt(tl, 0.9)).toEqual([]);
    expect(bubblesAt(tl, 1)).toEqual([expect.objectContaining({ actor: "hero1", text: "Run!", shown: 0, style: "bubble" })]);
    expect(bubblesAt(tl, 1.05)[0].shown).toBe(1); // 30 letters a second
    expect(bubblesAt(tl, 2)[0].shown).toBe(4);
    expect(bubblesAt(tl, 3)).toEqual([]);
  });
  test("a_voice_line_with_a_speaker_brings_its_own_bubble", () => {
    const tl = scene();
    tl.actors[0].actions = [];
    tl.audio.push({ id: "v1", t: 2, clip: "vo_1", kind: "voice", line: "Who goes there?", speaker: "hero" });
    expect(bubblesAt(tl, 2.5)).toEqual([expect.objectContaining({ actor: "hero1", text: "Who goes there?", style: "bubble", speaker: "hero" })]);
    tl.audio[0].bubble = "box";
    expect(bubblesAt(tl, 2.5)[0].style).toBe("box");
    tl.audio[0].bubble = "none";
    expect(bubblesAt(tl, 2.5)).toEqual([]);
    tl.audio[0].bubble = undefined;
    tl.audio[0].speaker = "narrator"; // no actor plays them: the line still shows, in a box
    expect(bubblesAt(tl, 2.5)).toEqual([expect.objectContaining({ actor: undefined, style: "box", speaker: "narrator" })]);
  });
  test("a_bubble_lasts_by_its_length", () => {
    expect(sayDur("Hi")).toBe(2);
    expect(sayDur("x".repeat(60))).toBeCloseTo(4.8, 5);
    expect(sayDur("x".repeat(500))).toBe(8);
  });
  test("every_letter_has_a_glyph_lower_case_and_turkish_too", () => {
    const all = "abcdefghijklmnopqrstuvwxyzçğıöşüABCDEFGHIJKLMNOPQRSTUVWXYZÇĞİÖŞÜ0123456789.,!?'\":;-()";
    for (const ch of all) expect(hasGlyph(ch), ch).toBe(true);
    expect(textWidth("i")).toBeLessThan(textWidth("I")); // lower case is not the capitals again
    expect(glyphRows("g")).toBeGreaterThan(7); // descenders drop below the line
  });
  test("lines_wrap_on_words_within_the_width", () => {
    const lines = wrap("THE DRAGON IS COMING FOR US ALL", 60);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(60);
    expect(lines.join(" ")).toBe("THE DRAGON IS COMING FOR US ALL");
    expect(textWidth("ÖĞÜŞÇİ")).toBeGreaterThan(0); // every Turkish capital has a glyph
  });
  test("say_needs_text_and_a_known_style", () => {
    const tl = scene();
    expect(validateTimeline(tl)).toEqual([]);
    (tl.actors[0].actions[0] as any).text = "";
    (tl.actors[0].actions[0] as any).style = "cloud";
    const e = validateTimeline(tl).join("\n");
    expect(e).toMatch(/a1\.text/);
    expect(e).toMatch(/a1\.style/);
  });
  test("say_is_named_by_its_words", () => {
    expect(moveLabel("say")).toBe("Say…");
    expect(labelOf(scene(), kit(), "a1")).toBe("hero · “Run!”");
  });
  test("picking_say_gives_a_line_to_type_and_a_duration", () => {
    const tl = scene();
    tl.actors[0].actions = [{ id: "a1", t: 1, do: "idle" }];
    const r = setMove(tl, "a1", "say", false);
    expect(r.error).toBeUndefined();
    expect(r.tl.actors[0].actions[0]).toMatchObject({ do: "say", text: "...", dur: 2 });
  });
  test("the_bubble_is_drawn_white_with_dark_letters_above_the_head", () => {
    const tl = scene();
    const out = solid(200, 120, [9, 9, 9, 255]);
    renderFrame({ tl, kit: kit(), img: (p) => (p === "h.png" ? solid(10, 20, [0, 200, 0, 255]) : null), draft: false, W: 200, H: 120 }, 2, out);
    expect(count(out, [255, 255, 255, 255], 0, 80)).toBeGreaterThan(100); // the bubble, above the head (y 80)
    expect(count(out, [24, 20, 28, 255], 0, 80)).toBeGreaterThan(10); // its letters
    expect(at(out, 100, 110)).toEqual([0, 0, 0, 255]); // nothing below the feet
  });
  test("a_box_sits_along_the_bottom_with_the_speakers_name", () => {
    const tl = scene();
    (tl.actors[0].actions[0] as any).style = "box";
    const out = solid(200, 120, [9, 9, 9, 255]);
    renderFrame({ tl, kit: kit(), img: () => null, draft: false, W: 200, H: 120 }, 2, out);
    expect(count(out, [255, 214, 90, 255], 80, 120)).toBeGreaterThan(5); // the name, in the bottom third
    expect(count(out, [255, 255, 255, 255], 80, 120)).toBeGreaterThan(10); // the words
  });
});

// @ts-ignore node types are not part of the browser build
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fontTable } from "../src/core/bubbles";
// the Godot side is not in the published web repo; there the check has nothing to compare
test.skipIf(!existsSync("../cutscene"))("the_godot_stage_has_the_same_font", () => {
  const want = JSON.stringify(fontTable(), null, 1) + "\n";
  // @ts-ignore as above
  if (process.env.WRITE_FONT) writeFileSync("../cutscene/font.json", want);
  expect(readFileSync("../cutscene/font.json", "utf8").replace(/\r\n/g, "\n")).toBe(want);
});
