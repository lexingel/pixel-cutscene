import { expect, test } from "vitest";
// @ts-ignore node types are not part of the browser build
import { existsSync, readFileSync } from "node:fs";
import { attribution, creditsText, type Track } from "../src/ui/music";

const tracks: Track[] = JSON.parse(readFileSync("public/music/manifest.json", "utf8"));
const OK = ["CC0-1.0", "CC-BY-4.0", "OGA-BY-3.0"];

test("manifest: licences allowed, sources given, files exist, enough tracks and moods", () => {
  expect(tracks.length).toBeGreaterThanOrEqual(8);
  expect(new Set(tracks.map((t) => t.id)).size).toBe(tracks.length);
  for (const t of tracks) {
    expect(OK, t.id).toContain(t.license);
    expect(t.source_url, t.id).toMatch(/^https:\/\//);
    expect(existsSync(`public/music/${t.file}`), t.file).toBe(true);
    expect(t.seconds).toBeGreaterThan(0);
    expect(t.mood.length).toBeGreaterThan(0);
  }
  const moods = new Set(tracks.flatMap((t) => t.mood));
  for (const m of ["dread", "calm", "battle", "wonder"]) expect(moods.has(m), m).toBe(true);
});

test("credits: only used, non-CC0 library tracks are listed", () => {
  const by: Track = { id: "x", title: "Sunrise", artist: "Ann", license: "CC-BY-4.0", source_url: "https://e.org/x", file: "x.ogg", seconds: 5, mood: ["calm"] };
  const zero = { ...by, id: "z", license: "CC0-1.0" };
  const unused = { ...by, id: "u" };
  const kit: any = { assets: {
    a: { source: "library", ref: "x", kind: "music" }, b: { source: "library", ref: "z", kind: "music" },
    c: { source: "user", ref: "u", kind: "music" },
  } };
  const tl: any = { audio: [{ clip: "a", kind: "music" }, { clip: "b", kind: "music" }, { clip: "c", kind: "music" }] };
  expect(creditsText(tl, kit, [by, zero, unused])).toBe(attribution(by));
  expect(attribution(by)).toBe("Sunrise by Ann, CC-BY-4.0, https://e.org/x");
  expect(creditsText({ ...tl, audio: [] }, kit, [by])).toBe("");
});
