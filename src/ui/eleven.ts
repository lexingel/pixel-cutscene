// ElevenLabs in the UI: Generate for voice and sound-effect rows of Needs approval, and the voice picker.
// Every paid call is minted here through confirmPaid.
import { confirmPaid, type PaidTicket } from "../ai/confirm";
import { getKeys } from "../ai/keys";
import type { Project } from "../core/project";
import { listVoices, sfxCost, sfxInto, speakCost, speakInto } from "../gen/eleven";
import { toast } from "./dialogs";
import { find } from "./timelineEditor";

export const NO_KEY = "Add an ElevenLabs key in Settings to generate.";
export const elevenKey = () => getKeys().elevenlabs;
export const SFX_SECONDS = 2; // ponytail: fixed length; a per-sound length field when someone asks

async function paid(action: string, cost: string, run: (key: string, t: PaidTicket) => Promise<void>): Promise<boolean> {
  const key = elevenKey();
  if (!key) return toast(NO_KEY, "error"), false;
  const t = await confirmPaid("elevenlabs", action, cost, 1);
  if (!t) return false;
  try {
    await run(key, t);
    return true;
  } catch (e) {
    toast((e as Error).message, "error");
    return false;
  }
}

// What a voice/sfx row would make, or why it cannot. `id` is the audio entry that uses the clip.
export function audioPlan(p: Project, usedBy: string, kind: string): { label: string; why?: string; line?: string; voice?: string; prompt?: string } {
  const label = "Generate";
  if (!elevenKey()) return { label, why: NO_KEY };
  const at = p.tl && find(p.tl, usedBy);
  const e = at?.kind === "audio" ? at.e : null;
  if (!e) return { label, why: "Nothing to generate for this row" };
  if (kind === "music") return { label, why: "ElevenLabs makes voices and sound effects, not music" };
  if (kind === "sfx") return { label, prompt: String(e.line || e.clip).replace(/^sfx[_-]/, "").replace(/[_-]+/g, " ").trim() };
  const line = String(e.line ?? "").trim();
  if (!line) return { label, why: "Type the voice line in the inspector first" };
  if (!e.speaker) return { label, why: "Pick who speaks this line in the inspector" };
  if (!p.kit.chars[e.speaker]) return { label, why: `${e.speaker} is not in the cast. Pick a speaker in the inspector.` };
  const voice = p.kit.chars[e.speaker]?.voice;
  if (!voice) return { label, why: `Pick a voice for ${e.speaker} in the inspector` };
  return { label, line, voice };
}

export function generateAudio(p: Project, id: string, usedBy: string, kind: string, done: () => void): Promise<boolean> {
  const plan = audioPlan(p, usedBy, kind);
  if (plan.why) return toast(plan.why, "error"), Promise.resolve(false);
  const ok = plan.line
    ? paid(`Generate voice line ${id}`, speakCost(plan.line), (k, t) => speakInto(p, k, id, plan.line!, plan.voice!, t))
    : paid(`Generate sound ${id}`, sfxCost(SFX_SECONDS), (k, t) => sfxInto(p, k, id, plan.prompt!, SFX_SECONDS, t));
  return ok.then((r) => (r && (toast("Generated. Listen, then Approve or Redo."), done()), r));
}

// Voices of this key, fetched once (free read).
let cache: { key: string; voices: Promise<{ id: string; name: string }[]> } | null = null;
export function voicesFor(key: string) {
  if (cache?.key !== key) {
    const voices = listVoices(key);
    voices.catch(() => (cache = null));
    cache = { key, voices };
  }
  return cache.voices;
}
