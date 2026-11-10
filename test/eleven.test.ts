import { afterEach, expect, test, vi } from "vitest";
import { confirmPaid, type PaidTicket } from "../src/ai/confirm";
import { newProject } from "../src/core/project";
import { listVoices, sfx, sfxCost, sfxInto, speak, speakCost, speakInto } from "../src/gen/eleven";
import { audioPlan } from "../src/ui/eleven";
import voices from "./fixtures/eleven/voices.json?raw";

const KEY = "test-key";
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);
type Call = { url: string; init: RequestInit };
const serve = (...rs: (number | "mp3" | "voices" | "json" | "empty")[]) => {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = rs[Math.min(calls.length - 1, rs.length - 1)];
    if (typeof r === "number") return new Response("{}", { status: r });
    if (r === "json") return new Response('{"detail":"nope"}', { status: 200, headers: { "content-type": "application/json" } });
    if (r === "empty") return new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "audio/mpeg" } });
    return r === "voices" ? new Response(voices, { status: 200 }) : new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } });
  }));
  return calls;
};
const tk = async (calls = 1) => (await confirmPaid("elevenlabs", "test", "free", calls, async () => true)) as PaidTicket;
const hdr = (c: Call) => c.init.headers as Record<string, string>;
const body = (c: Call) => JSON.parse(c.init.body as string);
afterEach(() => vi.unstubAllGlobals());

test("speak_body_shape", async () => {
  const calls = serve("mp3");
  const blob = await speak(KEY, "v_aria_01", "Stay close.", await tk());
  expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/v_aria_01?output_format=mp3_44100_128");
  expect(calls[0].init.method).toBe("POST");
  expect(hdr(calls[0])["xi-api-key"]).toBe(KEY);
  expect(hdr(calls[0]).Authorization).toBeUndefined();
  expect(calls[0].url).not.toContain(KEY);
  expect(body(calls[0])).toMatchObject({ text: "Stay close.", model_id: "eleven_v3", voice_settings: { stability: 0.5, similarity_boost: 0.75 } });
  expect(blob.type).toBe("audio/mpeg");
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(MP3);
});
test("speak_model_override_and_id_escaped", async () => {
  const calls = serve("mp3");
  await speak(KEY, "a/b", "x", await tk(), "eleven_multilingual_v2");
  expect(calls[0].url).toContain("/text-to-speech/a%2Fb?");
  expect(body(calls[0]).model_id).toBe("eleven_multilingual_v2");
});
test("sfx_body_shape", async () => {
  const calls = serve("mp3");
  const blob = await sfx(KEY, "distant rumble of falling stone", 2.5, await tk());
  expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128");
  expect(hdr(calls[0])["xi-api-key"]).toBe(KEY);
  expect(body(calls[0])).toEqual({ text: "distant rumble of falling stone", duration_seconds: 2.5 });
  expect(blob.type).toBe("audio/mpeg");
});
test("sfx_seconds_clamped_to_api_range", async () => {
  const calls = serve("mp3", "mp3");
  await sfx(KEY, "x", 0.1, await tk());
  await sfx(KEY, "x", 99, await tk());
  expect([body(calls[0]).duration_seconds, body(calls[1]).duration_seconds]).toEqual([0.5, 30]);
});
test("calls_need_a_ticket", async () => {
  const f = serve("mp3");
  await expect(speak(KEY, "v", "hi", undefined as never)).rejects.toThrow();
  await expect(sfx(KEY, "boom", 1, {} as PaidTicket)).rejects.toThrow();
  expect(f).toHaveLength(0);
});
test("list_voices_is_free_get", async () => {
  const calls = serve("voices");
  expect(await listVoices(KEY)).toEqual([{ id: "v_aria_01", name: "Aria" }, { id: "v_old_02", name: "Old Knight" }]);
  expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/voices");
  expect(calls[0].init.method).toBe("GET");
  expect(hdr(calls[0])["xi-api-key"]).toBe(KEY);
});
test("provider_errors_are_named", async () => {
  serve(401);
  await expect(speak(KEY, "v", "hi", await tk())).rejects.toThrow("ElevenLabs rejected the key");
});

