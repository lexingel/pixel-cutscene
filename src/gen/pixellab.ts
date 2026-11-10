/* PixelLab REST v2 (https://api.pixellab.ai/v2, docs /v2/docs + /v2/openapi.json, read 2026-11-10).
 * One endpoint per function. Costs are as the docs state them, per call, on a subscription:
 * - genCharacter: POST /create-image-pixen (sync, view "side", transparent). 4 calls, one per candidate.
 *     Cost: not stated on this endpoint; /create-character-v3 prices its pixen step at "1 (pixen)", so 1 generation each.
 *     Chosen over /generate-image-v2 (Pro, cost not stated, 4-64 images by size) and pixflux (cost not stated).
 * - genAnim: POST /animate-pixminimax (async job). first_frame = the approved reference; the job returns
 *     frame_count + 1 frames, index 0 being the input unchanged, so the reference is frame 0.
 *     Cost: "64x64 at 4 / 8 / 16 / 40 frames = 1 / 1 / 2 / 6 generations"; "32x32 at 4 frames = 1".
 *     Chosen over /animate-with-text-v3 and -v2 (cost not stated).
 * - genFace: POST /edit-image-pixen (async job). Edits the base face when there is one, else the body sprite
 *     into a portrait. Sides must be multiples of 4 (we pad, never rescale). Cost: "1 generation".
 * - genBackground: POST /create-image-pixen (sync, opaque). Sides multiples of 4, area at most 512x512.
 *     Cost: as genCharacter, 1 generation.
 * - balance: GET /balance (free). Job polling: GET /background-jobs/{id} (free); both go through callFree.
 * Paid calls go only through callApi with the caller's ticket; a failed job is not charged ("Charged at completion").
 */
import { callApi, callFree } from "../ai/http";
import type { PaidTicket } from "../ai/confirm";
import { freePath } from "../core/cast";
import type { Img, Kit, SizeName } from "../core/kit";
import type { Project } from "../core/project";
import { crop } from "../core/raster";
import { checkSprite, downscale } from "../core/spriteImport";
import { decode, encode } from "../ui/cast";

const API = "https://api.pixellab.ai/v2";
export const SIZES = [32, 48, 64, 96, 128, 192, 256] as const;
// Short notes for the confirm dialog, from the costs above.
export const COST = {
  character: "4 images, about 1 generation each (4 in all).",
  anim: "One animation, 1 generation.",
  face: "One image edit, 1 generation.",
  background: "One image, about 1 generation.",
};

export type Io = { decode(b64: string): Promise<Img>; encode(img: Img): Promise<Blob>; wait(ms: number): Promise<void> };
export const browserIo: Io = {
  decode: (b64) => decode(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" })),
  encode,
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
};

type B64 = { type: "base64"; base64: string; format: "png" };
const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
const seed = () => Math.floor(Math.random() * 1e9);

async function blobB64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const toB64 = async (img: Img, io: Io): Promise<B64> => ({ type: "base64", base64: await blobB64(await io.encode(img)), format: "png" });

const post = async (key: string, path: string, body: object, ticket: PaidTicket) =>
  (await callApi("pixellab", API + path, { method: "POST", headers: { "content-type": "application/json", ...auth(key) }, body: JSON.stringify(body) }, ticket)).json();

// Async endpoints: one paid POST, then free status reads until the job ends.
async function job(key: string, path: string, body: object, ticket: PaidTicket, io: Io): Promise<Record<string, unknown>> {
  const { background_job_id: id } = await post(key, path, body, ticket);
  let misses = 0; // the job is already paid for: a few failed status reads in a row are waited out
  for (let i = 0; i < 150; i++) {
    let j: Record<string, any>;
    try {
      j = await (await callFree("pixellab", `${API}/background-jobs/${encodeURIComponent(id)}`, { headers: auth(key) })).json();
      misses = 0;
    } catch (e) {
      if (++misses > 3) throw e;
      await io.wait(4000);
      continue;
    }
    if (j.status === "completed") return j.last_response ?? {};
    if (j.status === "failed") throw new Error(String(j.last_response?.detail ?? "PixelLab could not make this"));
    await io.wait(4000);
  }
  throw new Error("PixelLab is taking too long. Try again later.");
}

// Result images as base64 strings, whichever shape the response uses.
const images = (r: Record<string, unknown>): string[] =>
  ((r.images as unknown[]) ?? (r.image ? [r.image] : [])).map((x) => (typeof x === "string" ? x : (x as B64).base64));

// Decode every image and check them as one sprite; nothing is returned unless all pass.
async function sprite(b64s: string[], io: Io): Promise<Img[]> {
  if (!b64s.length) throw new Error("PixelLab returned no images");
  const imgs = await Promise.all(b64s.map(io.decode));
  const c = checkSprite(imgs);
  if (!c.ok) throw new Error(`PixelLab's result was not usable: ${c.reason}`);
  return c.scale > 1 ? imgs.map((i) => downscale(i, c.scale)) : imgs;
}

// One crop for all frames: tight to the opaque pixels, symmetric about the centre column, so the
// bottom-centre (the feet) stays the anchor across frames.
// Frames of differing size are first set on one canvas, each by its own bottom-centre.
export function trimShared(frames: Img[]): Img[] {
  const w = Math.max(...frames.map((i) => i.w)), h = Math.max(...frames.map((i) => i.h));
  const imgs = frames.map((i) => (i.w === w && i.h === h ? i : crop(i, -Math.floor((w - i.w) / 2), i.h - h, w, h)));
  let top = h, bottom = -1, half = 0;
  for (const img of imgs)
    for (let y = 0; y < img.h; y++)
      for (let x = 0; x < img.w; x++)
        if (img.px[(y * img.w + x) * 4 + 3]) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          half = Math.max(half, Math.abs(x + 0.5 - w / 2));
        }
  if (bottom < 0) return imgs;
  const cw = Math.min(w, 2 * Math.ceil(half) + (w % 2));
  return imgs.map((i) => crop(i, (w - cw) / 2, top, cw, bottom + 1 - top));
}

