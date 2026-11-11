import { expect, test } from "vitest";
import { sayDur } from "../src/core/bubbles";
import { dialogueOf, parseScript, setDialogue, spaceOut, toScript } from "../src/core/dialogue";
import { validateTimeline } from "../src/core/timeline";
import type { Timeline } from "../src/core/types";

const tl = (): Timeline => ({
  name: "t", duration: 20,
  shots: [{ id: "s1", type: "wide", start: 0, end: 20, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
  actors: [
    { id: "k1", char: "knight", x: 10, y: 100, actions: [{ id: "a1", t: 1, do: "say", text: "We rest here." }, { id: "a2", t: 2, do: "walk", to: [50, 100], dur: 2 }] },
    { id: "r1", char: "ranger", x: 90, y: 100, actions: [] },
  ],
  fx: [],
  audio: [
    { id: "v1", t: 5, clip: "line_ranger_1", kind: "voice", speaker: "ranger", line: "Something moves." },
    { id: "m1", t: 0, clip: "calm", kind: "music" },
  ],
});

test("dialogueOf lists bubbles and voice lines in time order, a voice line under its speaker's actor", () => {
  expect(dialogueOf(tl()).map((l) => [l.who, l.text, l.voice, l.t])).toEqual([
    ["k1", "We rest here.", false, 1],
    ["r1", "Something moves.", true, 5],
  ]);
});

test("parseScript reads 'Name: words' lines by actor or character name; an unknown name is an error with its line number", () => {
  const r = parseScript("Knight: Hold.\n\n  ranger :  I see them.  \nknight: Now!", tl());
  expect(r.error).toBeUndefined();
  expect(r.lines).toEqual([{ who: "k1", text: "Hold." }, { who: "r1", text: "I see them." }, { who: "k1", text: "Now!" }]);
  expect(parseScript("Knight: ok\nDragon: roar", tl()).error).toBe('Line 2: nobody called "Dragon" is in the scene (knight, ranger).');
  expect(parseScript("just words", tl()).error).toBe('Line 1: write it as "Name: what they say".');
  expect(toScript(dialogueOf(tl()), tl())).toBe("knight: We rest here.\nranger: Something moves.");
});

test("spaceOut puts each line right after the one before, from a start time", () => {
  const out = spaceOut([{ who: "k1", text: "Hold.", voice: false, style: "bubble" }, { who: "r1", text: "I see them.", voice: false, style: "bubble" }], 3);
  expect(out.map((l) => l.t)).toEqual([3, 3 + sayDur("Hold.") + 0.3]);
});

test("setDialogue replaces the old lines: bubbles go on the actor's row, voice lines become voice clips; other moves and sounds stay", () => {
  const r = setDialogue(tl(), [
    { who: "r1", text: "Something moves.", voice: true, style: "bubble", t: 2 }, // same words: keeps its clip
    { who: "k1", text: "Then we fight.", voice: true, style: "box", t: 6 }, // new words: a new clip to generate
    { who: "r1", text: "Quietly.", voice: false, style: "bubble", t: 9 },
  ]);
  expect(r.error).toBeUndefined();
  expect(validateTimeline(r.tl)).toEqual([]);
  expect(r.tl.actors[0].actions.map((a) => a.do)).toEqual(["walk"]); // the old bubble went, the walk stayed
  expect(r.tl.actors[1].actions).toMatchObject([{ do: "say", text: "Quietly.", t: 9 }]);
  const voices = r.tl.audio.filter((a) => a.kind === "voice");
  expect(voices).toMatchObject([
    { t: 2, clip: "line_ranger_1", speaker: "ranger", line: "Something moves." },
    { t: 6, speaker: "knight", line: "Then we fight.", bubble: "box" },
  ]);
  expect(voices[1].clip).not.toBe("line_ranger_1");
  expect(r.tl.audio.some((a) => a.kind === "music")).toBe(true);
});
