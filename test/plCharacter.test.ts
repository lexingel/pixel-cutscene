import { afterEach, expect, test, vi } from "vitest";
import { confirmPaid, type PaidTicket } from "../src/ai/confirm";
import { newProject } from "../src/core/project";
import { approveRef, genAnimInto, genCharacterV3 } from "../src/gen/pixellab";
import { figure, pngBytes, testIo } from "./png";

// A PixelLab character (create-character-v3) is one body on PixelLab's side; every move is posed from it
// (animate-character, skeleton-v3), so walk, attack and hurt keep the same clothes and colours.
const KEY = "k";
const PNG = () => new Response(pngBytes(figure(32, 32, 11, 14)) as BodyInit, { status: 200, headers: { "content-type": "image/png" } });
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
const FILE = "https://supabase.pixellab.ai/storage/v1/object/public/pixellab-characters/u/c1/";
type Call = { url: string; method: string; body?: any };

function server(opts: { evilFrame?: boolean } = {}) {
  const calls: Call[] = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : undefined });
    if (url.endsWith("/create-character-v3")) return json({ background_job_id: `cj${++n}`, character_id: `c${n}`, status: "processing" });
    if (url.endsWith("/animate-character")) return json({ background_job_ids: ["aj1"], directions: ["east"], animation_group_id: "g2" });
    if (url.includes("/background-jobs/")) return json({ status: "completed", last_response: {} });
    if (/\/characters\/c\d+$/.test(url))
      return json({
        id: "c1", status: "completed", rotation_urls: { east: FILE + "rotations/east.png", south: FILE + "rotations/south.png" },
        animations: [
          { animation_type: "old", animation_group_id: "g1", directions: [{ direction: "east", frame_count: 1, frames: [FILE + "old.png"] }] },
          { animation_type: "walk", animation_group_id: "g2", directions: [
            { direction: "south", frame_count: 1, frames: [FILE + "s.png"] },
            { direction: "east", frame_count: 3, frames: opts.evilFrame ? ["https://evil.example/x.png"] : [FILE + "e0.png", FILE + "e1.png", FILE + "e2.png"] },
          ] },
        ],
      });
    if (url.startsWith("https://supabase.pixellab.ai/")) return PNG();
    return new Response("{}", { status: 404 });
  }));
  return calls;
}
const tk = async (calls: number) => (await confirmPaid("pixellab", "test", "free", calls, async () => true)) as PaidTicket;
afterEach(() => vi.unstubAllGlobals());

test("v3_candidates_are_pixellab_characters_facing_east", async () => {
  const calls = server();
  const cands = await genCharacterV3(KEY, "a knight", 64, await tk(4), testIo);
  expect(cands.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4"]);
  const posts = calls.filter((c) => c.method === "POST");
  expect(posts).toHaveLength(4);
  expect(posts[0].body).toMatchObject({ description: "a knight", image_size: { width: 64, height: 64 }, view: "side", template_id: "mannequin", no_background: true });
  // the east rotation is what the scene shows, read from PixelLab's public file store without the key
  const file = calls.find((c) => c.url.endsWith("rotations/east.png"));
  expect(file).toBeTruthy();
  expect(cands[0].img.w).toBeGreaterThan(0);
});

test("moves_of_a_v3_character_are_posed_from_it", async () => {
  const calls = server();
  const p = newProject("t");
  await approveRef(p, "hero", figure(32, 32, 11, 14), testIo, { pl: "c1" });
  expect(p.kit.chars.hero.pl).toBe("c1");
  await genAnimInto(p, KEY, "hero", "walk", "", await tk(1), testIo);
  const post = calls.find((c) => c.url.endsWith("/animate-character"))!;
  expect(post.body).toMatchObject({ character_id: "c1", mode: "skeleton-v3", directions: ["east"], animation_name: "walk" });
  expect(post.body.action_description).toMatch(/walk/);
  expect(calls.some((c) => c.url.endsWith("/animate-pixminimax"))).toBe(false);
  // the new group's east frames, not the old animation's nor the south ones
  expect(calls.filter((c) => /\/(e\d|s|old)\.png$/.test(c.url)).map((c) => c.url.split("/").pop())).toEqual(["e0.png", "e1.png", "e2.png"]);
  expect(p.kit.chars.hero.anims.walk.frames).toHaveLength(3);
});

test("frame_urls_off_pixellab_storage_are_refused", async () => {
  server({ evilFrame: true });
  const p = newProject("t");
  await approveRef(p, "hero", figure(32, 32, 11, 14), testIo, { pl: "c1" });
  await expect(genAnimInto(p, KEY, "hero", "walk", "", await tk(1), testIo)).rejects.toThrow(/supabase\.pixellab\.ai/);
  expect(p.kit.chars.hero.anims.walk).toBeUndefined();
});