// Pads (bottom-centred, transparent) to sides that are multiples of 4 and at least `min`.
export function pad4(img: Img, min = 32): Img {
  const up = (n: number) => Math.max(min, Math.ceil(n / 4) * 4);
  const w = up(img.w), h = up(img.h);
  return crop(img, -Math.floor((w - img.w) / 2), img.h - h, w, h);
}

export async function genCharacter(key: string, description: string, px: number, ticket: PaidTicket, io: Io = browserIo): Promise<Img[]> {
  const s0 = seed();
  const out: Img[] = [];
  // one after another: a ticket for fewer than 4 calls stops at the first call it cannot pay for
  for (let i = 0; i < 4; i++) {
    const r = await post(key, "/create-image-pixen", {
      description, image_size: { width: px, height: px }, view: "side", direction: "east", no_background: true, seed: s0 + i,
    }, ticket);
    out.push(...(await sprite(images(r), io)));
  }
  return out;
}

export const MOTION: Record<string, string> = {
  idle: "idle breathing loop, standing in place",
  walk: "walking in place, a full walk cycle",
  run: "running in place, a full run cycle",
  hurt: "flinches back from a hit, then recovers",
  attack: "a weapon attack: wind-up, strike, recover",
  breathe: "rears its head back, opens its jaws wide and breathes a long stream of fire forward",
  death: "falls to the ground and lies still",
};

export async function genAnim(key: string, ref: Img, anim: string, description: string, ticket: PaidTicket, io: Io = browserIo, motion?: string): Promise<Img[]> {
  const r = await job(key, "/animate-pixminimax", {
    first_frame: await toB64(pad4(ref), io),
    description: motion ?? MOTION[anim] ?? anim.replace(/_/g, " "),
    frame_count: anim === "idle" ? 4 : 8,
    view: "side",
    direction: "east",
    subject_description: description.trim() || "the character in the image",
    initial_pose: "standing",
    no_background: true,
  }, ticket, io);
  return trimShared(await sprite(images(r), io));
}

export async function genFace(key: string, ref: Img, expr: string, baseFace: Img | undefined, ticket: PaidTicket, io: Io = browserIo): Promise<Img> {
  const src = pad4(baseFace ?? ref, 16);
  const description = baseFace
    ? `the same face with a ${expr} expression; keep everything else`
    : `close-up portrait of this character's face, head and shoulders, ${expr} expression`;
  const size = baseFace ? { width: src.w, height: src.h } : { width: 64, height: 64 };
  const r = await job(key, "/edit-image-pixen", { image: await toB64(src, io), description, ...size, no_background: false }, ticket, io);
  return (await sprite(images(r).slice(0, 1), io))[0];
}

// Rounds up to multiples of 4 and scales down to the 512x512 area limit.
export function bgSize(w: number, h: number): { width: number; height: number } {
  const k = Math.min(1, Math.sqrt((512 * 512) / (w * h)));
  const f = (n: number) => Math.max(16, (k < 1 ? Math.floor : Math.ceil)((n * k) / 4) * 4);
  return { width: f(w), height: f(h) };
}

// a backdrop is a stage: characters are added by the scene
const EMPTY = ", empty scene, no characters or creatures";

export async function genBackground(key: string, description: string, w: number, h: number, ticket: PaidTicket, io: Io = browserIo): Promise<Img> {
  const r = await post(key, "/create-image-pixen", { description: description + EMPTY, image_size: bgSize(w, h), view: "side", no_background: false, seed: seed() }, ticket);
  return (await sprite(images(r).slice(0, 1), io))[0];
}

export async function balance(key: string): Promise<{ text: string }> {
  const b = await (await callFree("pixellab", `${API}/balance`, { headers: auth(key) })).json();
  return { text: `$${Number(b.credits?.usd ?? 0).toFixed(2)} credits, ${b.subscription?.generations ?? 0} of ${b.subscription?.total ?? 0} generations left` };
}

