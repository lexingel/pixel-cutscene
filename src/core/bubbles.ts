// Speech bubbles: a "say" action on an actor (silent, comic-style), or a voice line with a speaker. Drawn into the
// frame with the pixelfx 5x7 capitals (MIT, vendor/pixelfx), plus hand-made lower case and the Turkish letters.
import { FONTS } from "../../vendor/pixelfx/src/core/font.js";
import { actorName } from "./labels";
import type { Img, Kit } from "./kit";
import type { Timeline } from "./types";

export type BubbleStyle = "bubble" | "box";
export type Bubble = { actor?: string; speaker: string; text: string; shown: number; style: BubbleStyle };

const REVEAL = 30; // letters a second
export const LINE = 11; // line pitch: 7 rows + room for accents above and cedillas below

/** How long a line stays up: 2 to 8 s by its length. */
export const sayDur = (text: string) => Math.round(Math.min(8, Math.max(2, 1.2 + 0.06 * text.length)) * 30) / 30;

/** The bubbles showing at t, in timeline order (say actions, then voice lines). A voice line's bubble lasts as long as
 * its clip plays (kit asset `len`, once known), never shorter than the time to read it. */
export function bubblesAt(tl: Timeline, t: number, kit?: Kit): Bubble[] {
  const out: Bubble[] = [];
  const add = (t0: number, dur: number, text: string, style: BubbleStyle, speaker: string, actor?: string) => {
    if (t >= t0 && t < t0 + dur && text) out.push({ actor, speaker, text, style, shown: Math.min(text.length, Math.floor((t - t0) * REVEAL + 1e-6)) });
  };
  for (const a of tl.actors) {
    if (a.appear !== undefined && t < a.appear) continue;
    for (const act of a.actions) {
      if (act.do !== "say") continue;
      const text = String(act.text ?? "");
      add(act.t, act.dur ?? sayDur(text), text, act.style ?? "bubble", actorName(tl, a.id), a.id);
    }
  }
  for (const e of tl.audio) {
    if (e.kind !== "voice" || !e.line || !e.speaker || e.bubble === "none") continue;
    const actor = tl.actors.find((a) => a.char === e.speaker && (a.appear === undefined || t >= a.appear));
    add(e.t, Math.max(sayDur(e.line), kit?.assets[e.clip]?.len ?? 0), e.line, actor ? e.bubble ?? "bubble" : "box", e.speaker, actor?.id);
  }
  return out;
}

/* ---- the font ---- */

