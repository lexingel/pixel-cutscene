import { afterEach, expect, test, vi } from "vitest";
import { confirmPaid, type PaidTicket } from "../src/ai/confirm";
import { ProviderError } from "../src/ai/http";
import { buildScenePrompt } from "../src/ai/scenePrompt";
import { readyChars } from "../src/core/kit";
import { newProject } from "../src/core/project";
import {
  approvePiece, approveRef, balance, genAnim, genAnimInto, genBackground, genBackgroundInto, genCharacter, genFace, genFaceInto, MOTION, refPath, trimShared,
} from "../src/gen/pixellab";
import { figure, pngBytes, testIo, toBase64 } from "./png";
import accepted from "./fixtures/pixellab/job-accepted.json?raw";
import animDone from "./fixtures/pixellab/job-anim-completed.json?raw";
import bal from "./fixtures/pixellab/balance.json?raw";
import created from "./fixtures/pixellab/create-image-pixen.json?raw";
import editDone from "./fixtures/pixellab/job-edit-completed.json?raw";
import failed from "./fixtures/pixellab/job-failed.json?raw";
import processing from "./fixtures/pixellab/job-processing.json?raw";

const FX: Record<string, string> = {
  "job-accepted": accepted, "job-anim-completed": animDone, balance: bal, "create-image-pixen": created,
  "job-edit-completed": editDone, "job-failed": failed, "job-processing": processing,
};
const fx = (n: string) => FX[n];
const KEY = "test-key";
type Call = { url: string; init: RequestInit };
// Serves fixtures in order; the last one repeats.
const serve = (...rs: (string | number)[]) => {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = rs[Math.min(calls.length - 1, rs.length - 1)];
    return typeof r === "number" ? new Response("{}", { status: r }) : new Response(fx(r), { status: 200 });
  }));
  return calls;
};
const tk = async (calls = 1) => (await confirmPaid("pixellab", "test", "free", calls, async () => true)) as PaidTicket;
const body = (c: Call) => JSON.parse(c.init.body as string);
const b64 = (img: ReturnType<typeof figure>) => toBase64(pngBytes(img));
afterEach(() => vi.unstubAllGlobals());

// A project with a generated, approved reference and nothing else.
async function withRef() {
  const p = newProject("t");
  await approveRef(p, "hero", figure(32, 32, 11, 14), testIo);
  return p;
}

test("request_uses_ref_image", async () => {
  const ref = figure(32, 32, 11, 14);
  const calls = serve("job-accepted", "job-processing", "job-anim-completed");
  const frames = await genAnim(KEY, ref, "walk", "a knight", await tk(), testIo);
  expect(calls[0].url).toBe("https://api.pixellab.ai/v2/animate-pixminimax");
  expect(calls[0].init.method).toBe("POST");
  expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  expect(body(calls[0]).first_frame).toMatchObject({ type: "base64", base64: b64(ref) });
  expect(body(calls[0])).toMatchObject({ view: "side", direction: "east", subject_description: "a knight" });
  // polling is free GETs of the job, never new paid calls
  expect(calls.slice(1).map((c) => [c.init.method ?? "GET", c.url])).toEqual([
    ["GET", "https://api.pixellab.ai/v2/background-jobs/job_1"],
    ["GET", "https://api.pixellab.ai/v2/background-jobs/job_1"],
  ]);
  expect(frames).toHaveLength(4); // a walk loops: the reference (frame 0) would stand still once a cycle
  // trimmed to one shared rect: same size, bottom-centred
  expect(new Set(frames.map((f) => `${f.w}x${f.h}`)).size).toBe(1);
  expect(frames[0].h).toBe(16);
});

test("face_edits_base_face_or_uses_body", async () => {
  const body1 = figure(30, 30, 10, 10);
  let calls = serve("job-accepted", "job-edit-completed");
  await genFace(KEY, body1, "amazed", undefined, await tk(), testIo);
  expect(calls[0].url).toBe("https://api.pixellab.ai/v2/edit-image-pixen");
  const sent = body(calls[0]);
  expect(sent.description).toMatch(/portrait/);
  expect(sent.description).toMatch(/amazed/);
  expect(sent.image.base64).not.toBe(b64(body1)); // padded to 32x32: sides must be multiples of 4
  const base = figure(64, 64, 20, 20, 24, 24);
  calls = serve("job-accepted", "job-edit-completed");
  const face = await genFace(KEY, body1, "amazed", base, await tk(), testIo);
  expect(body(calls[0]).image.base64).toBe(b64(base));
  expect(face.w).toBe(64);
});

