import type { Project } from "../core/project";

export const MIX_RATE = 48000;
const FADE = 0.01; // a clip cut by the scene's end fades out over its last 10 ms, so it never clicks

/** Decodes one audio file of the project. Shared by the Tweak preview and the export mix. */
export const decodeAudio = async (ctx: BaseAudioContext, p: Project, path: string) =>
  ctx.decodeAudioData(await p.files.get(path)!.arrayBuffer());

/** The scene's sound, mixed offline: 48 kHz stereo, exactly the scene's duration. Mirrors activeAudio(). */
export async function mixAudio(p: Project, decode: (path: string) => Promise<AudioBuffer>): Promise<AudioBuffer> {
  const tl = p.tl!;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.round(tl.duration * MIX_RATE)), MIX_RATE);
  const bufs = new Map<string, Promise<AudioBuffer>>(); // by path, decoded once
  for (const e of tl.audio) {
    const a = p.kit.assets[e.clip];
    if (!a || !p.files.has(a.path)) continue; // missing pieces were refused before (or are allowed in a draft)
    if (!bufs.has(a.path)) bufs.set(a.path, decode(a.path));
    const buf = await bufs.get(a.path)!;
    const end = Math.min(e.t + buf.duration, tl.duration);
    if (end <= e.t) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const v = 10 ** ((e.vol_db ?? 0) / 20);
    gain.gain.value = v;
    if (end < e.t + buf.duration) {
      gain.gain.setValueAtTime(v, Math.max(e.t, end - FADE));
      gain.gain.linearRampToValueAtTime(0, end);
    }
    src.connect(gain).connect(ctx.destination);
    src.start(e.t);
    src.stop(end);
  }
  return ctx.startRendering();
}
