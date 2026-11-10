import type { AudioEntry } from "./types";

/** Which clips sound at time t, and from where, sorted by id. Clips stop at the scene's end. */
export function activeAudio(audio: AudioEntry[], t: number, lengths: Record<string, number>, duration: number) {
  const out: { id: string; offset: number }[] = [];
  for (const e of audio) {
    const end = Math.min(e.t + (lengths[e.clip] ?? 0), duration);
    if (t >= e.t && t < end) out.push({ id: e.id, offset: t - e.t });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