test("character_gives_4_candidates_on_one_ticket", async () => {
  const calls = serve("create-image-pixen");
  const c = await genCharacter(KEY, "a knight", 64, await tk(4), testIo);
  expect(c).toHaveLength(4);
  expect(calls).toHaveLength(4);
  expect(calls[0].url).toBe("https://api.pixellab.ai/v2/create-image-pixen");
  expect(body(calls[0])).toMatchObject({ image_size: { width: 64, height: 64 }, view: "side", direction: "east", no_background: true });
  expect(new Set(calls.map((x) => body(x).seed)).size).toBe(4);
  await expect(genCharacter(KEY, "a knight", 64, await tk(3), testIo)).rejects.toThrow(/Blocked/);
});

test("background_size_fits_the_api", async () => {
  const calls = serve("create-image-pixen");
  await genBackground(KEY, "a cave", 480, 270, await tk(), testIo);
  expect(body(calls[0])).toMatchObject({ image_size: { width: 480, height: 272 }, no_background: false });
});

test("balance_is_free_and_readable", async () => {
  const calls = serve("balance");
  expect((await balance(KEY)).text).toBe("$4.20 credits, 450 of 2000 generations left");
  expect(calls[0].url).toBe("https://api.pixellab.ai/v2/balance");
});

test("results_unapproved", async () => {
  const p = await withRef();
  serve("job-accepted", "job-anim-completed");
  await genAnimInto(p, KEY, "hero", "idle", "a knight", await tk(), testIo);
  const idle = p.kit.chars.hero.anims.idle;
  expect(idle).toMatchObject({ approved: false, source: "pixellab", ref: refPath("hero") });
  expect(idle.frames).toHaveLength(4);
  expect(idle.frames.every((f) => p.files.has(f))).toBe(true);
});

test("approve_flow_sets_approved", async () => {
  const p = newProject("t");
  serve("create-image-pixen");
  const cands = await genCharacter(KEY, "a knight", 32, await tk(4), testIo);
  await approveRef(p, "hero", cands[2], testIo);
  expect(p.files.has(refPath("hero"))).toBe(true);
  serve("job-accepted", "job-anim-completed");
  await genAnimInto(p, KEY, "hero", "idle", "a knight", await tk(), testIo);
  expect(p.kit.chars.hero.anims.idle.approved).toBe(false);
  approvePiece(p.kit, { kind: "anim", char: "hero", anim: "idle" });
  expect(p.kit.chars.hero.anims.idle.approved).toBe(true);
  // a face for it, from the body sprite, lands unapproved too
  serve("job-accepted", "job-edit-completed");
  await genFaceInto(p, KEY, "hero", "neutral", await tk(), testIo);
  expect(p.kit.faces.hero.neutral).toMatchObject({ approved: false, source: "pixellab" });
  approvePiece(p.kit, { kind: "face", face: "hero", expr: "neutral" });
  expect(p.kit.faces.hero.neutral.approved).toBe(true);
});

test("402_leaves_kit_unchanged", async () => {
  const p = await withRef();
  const snap = () => [structuredClone(p.kit), [...p.files.keys()]];
  const before = snap();
  serve(402);
  const e = await genAnimInto(p, KEY, "hero", "idle", "a knight", await tk(), testIo).catch((x) => x);
  expect(e).toBeInstanceOf(ProviderError);
  expect(e.message).toBe("PixelLab says the account is out of credits");
  expect(snap()).toEqual(before);
  // a failed job and an unreadable result leave it unchanged too
  serve("job-accepted", "job-failed");
  await expect(genAnimInto(p, KEY, "hero", "idle", "a knight", await tk(), testIo)).rejects.toThrow("The model declined this request");
  serve("job-accepted", "job-anim-completed");
  const bad = { ...testIo, decode: async () => Promise.reject(new Error("not a PNG")) };
  await expect(genAnimInto(p, KEY, "hero", "idle", "a knight", await tk(), bad)).rejects.toThrow();
  expect(snap()).toEqual(before);
});