type Glyph = { w: number; rows: boolean[][]; dy: number }; // dy: rows above the cap line (accents) are negative
const BIG = FONTS.big.glyphs as Record<string, { w: number; rows: boolean[][] }>;
const bits = (rows: string[]) => rows.map((r) => [...r].map((c) => c === "#"));
const accent = (base: string, mark: string[]): Glyph => ({ w: BIG[base].w, rows: [...bits(mark), ...BIG[base].rows], dy: -mark.length });
const below = (base: string, mark: string[]): Glyph => ({ w: BIG[base].w, rows: [...BIG[base].rows, ...bits(mark)], dy: 0 });
const GLYPHS: Record<string, Glyph> = {
  ...Object.fromEntries(Object.entries(BIG).map(([k, g]) => [k, { ...g, dy: 0 }])),
  Ö: accent("O", [".#.#.", "....."]),
  Ü: accent("U", [".#.#.", "....."]),
  İ: accent("I", [".#.", "..."]),
  Ğ: accent("G", ["#...#", ".###."]),
  Ç: below("C", ["..#..", ".##.."]),
  Ş: below("S", ["..#..", ".##.."]),
  '"': { w: 3, rows: bits(["#.#", "#.#", "...", "...", "...", "...", "..."]), dy: 0 },
  ";": { w: 2, rows: bits(["..", "..", ".#", "..", "..", ".#", "#."]), dy: 0 },
  "’": { w: 1, rows: bits(["#", "#", ".", ".", ".", ".", "."]), dy: 0 },
  ...lower({
    a: ".....|.....|.###.|....#|.####|#...#|.####", b: "#....|#....|####.|#...#|#...#|#...#|####.",
    c: "....|....|.###|#...|#...|#...|.###", d: "....#|....#|.####|#...#|#...#|#...#|.####",
    e: ".....|.....|.###.|#...#|#####|#....|.###.", f: "..##|.#..|####|.#..|.#..|.#..|.#..",
    g: ".....|.....|.####|#...#|#...#|#...#|.####|....#|.###.", h: "#....|#....|####.|#...#|#...#|#...#|#...#",
    i: "#|.|#|#|#|#|#", j: "..#|...|..#|..#|..#|..#|..#|..#|##.", k: "#...|#...|#..#|#.#.|##..|#.#.|#..#",
    l: "#.|#.|#.|#.|#.|#.|.#", m: ".....|.....|##.#.|#.#.#|#.#.#|#.#.#|#.#.#", n: ".....|.....|####.|#...#|#...#|#...#|#...#",
    o: ".....|.....|.###.|#...#|#...#|#...#|.###.", p: ".....|.....|####.|#...#|#...#|#...#|####.|#....|#....",
    q: ".....|.....|.####|#...#|#...#|#...#|.####|....#|....#", r: "....|....|#.##|##..|#...|#...|#...",
    s: "....|....|.###|#...|.##.|...#|###.", t: ".#..|.#..|####|.#..|.#..|.#..|..##",
    u: ".....|.....|#...#|#...#|#...#|#...#|.####", v: ".....|.....|#...#|#...#|#...#|.#.#.|..#..",
    w: ".....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.", x: ".....|.....|#...#|.#.#.|..#..|.#.#.|#...#",
    y: ".....|.....|#...#|#...#|#...#|#...#|.####|....#|.###.", z: ".....|.....|#####|...#.|..#..|.#...|#####",
    ı: ".|.|#|#|#|#|#", ö: ".....|.#.#.|.....|.###.|#...#|#...#|.###.", ü: ".....|.#.#.|.....|#...#|#...#|#...#|.####",
    ç: "....|....|.###|#...|#...|#...|.###|..#.|.##.", ş: "....|....|.###|#...|.##.|...#|###.|.#..|##..",
  }),
  ğ: { w: 5, rows: bits(["#...#", ".###.", ".....", ".####", "#...#", "#...#", "#...#", ".####", "....#", ".###."]), dy: -1 },
};

function lower(t: Record<string, string>): Record<string, Glyph> {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => {
    const rows = v.split("|");
    return [k, { w: rows[0].length, rows: bits(rows), dy: 0 }];
  }));
}
const SPACE = 3, GAP = 1;
const glyph = (ch: string): Glyph | undefined => GLYPHS[ch];
export const hasGlyph = (ch: string) => !!glyph(ch);
export const glyphRows = (ch: string) => glyph(ch)?.rows.length ?? 0;
/** The whole glyph table, for the Godot stage (cutscene/font.json). */
export const fontTable = () => ({ line: LINE, space: SPACE, gap: GAP, glyphs: Object.fromEntries(Object.entries(GLYPHS).map(([k, g]) => [k, { w: g.w, dy: g.dy, rows: g.rows.map((r) => r.map((on) => (on ? "#" : ".")).join("")) }])) });

export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += (glyph(ch)?.w ?? SPACE) + GAP;
  return Math.max(0, w - GAP);
}