test("result_unapproved", async () => {
  const p = newProject("t");
  serve("mp3", "mp3");
  await speakInto(p, KEY, "vo_a", "Light keep us...", "v_aria_01", await tk());
  expect(p.kit.assets.vo_a).toMatchObject({ approved: false, source: "elevenlabs", kind: "voice" });
  expect(p.files.get(p.kit.assets.vo_a.path)?.type).toBe("audio/mpeg");
  await sfxInto(p, KEY, "sfx_rumble", "rumble", 2, await tk());
  expect(p.kit.assets.sfx_rumble).toMatchObject({ approved: false, source: "elevenlabs", kind: "sfx" });
});
test("redo_replaces_unapproved_file", async () => {
  const p = newProject("t");
  serve("mp3");
  await sfxInto(p, KEY, "s", "boom", 1, await tk());
  const first = p.kit.assets.s.path;
  await sfxInto(p, KEY, "s", "boom", 1, await tk());
  expect(p.files.has(first) && first !== p.kit.assets.s.path).toBe(false);
  expect(p.files.has(p.kit.assets.s.path)).toBe(true);
});
test("approved_piece_is_never_overwritten", async () => {
  const p = newProject("t");
  serve("mp3");
  await speakInto(p, KEY, "v", "hi", "vid", await tk());
  p.kit.assets.v.approved = true;
  const before = p.kit.assets.v.path;
  const f = vi.mocked(fetch);
  const n = f.mock.calls.length;
  await expect(speakInto(p, KEY, "v", "hi", "vid", await tk())).rejects.toThrow(/already approved/);
  expect(f.mock.calls.length).toBe(n); // refused before any paid call
  expect(p.kit.assets.v.path).toBe(before);
});
test("approved_while_running_is_kept", async () => {
  const p = newProject("t");
  serve("mp3");
  await speakInto(p, KEY, "v", "hi", "vid", await tk());
  const old = p.kit.assets.v.path;
  const t = await tk();
  const run = speakInto(p, KEY, "v", "hi", "vid", t);
  p.kit.assets.v.approved = true;
  await expect(run).rejects.toThrow(/already approved/);
  expect(p.kit.assets.v.path).toBe(old);
});
test("failure_changes_nothing", async () => {
  const p = newProject("t");
  serve(429);
  await expect(speakInto(p, KEY, "v", "hi", "vid", await tk())).rejects.toThrow("rate-limiting");
  expect(p.kit.assets.v).toBeUndefined();
  expect([...p.files.keys()]).toEqual([]);
});

test("char_count_in_cost_note", () => {
  expect(speakCost("Hello there")).toContain("11 characters");
  expect(speakCost("a")).toContain("1 character,");
  expect(sfxCost(3)).toContain("3 seconds");
});

test("non_audio_200_is_rejected_and_kit_unchanged", async () => {
  for (const r of ["json", "empty"] as const) {
    const p = newProject("t");
    serve(r);
    await expect(speakInto(p, KEY, "v", "hi", "vid", await tk())).rejects.toThrow("ElevenLabs returned something that is not audio. Nothing was added.");
    serve(r);
    await expect(sfxInto(p, KEY, "s", "boom", 1, await tk())).rejects.toThrow("not audio");
    expect(p.kit.assets).toEqual({});
    expect([...p.files.keys()]).toEqual([]);
  }
});
test("octet_stream_is_accepted", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(MP3, { status: 200, headers: { "content-type": "application/octet-stream" } })));
  expect((await speak(KEY, "v", "hi", await tk())).size).toBe(MP3.length);
});
test("plan_names_a_speaker_missing_from_the_cast", () => {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ elevenlabs: KEY }) });
  const p = newProject("t");
  p.tl = { name: "t", duration: 5, shots: [], actors: [], fx: [], audio: [{ id: "vo1", t: 1, clip: "vo", kind: "voice", line: "Hi", speaker: "ghost" }] };
  expect(audioPlan(p, "vo1", "voice").why).toBe("ghost is not in the cast. Pick a speaker in the inspector.");
});