test("idle_required_before_use", async () => {
  const p = await withRef();
  expect(readyChars(p.kit)).toEqual([]);
  serve("job-accepted", "job-anim-completed");
  await genAnimInto(p, KEY, "hero", "idle", "a knight", await tk(), testIo);
  expect(readyChars(p.kit)).toEqual([]);
  expect(buildScenePrompt(p.kit, { W: 960, H: 540 }, "x", null).system).not.toMatch(/- hero:/);
  approvePiece(p.kit, { kind: "anim", char: "hero", anim: "idle" });
  expect(readyChars(p.kit)).toEqual(["hero"]);
  expect(buildScenePrompt(p.kit, { W: 960, H: 540 }, "x", null).system).toMatch(/- hero:/);
});

// Lowest opaque row and the centre of that row's opaque span.
const feet = (img: ReturnType<typeof figure>) => {
  for (let y = img.h - 1; y >= 0; y--) {
    const xs = [...Array(img.w).keys()].filter((x) => img.px[(y * img.w + x) * 4 + 3]);
    if (xs.length) return { y, cx: (xs[0] + xs.at(-1)!) / 2 };
  }
  return null;
};

test("mixed_frame_sizes_keep_feet_bottom_centre", () => {
  // each frame's figure stands on its own bottom edge, centred
  const a = figure(20, 30, 7, 14, 6, 16);
  const b = figure(24, 34, 9, 18, 6, 16);
  const [ta, tb] = trimShared([a, b]);
  expect(ta.w).toBe(tb.w);
  expect(ta.h).toBe(tb.h);
  expect(feet(ta)).toEqual(feet(tb));
  expect(feet(ta)!.y).toBe(ta.h - 1);
});

test("approved_piece_is_never_overwritten", async () => {
  const p = await withRef();
  serve("job-accepted", "job-anim-completed");
  await genAnimInto(p, KEY, "hero", "idle", "a knight", await tk(), testIo);
  approvePiece(p.kit, { kind: "anim", char: "hero", anim: "idle" });
  serve("job-accepted", "job-edit-completed");
  await genFaceInto(p, KEY, "hero", "neutral", await tk(), testIo);
  approvePiece(p.kit, { kind: "face", face: "hero", expr: "neutral" });
  serve("create-image-pixen");
  await genBackgroundInto(p, KEY, "cave", "a cave", await tk(), testIo);
  approvePiece(p.kit, { kind: "asset", id: "cave" });
  const snap = () => [structuredClone(p.kit), [...p.files.keys()]];
  const before = snap();
  serve("job-accepted", "job-anim-completed");
  await expect(genAnimInto(p, KEY, "hero", "idle", "", await tk(), testIo)).rejects.toThrow("already approved");
  serve("job-accepted", "job-edit-completed");
  await expect(genFaceInto(p, KEY, "hero", "neutral", await tk(), testIo)).rejects.toThrow("already approved");
  serve("create-image-pixen");
  await expect(genBackgroundInto(p, KEY, "cave", "a cave", await tk(), testIo)).rejects.toThrow("already approved");
  expect(snap()).toEqual(before);
});

test("approved_while_running_is_not_overwritten", async () => {
  const p = await withRef();
  serve("job-accepted", "job-anim-completed");
  await genAnimInto(p, KEY, "hero", "idle", "a knight", await tk(), testIo);
  const before = structuredClone(p.kit);
  // Redo starts, then the user approves the current idle before the result lands
  serve("job-accepted", "job-processing", "job-anim-completed");
  const io = { ...testIo, wait: async () => approvePiece(p.kit, { kind: "anim", char: "hero", anim: "idle" }) };
  await expect(genAnimInto(p, KEY, "hero", "idle", "", await tk(), io)).rejects.toThrow("already approved");
  expect(p.kit.chars.hero.anims.idle.frames).toEqual(before.chars.hero.anims.idle.frames);
  expect(p.kit.chars.hero.anims.idle.frames.every((f) => p.files.has(f))).toBe(true);
});

