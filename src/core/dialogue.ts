// The scene's dialogue as one list: bubbles (say moves) and voice lines (voice clips), read and written together.
import { sayDur } from "./bubbles";
import { actorName } from "./labels";
import type { Action, AudioEntry, Timeline } from "./types";

export type Style = "bubble" | "box";
/** who: an actor id. voice: spoken (a voice clip, its bubble shown for it) rather than a silent bubble. */
export type Line = { who: string; text: string; voice: boolean; style: Style; t: number; key?: string };

const GAP = 0.3; // between one line ending and the next starting
const snap = (t: number) => Math.round(t * 30) / 30;
/** How long a line holds the screen: the read time, or a voice clip's length when it is longer. */
export const lineLen = (text: string, clipLen = 0) => Math.max(sayDur(text), clipLen);

export function dialogueOf(tl: Timeline): Line[] {
  const out: Line[] = [];
  for (const a of tl.actors)
    for (const x of a.actions) if (x.do === "say") out.push({ who: a.id, text: x.text ?? "", voice: false, style: x.style ?? "bubble", t: x.t, key: x.id });
  for (const e of tl.audio) {
    if (e.kind !== "voice") continue;
    const who = tl.actors.find((a) => a.char === e.speaker)?.id ?? tl.actors[0]?.id ?? "";
    out.push({ who, text: e.line ?? "", voice: true, style: e.bubble === "box" ? "box" : "bubble", t: e.t, key: e.id });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function toScript(lines: Line[], tl: Timeline): string {
  return lines.map((l) => `${actorName(tl, l.who)}: ${l.text}`).join("\n");
}

/** "Name: words" per line (blank lines skipped). A name is an actor's shown name or its character, any case. */
export function parseScript(text: string, tl: Timeline): { lines: { who: string; text: string }[]; error?: string } {
  const names = new Map<string, string>();
  for (const a of tl.actors) {
    names.set(actorName(tl, a.id).toLowerCase(), a.id);
    if (!names.has(a.char.toLowerCase())) names.set(a.char.toLowerCase(), a.id);
  }
  const lines: { who: string; text: string }[] = [];
  const rows = text.split(/\r?\n/);
  for (const [i, raw] of rows.entries()) {
    if (!raw.trim()) continue;
    const m = raw.match(/^\s*([^:]+?)\s*:\s*(.+?)\s*$/);
    if (!m) return { lines, error: `Line ${i + 1}: write it as "Name: what they say".` };
    const who = names.get(m[1].toLowerCase());
    if (!who) return { lines, error: `Line ${i + 1}: nobody called "${m[1]}" is in the scene (${tl.actors.map((a) => actorName(tl, a.id)).join(", ")}).` };
    lines.push({ who, text: m[2] });
  }
  return { lines };
}

/** Times the lines one after another from `start`; clipLen gives a voice clip's length when it is known. */
export function spaceOut<T extends Omit<Line, "t">>(lines: T[], start: number, clipLen: (l: T) => number = () => 0): (T & { t: number })[] {
  let t = start;
  return lines.map((l) => {
    const out = { ...l, t: snap(t) };
    t += lineLen(l.text, l.voice ? clipLen(l) : 0) + GAP;
    return out;
  });
}

/** Swaps the scene's dialogue for `lines`. A voice line whose speaker and words are unchanged keeps its clip;
 * changed words get a new clip id (it shows in Needs approval, to generate). Everything else is left as it was. */
export function setDialogue(tl: Timeline, lines: Line[]): { tl: Timeline; error?: string } {
  const c = structuredClone(tl);
  const oldVoice = new Map(c.audio.filter((e) => e.kind === "voice").map((e) => [`${e.speaker}\u0000${e.line}`, e]));
  const used = new Set(c.audio.map((e) => e.clip));
  for (const a of c.actors) a.actions = a.actions.filter((x) => x.do !== "say");
  c.audio = c.audio.filter((e) => e.kind !== "voice");
  const ids = new Set<string>([...c.shots, ...c.actors, ...c.fx, ...c.audio, ...c.actors.flatMap((a) => a.actions)].map((x) => x.id));
  const fresh = (prefix: string) => {
    let n = 1;
    while (ids.has(prefix + n)) n++;
    ids.add(prefix + n);
    return prefix + n;
  };
  for (const l of lines) {
    const actor = c.actors.find((a) => a.id === l.who);
    if (!actor) return { tl, error: `${l.who} is not in the scene.` };
    const text = l.text.trim();
    if (!text) continue;
    const t = Math.min(Math.max(snap(l.t), 0), c.duration);
    if (l.voice) {
      const kept = oldVoice.get(`${actor.char}\u0000${text}`);
      let clip = kept?.clip;
      if (!clip) {
        let n = 1;
        while (used.has(`line_${actor.char}_${n}`)) n++;
        clip = `line_${actor.char}_${n}`;
        used.add(clip);
      }
      const e: AudioEntry = { ...(kept ?? {}), id: fresh("line"), t, clip, kind: "voice", speaker: actor.char, line: text };
      if (l.style === "box") e.bubble = "box";
      else delete e.bubble;
      c.audio.push(e);
    } else {
      const x: Action = { id: fresh("a"), t, do: "say", text };
      if (l.style === "box") x.style = "box";
      actor.actions.push(x);
      actor.actions.sort((p, q) => p.t - q.t);
    }
  }
  c.audio.sort((a, b) => a.t - b.t);
  return { tl: c };
}
