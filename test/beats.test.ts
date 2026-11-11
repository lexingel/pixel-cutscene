import { expect, test } from "vitest";
import { beatsToText, draftBeats, parseBeats, withBeats } from "../src/ai/beats";
import type { PaidTicket } from "../src/ai/confirm";
import type { Kit } from "../src/core/kit";

const keys = { ai: { provider: "anthropic", model: "m", key: "k" } } as const;
const kit = { chars: {}, faces: {}, assets: {} } as unknown as Kit;
const stub = (...replies: string[]) => {
  const calls: { s: string; u: string }[] = [];
  const fn = async (_ai: unknown, s: string, u: string) => (calls.push({ s, u }), replies[calls.length - 1] ?? replies.at(-1)!);
  return { fn: fn as never, calls };
};

test("parseBeats keeps the beats that have words, with their hints; beatsToText numbers them one per line", () => {
  const b = parseBeats({ beats: [{ text: " The heroes walk in. ", shot: "wide", move: "walk", fx: 3 }, { text: "" }, "nope", { text: "A dragon roars.", shot: "close-up", sound: "roar" }] });
  expect(b).toEqual([{ text: "The heroes walk in.", shot: "wide", move: "walk" }, { text: "A dragon roars.", shot: "close-up", sound: "roar" }]);
  expect(beatsToText(b)).toBe("1. The heroes walk in. [wide · move: walk]\n2. A dragon roars. [close-up · sound: roar]");
  expect(withBeats("A cave.", "1. In.")).toBe("A cave.\n\nBeat list (follow it in order; each beat is a few seconds of the timeline):\n1. In.");
});

test("draftBeats: one call with the scene and the kit; a reply with no beats is an error", async () => {
  const s = stub(JSON.stringify({ beats: [{ text: "They enter.", shot: "wide" }] }));
  const r = await draftBeats(keys, kit, "Heroes enter a cave.", {} as PaidTicket, s.fn);
  expect(r).toEqual({ ok: true, beats: [{ text: "They enter.", shot: "wide" }] });
  expect(s.calls).toHaveLength(1);
  expect(s.calls[0].u).toContain("Heroes enter a cave.");
  expect(s.calls[0].s).toContain('"beats"');
  const bad = await draftBeats(keys, kit, "x", {} as PaidTicket, stub("sorry").fn);
  expect(bad).toEqual({ ok: false, error: "The reply had no beats. Try again." });
});
