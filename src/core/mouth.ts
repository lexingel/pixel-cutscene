// Lip-sync for close-ups: while a face's character speaks (a voice line or a "say"), the close-up shows one of its
// mouth shapes per letter, MOUTH_MS each. A pure function of (timeline, t), so preview and export agree.
import type { Timeline } from "./types";

export const MOUTH_MS = 90; // PixelLab's own lip-sync default per mouth position

// ponytail: letter classes by index, not by PixelLab's viseme names (shape 0 is the closed/rest one, the first the
// job returns); switch to the free /v2/lip-sync plan if the shapes read wrong on real faces.
const CLOSED = /[\s.,!?;:'"…\-—mbp]/i;
const CLASS = ["a", "o", "ei", "u", "fv", "ltdn", "szcjkg", "rwqy", "h"];

export function mouthIndex(ch: string, n: number): number {
  if (n < 2 || CLOSED.test(ch)) return 0;
  const c = CLASS.findIndex((s) => s.includes(ch.toLowerCase()));
  return 1 + ((c < 0 ? ch.charCodeAt(0) : c) % (n - 1));
}

/** The mouth shape `face` shows at `t` out of `n`, or null when it is not speaking. */
export function mouthAt(tl: Timeline, face: string, t: number, n: number): number | null {
  const lines: [number, string][] = [];
  for (const a of tl.audio) if (a.kind === "voice" && a.speaker === face && a.line) lines.push([a.t, a.line]);
  for (const actor of tl.actors)
    if (actor.char === face) for (const a of actor.actions ?? []) if (a.do === "say" && a.text) lines.push([a.t, a.text]);
  for (const [t0, text] of lines) {
    const i = Math.floor(((t - t0) * 1000) / MOUTH_MS);
    if (i >= 0 && i < [...text].length) return mouthIndex([...text][i], n);
  }
  return null;
}
