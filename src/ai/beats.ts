// Step one of a two-step draft: the scene as a short numbered beat list the user can read and change,
// before any timeline is written. Step two is draftScene with the beat list added to the description.
import { readyChars, type Kit } from "../core/kit";
import type { PaidTicket } from "./confirm";
import type { Keys } from "./keys";
import { chat } from "./providers";
import { extractJson } from "./sceneDraft";
import { library } from "./scenePrompt";

export type Beat = { text: string; shot?: string; move?: string; fx?: string; sound?: string };
const HINTS = ["shot", "move", "fx", "sound"] as const;

export function parseBeats(raw: unknown): Beat[] {
  const list = Array.isArray(raw) ? raw : (raw as { beats?: unknown } | null)?.beats;
  if (!Array.isArray(list)) return [];
  return list.flatMap((b) => {
    if (!b || typeof b !== "object" || typeof b.text !== "string" || !b.text.trim()) return [];
    const out: Beat = { text: b.text.trim() };
    for (const k of HINTS) if (typeof b[k] === "string" && b[k].trim()) out[k] = b[k].trim();
    return [out];
  });
}

/** 1. The heroes walk in. [wide · move: walk · fx: fire/torch · sound: steps] */
export const beatsToText = (bs: Beat[]) =>
  bs.map((b, i) => {
    const h = [b.shot, ...(["move", "fx", "sound"] as const).filter((k) => b[k]).map((k) => `${k}: ${b[k]}`)].filter(Boolean);
    return `${i + 1}. ${b.text}${h.length ? ` [${h.join(" · ")}]` : ""}`;
  }).join("\n");

export const withBeats = (description: string, beats: string) =>
  `${description}\n\nBeat list (follow it in order; each beat is a few seconds of the timeline):\n${beats.trim()}`;

export async function draftBeats(keys: Keys, kit: Kit, description: string, ticket: PaidTicket, chatFn: typeof chat = chat): Promise<{ ok: true; beats: Beat[] } | { ok: false; error: string }> {
  if (!keys.ai) return { ok: false, error: "No AI key is set. Add one in Settings." };
  const system = `You plan pixel-art cutscenes before they are animated. Reply with one JSON object: {"beats": [{"text": "...", "shot": "wide" | "close-up", "move": "...", "fx": "...", "sound": "..."}]}.
- 4 to 10 beats, in order, each one plain sentence of what we see or hear (a few seconds each; the whole scene 10 to 40 seconds).
- "shot", "move", "fx" and "sound" are optional hints: the shot type, the main move (walk, say, attack, hurt, dust, look_around, startle), a library effect, a sound.
- Characters ready in the kit: ${readyChars(kit).join(", ") || "(none yet; name the ones the scene needs)"}.
Library effects: ${library().split("\n").slice(0, 40).join(" ")}
Return only JSON.`;
  try {
    const beats = parseBeats(extractJson(await chatFn(keys.ai, system, `Scene description:\n${description}`, ticket)));
    return beats.length ? { ok: true, beats } : { ok: false, error: "The reply had no beats. Try again." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