/* ---- Into the kit: results land only after every image decoded and passed checkSprite. ---- */

export const refPath = (name: string) => `refs/${name}.png`;
export type At = { kind: "anim"; char: string; anim: string } | { kind: "face"; face: string; expr: string } | { kind: "asset"; id: string };

export function approvePiece(kit: Kit, t: At): void {
  const piece = t.kind === "anim" ? kit.chars[t.char]?.anims[t.anim] : t.kind === "face" ? kit.faces[t.face]?.[t.expr] : kit.assets[t.id];
  if (piece) piece.approved = true;
}

// The picked candidate becomes the character's reference; the character has no animations until idle is made.
export async function approveRef(p: Project, name: string, img: Img, io: Io = browserIo, opts: { size?: SizeName; scale?: 2 } = {}): Promise<void> {
  if (p.kit.chars[name] || p.files.has(refPath(name))) throw new Error(`${name} is already in the cast. Pick another name.`);
  const blob = await io.encode(img);
  p.files.set(refPath(name), blob);
  p.kit.chars[name] ??= { view: "side", anims: {}, ...(opts.size && { size: opts.size }), ...(opts.scale && { scale: opts.scale }) };
}

// The reference for a character's new animations and faces: its generated reference, else its idle frame 0.
async function refOf(p: Project, char: string, io: Io): Promise<{ path: string; img: Img } | null> {
  const path = p.files.has(refPath(char)) ? refPath(char) : p.kit.chars[char]?.anims.idle?.frames[0];
  const blob = path ? p.files.get(path) : undefined;
  if (!path || !blob) return null;
  return { path, img: await io.decode(await blobB64(blob)) };
}

const dropFiles = (p: Project, paths: string[]) => paths.forEach((f) => p.files.delete(f));

// Generated work never lands over a piece the user approved, even one approved while the job ran.
const guard = (piece: { approved: boolean } | undefined, what: string) => {
  if (piece?.approved) throw new Error(`${what} is already approved. Nothing was replaced.`);
};

export async function genAnimInto(p: Project, key: string, char: string, anim: string, description: string, ticket: PaidTicket, io: Io = browserIo, motion?: string): Promise<void> {
  const at = () => p.kit.chars[char]?.anims[anim];
  guard(at(), `${char} ${anim}`);
  const ref = await refOf(p, char, io);
  if (!ref) throw new Error(`${char} has no reference image yet`);
  const frames = await genAnim(key, ref.img, anim, description, ticket, io, motion);
  const blobs = await Promise.all(frames.map(io.encode));
  guard(at(), `${char} ${anim}`);
  const c = (p.kit.chars[char] ??= { view: "side", anims: {} });
  dropFiles(p, c.anims[anim]?.frames ?? []);
  const paths = blobs.map((b, i) => {
    const path = freePath(p, `chars/${char}/${anim}/`, `${anim}_${i}.png`);
    p.files.set(path, b);
    return path;
  });
  c.anims[anim] = { approved: false, source: "pixellab", ref: ref.path, frames: paths };
}

export async function genFaceInto(p: Project, key: string, face: string, expr: string, ticket: PaidTicket, io: Io = browserIo): Promise<void> {
  const at = () => p.kit.faces[face]?.[expr];
  guard(at(), `${face}'s ${expr} face`);
  const ref = await refOf(p, face, io);
  if (!ref) throw new Error(`${face} needs an approved idle before it can get a face`);
  const faces = p.kit.faces[face] ?? {};
  const baseEntry = faces.neutral?.approved ? faces.neutral : Object.values(faces).find((f) => f.approved);
  const baseBlob = baseEntry && p.files.get(baseEntry.path);
  const base = baseBlob ? await io.decode(await blobB64(baseBlob)) : undefined;
  const img = await genFace(key, ref.img, expr, base, ticket, io);
  const blob = await io.encode(img);
  guard(at(), `${face}'s ${expr} face`);
  const old = p.kit.faces[face]?.[expr];
  if (old) p.files.delete(old.path);
  const path = freePath(p, `faces/${face}/`, `${expr}.png`);
  p.files.set(path, blob);
  (p.kit.faces[face] ??= {})[expr] = { approved: false, source: "pixellab", ref: baseEntry?.path ?? ref.path, path };
}

export async function genBackgroundInto(p: Project, key: string, id: string, description: string, ticket: PaidTicket, io: Io = browserIo): Promise<void> {
  guard(p.kit.assets[id], id);
  const img = await genBackground(key, description, p.canvas.W / 2, p.canvas.H / 2, ticket, io);
  const blob = await io.encode(img);
  guard(p.kit.assets[id], id);
  const old = p.kit.assets[id];
  if (old) p.files.delete(old.path);
  const path = freePath(p, "bg/", `${id}.png`);
  p.files.set(path, blob);
  p.kit.assets[id] = { approved: false, source: "pixellab", kind: "bg", path };
}
