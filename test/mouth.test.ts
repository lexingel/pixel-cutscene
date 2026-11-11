import { afterEach, expect, test, vi } from "vitest";
import miniText from "./fixtures/mini.json?raw";
import { confirmPaid, type PaidTicket } from "../src/ai/confirm";
import type { Img, Kit } from "../src/core/kit";
import { MOUTH_MS, mouthAt } from "../src/core/mouth";
import { newProject } from "../src/core/project";
import { renderFrame } from "../src/core/render";
import type { Timeline } from "../src/core/types";
import { genMouthsInto } from "../src/gen/pixellab";
import { figure, pngBytes, testIo, toBase64 } from "./png";

const solid = (w: number, h: number, r: number): Img => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([r, 0, 0, 255], i * 4);
  return { w, h, px };
};
const tl = (): Timeline => JSON.parse(miniText); // close-up of warrior 6-8 s; voice "...what is this place?" at 7 s
const speaking = (t: Timeline) => ((t.audio[1] as any).speaker = "warrior", t);

test("mouth_moves_only_while_the_face_speaks", () => {
  const t = speaking(tl());
  expect(mouthAt(t, "warrior", 6.5, 7)).toBeNull(); // before the line
  expect(mouthAt(t, "someone", 7.2, 7)).toBeNull(); // another speaker's face
  const line = "...what is this place?";
  const end = 7 + (line.length * MOUTH_MS) / 1000;
  expect(mouthAt(t, "warrior", end + 0.05, 7)).toBeNull(); // done talking
  const seen = new Set<number>();
  for (let x = 7; x < end; x += MOUTH_MS / 1000) seen.add(mouthAt(t, "warrior", x + 0.001, 7)!);
  expect(seen.size).toBeGreaterThan(2); // it really moves
  expect([...seen].every((i) => i >= 0 && i < 7)).toBe(true);
  expect(mouthAt(t, "warrior", 7.001, 7)).toBe(0); // "." is a closed mouth
});

test("a_say_line_moves_the_mouth_too", () => {
  const t = tl();
  t.actors.push({ id: "w1", char: "warrior", x: 0, y: 0, actions: [{ id: "s", t: 6.2, do: "say", text: "Ha" }] } as any);
  expect(mouthAt(t, "warrior", 6.25, 5)).not.toBeNull();
});

test("closeup_shows_the_mouth_frame_while_speaking", () => {
  const t = speaking(tl());
  const kit: Kit = { chars: {}, faces: { warrior: { neutral: { approved: true, source: "user", path: "f.png", mouths: ["m0.png", "m1.png", "m2.png"] } } }, assets: {} };
  const imgs: Record<string, Img> = { "f.png": solid(10, 10, 50), "m0.png": solid(10, 10, 60), "m1.png": solid(10, 10, 70), "m2.png": solid(10, 10, 80) };
  const out = solid(200, 120, 0);
  const draw = (s: number) => (renderFrame({ tl: t, kit, img: (p) => imgs[p] ?? null, draft: false, W: 200, H: 120 }, s, out), out.px[(115 * 200 + 100) * 4]);
  expect(draw(6.5)).toBe(50); // silent: the still face
  const reds = new Set<number>();
  for (let s = 7; s < 8; s += 0.03) reds.add(draw(s));
  expect([...reds].some((r) => r === 70 || r === 80)).toBe(true);
});

afterEach(() => vi.unstubAllGlobals());
test("mouths_are_generated_from_the_approved_face", async () => {
  const calls: { url: string; body?: any }[] = [];
  const shape = toBase64(pngBytes(figure(32, 32, 11, 14)));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined });
    if (url.endsWith("/vocal-animation")) return new Response(JSON.stringify({ background_job_id: "v1" }));
    return new Response(JSON.stringify({ status: "completed", completed_visemes: ["rest", "A", "O"], visemes: { O: { base64: shape }, rest: { base64: shape }, A: { base64: shape } } }));
  }));
  const p = newProject("t");
  p.files.set("faces/hero/angry.png", new Blob([pngBytes(figure(32, 32, 11, 14)) as BlobPart]));
  p.kit.faces.hero = { angry: { approved: true, source: "user", path: "faces/hero/angry.png" } };
  const tk = (await confirmPaid("pixellab", "t", "free", 1, async () => true)) as PaidTicket;
  await genMouthsInto(p, "k", "hero", "angry", tk, testIo);
  expect(calls[0].body).toMatchObject({ mood: "angry", viseme_count: 7, engine: "pixminimax" });
  expect(calls[0].body.portrait.base64.length).toBeGreaterThan(10);
  expect(calls[1].url).toBe("https://api.pixellab.ai/v2/vocal-animation/v1");
  const m = p.kit.faces.hero.angry.mouths!;
  expect(m.map((x) => x.split("/").pop())).toEqual(["rest.png", "A.png", "O.png"]); // in the job's order: closed first
  expect(m.every((x) => p.files.has(x))).toBe(true);
});