/** Word-wrapped lines no wider than maxW (a word longer than that is split). */
export function wrap(text: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (let word of text.replace(/…/g, "...").split(/\s+/).filter(Boolean)) {
    while (textWidth(word) > maxW && word.length > 1) {
      let n = word.length - 1;
      while (n > 1 && textWidth(word.slice(0, n)) > maxW) n--;
      if (cur) lines.push(cur), (cur = "");
      lines.push(word.slice(0, n));
      word = word.slice(n);
    }
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(next) > maxW) lines.push(cur), (cur = word);
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/* ---- drawing ---- */

type RGBA = [number, number, number, number];
const INK: RGBA = [24, 20, 28, 255], PAPER: RGBA = [255, 255, 255, 255], NAME: RGBA = [255, 214, 90, 255];

function put(out: Img, x: number, y: number, c: RGBA, a = 1): void {
  if (x < 0 || y < 0 || x >= out.w || y >= out.h) return;
  const i = (y * out.w + x) * 4;
  for (let k = 0; k < 3; k++) out.px[i + k] = a >= 1 ? c[k] : out.px[i + k] + (c[k] - out.px[i + k]) * a;
  out.px[i + 3] = 255;
}
const rect = (out: Img, x: number, y: number, w: number, h: number, c: RGBA, a = 1) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(out, x + i, y + j, c, a);
};

// Draws the first `n` letters of the wrapped lines, top-left at (x, y).
function letters(out: Img, lines: string[], n: number, x: number, y: number, c: RGBA): void {
  lines.forEach((line, li) => {
    let gx = x;
    for (const ch of line) {
      if (n-- <= 0) return;
      const g = glyph(ch);
      if (!g) { gx += SPACE + GAP; continue; }
      g.rows.forEach((row, r) => row.forEach((on, cI) => on && put(out, gx + cI, y + li * LINE + 2 + g.dy + r, c)));
      gx += g.w + GAP;
    }
    n--; // the space the wrap ate
  });
}

/** A white bubble over a head at (cx, top), its tail pointing down at it, kept inside the frame. */
export function drawBubble(out: Img, b: Bubble, cx: number, top: number): void {
  const lines = wrap(b.text, 150), pad = 4;
  const w = Math.max(...lines.map(textWidth)) + 2 * pad, h = lines.length * LINE - 2 + 2 * pad;
  const x = Math.min(Math.max(Math.round(cx - w / 2), 2), out.w - w - 2), y = Math.max(2, top - 6 - h);
  rect(out, x + 1, y, w - 2, h, INK); // outline with clipped corners
  rect(out, x, y + 1, w, h - 2, INK);
  rect(out, x + 1, y + 1, w - 2, h - 2, PAPER);
  const tx = Math.min(Math.max(Math.round(cx), x + 4), x + w - 5); // the tail, under the speaker
  for (let r = 0; r < 4; r++) {
    put(out, tx - (3 - r), y + h - 1 + r, INK);
    for (let i = -(2 - r); i <= 0; i++) put(out, tx + i, y + h - 1 + r, r < 3 ? PAPER : INK);
    put(out, tx + 1, y + h - 1 + r, INK);
  }
  letters(out, lines, b.shown, x + pad, y + pad - 2, INK);
}

/** A dialogue box along the bottom: the speaker's name, then the words. */
export function drawBox(out: Img, b: Bubble): void {
  const pad = 6, w = Math.min(out.w - 16, 520), lines = wrap(b.text, w - 2 * pad);
  const h = (lines.length + 1) * LINE + 2 * pad - 2, x = Math.round((out.w - w) / 2), y = out.h - 8 - h;
  rect(out, x, y, w, h, [16, 18, 24, 255], 0.88);
  for (let i = 0; i < w; i++) put(out, x + i, y, [230, 230, 230, 255]), put(out, x + i, y + h - 1, [230, 230, 230, 255]);
  for (let j = 0; j < h; j++) put(out, x, y + j, [230, 230, 230, 255]), put(out, x + w - 1, y + j, [230, 230, 230, 255]);
  letters(out, [b.speaker], Infinity, x + pad, y + pad - 2, NAME);
  letters(out, lines, b.shown, x + pad, y + pad - 2 + LINE, PAPER);
}
