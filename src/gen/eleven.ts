/* ElevenLabs (https://elevenlabs.io/docs/api-reference). The key goes only in the xi-api-key header.
 * - listVoices: GET /v1/voices (free; callFree).
 * - speak: POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128, body {text, model_id, voice_settings}.
 *     Cost: billed per character of text (1 credit per character on eleven_v3).
 * - sfx: POST /v1/sound-generation, body {text, duration_seconds (0.5-30)}.
 *     Cost: 20 credits per second when a duration is given (100 per generation when left to auto).
 * Credit figures are from the docs as read; not confirmed by a live call. Audio comes back as raw mp3 bytes.
 */
import { callApi, callFree } from "../ai/http";
import type { PaidTicket } from "../ai/confirm";
import { freePath } from "../core/cast";
import type { Project } from "../core/project";

const API = "https://api.elevenlabs.io/v1";
const OUT = "?output_format=mp3_44100_128";
const auth = (key: string) => ({ "xi-api-key": key });
const json = (key: string) => ({ "content-type": "application/json", ...auth(key) });

export const speakCost = (text: string): string => {
  const n = [...text].length;
  return `${n} ${n === 1 ? "character" : "characters"}, about ${n} credits (billed per character).`;
};
export const sfxCost = (seconds: number): string => `${seconds} seconds, about ${Math.round(seconds * 20)} credits (20 per second).`;

export async function listVoices(key: string): Promise<{ id: string; name: string }[]> {
  const j = await (await callFree("elevenlabs", `${API}/voices`, { headers: auth(key) })).json();
  return ((j.voices ?? []) as { voice_id: string; name: string }[]).map((v) => ({ id: v.voice_id, name: v.name }));
}

// A 200 is not enough: the body must be audio, or a JSON error page would land as a sound.
const audio = async (res: Response) => {
  const type = res.headers.get("content-type") ?? "";
  const bytes = await res.arrayBuffer();
  if (!(type.startsWith("audio/") || type.startsWith("application/octet-stream")) || !bytes.byteLength)
    throw new Error("ElevenLabs returned something that is not audio. Nothing was added.");
  return new Blob([bytes], { type: "audio/mpeg" });
};

export async function speak(key: string, voiceId: string, text: string, ticket: PaidTicket, model = "eleven_v3"): Promise<Blob> {
  const body = { text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } };
  return audio(await callApi("elevenlabs", `${API}/text-to-speech/${encodeURIComponent(voiceId)}${OUT}`, { method: "POST", headers: json(key), body: JSON.stringify(body) }, ticket));
}

export async function sfx(key: string, prompt: string, seconds: number, ticket: PaidTicket): Promise<Blob> {
  const body = { text: prompt, duration_seconds: Math.min(30, Math.max(0.5, seconds)) };
  return audio(await callApi("elevenlabs", `${API}/sound-generation${OUT}`, { method: "POST", headers: json(key), body: JSON.stringify(body) }, ticket));
}

// Generated work never lands over a piece the user approved, even one approved while the call ran.
const guard = (p: Project, id: string) => {
  if (p.kit.assets[id]?.approved) throw new Error(`${id} is already approved. Nothing was replaced.`);
};

function land(p: Project, id: string, kind: "voice" | "sfx", blob: Blob): void {
  guard(p, id);
  const old = p.kit.assets[id];
  if (old) p.files.delete(old.path);
  const path = freePath(p, "audio/", `${id}.mp3`);
  p.files.set(path, blob);
  p.kit.assets[id] = { approved: false, source: "elevenlabs", kind, path };
}

export async function speakInto(p: Project, key: string, id: string, text: string, voiceId: string, ticket: PaidTicket): Promise<void> {
  guard(p, id);
  land(p, id, "voice", await speak(key, voiceId, text, ticket));
}

export async function sfxInto(p: Project, key: string, id: string, prompt: string, seconds: number, ticket: PaidTicket): Promise<void> {
  guard(p, id);
  land(p, id, "sfx", await sfx(key, prompt, seconds, ticket));
}