test("approveRef_refuses_a_taken_name", async () => {
  const p = await withRef();
  const ref = p.files.get(refPath("hero"));
  await expect(approveRef(p, "hero", figure(32, 32, 1, 1), testIo)).rejects.toThrow("already in the cast");
  expect(p.files.get(refPath("hero"))).toBe(ref);
});

test("poll_blip_after_paid_post_keeps_waiting", async () => {
  // a 429 and a 500 on status reads do not throw away the paid job
  const calls = serve("job-accepted", 429, 500, "job-anim-completed");
  const frames = await genAnim(KEY, figure(32, 32, 11, 14), "walk", "a knight", await tk(), testIo);
  expect(frames).toHaveLength(4);
  expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
});

test("background_prompt_says_empty", async () => {
  const calls = serve("create-image-pixen");
  await genBackground(KEY, "a cave", 480, 270, await tk(), testIo);
  const d = body(calls[0]).description;
  expect(d.startsWith("a cave")).toBe(true);
  expect(d).toMatch(/seen from the side/);
  expect(d).toMatch(/sky.*horizon.*ground along the bottom/);
  expect(d).toMatch(/no characters, creatures, text or UI/);
});

test("gargantuan_ref_saved_with_scale_2", async () => {
  const p = newProject("t");
  await approveRef(p, "wyrm", figure(200, 200, 10, 10), testIo, { size: "gargantuan", scale: 2 });
  expect(p.kit.chars.wyrm).toMatchObject({ scale: 2, size: "gargantuan" });
  await approveRef(p, "imp", figure(32, 32, 10, 10), testIo);
  expect(p.kit.chars.imp.scale).toBeUndefined();
});

test("breathe_motion_and_an_edited_prompt_reach_the_request", async () => {
  expect(MOTION.breathe).toMatch(/jaws wide open/);
  expect(MOTION.breathe).toMatch(/no fire/); // the flame is a separate effect placed at the mouth
  const calls = serve("job-accepted", "job-anim-completed");
  await genAnim(KEY, figure(32, 32, 11, 14), "breathe", "a dragon", await tk(), testIo);
  expect(body(calls[0]).description).toBe(MOTION.breathe);
  const c2 = serve("job-accepted", "job-anim-completed");
  await genAnim(KEY, figure(32, 32, 11, 14), "breathe", "a dragon", await tk(), testIo, "spits acid");
  expect(body(c2[0]).description).toBe("spits acid");
});

test("redo_replaces_an_approved_animation_only_when_asked", async () => {
  const p = await withRef();
  p.files.set("old_0.png", new Blob([]));
  p.kit.chars.hero.anims.walk = { approved: true, source: "pixellab", frames: ["old_0.png"] };
  serve("job-accepted", "job-anim-completed");
  await expect(genAnimInto(p, KEY, "hero", "walk", "a knight", await tk(), testIo)).rejects.toThrow(/already approved/);
  serve("job-accepted", "job-anim-completed");
  await genAnimInto(p, KEY, "hero", "walk", "a knight", await tk(), testIo, undefined, { replace: true });
  expect(p.kit.chars.hero.anims.walk.approved).toBe(false);
  expect(p.files.has("old_0.png")).toBe(false);
});

test("a_once_move_keeps_the_reference_as_its_first_frame", async () => {
  serve("job-accepted", "job-anim-completed");
  expect(await genAnim(KEY, figure(32, 32, 11, 14), "attack", "a knight", await tk(), testIo)).toHaveLength(5); // starts from the stand
});

test("a_background_is_made_at_canvas_size_when_it_fits", async () => {
  const p = newProject("t"); // 480x270: under the 512x512 area limit
  let calls = serve("create-image-pixen");
  await genBackgroundInto(p, KEY, "cave", "a cave", await tk(), testIo);
  expect(body(calls[0]).image_size).toEqual({ width: 480, height: 272 });
  p.canvas = { W: 960, H: 540, exportScale: 2 };
  calls = serve("create-image-pixen");
  await genBackgroundInto(p, KEY, "cave2", "a cave", await tk(), testIo);
  expect(body(calls[0]).image_size).toEqual({ width: 480, height: 272 }); // too big: half size, shown at 2x
});
