import { readyChars, type Kit } from "../core/kit";
import type { Timeline } from "../core/types";

// A trimmed rift scene: 3 shots, 2 actors. Must itself pass validateTimeline (tested).
export const EXAMPLE: Timeline = {
  name: "rift",
  duration: 12,
  closeup_scale: 6,
  shots: [
    { id: "s1_arrive", type: "wide", start: 0, end: 5, bg: "rift_bg", bg_scale: 2, fade_in: 1.5, camera: [{ t: 0, x: 0, y: -28 }, { t: 5, x: 120, y: -28 }] },
    { id: "s2_mage", type: "closeup", start: 5, end: 7, face: "mage", expr: "neutral", bg: "mage_realm" },
    { id: "s3_rumble", type: "wide", start: 7, end: 12, bg: "rift_bg", bg_scale: 2, fade_out: 1.5, camera: [{ t: 7, x: 120, y: -28 }] },
  ],
  actors: [
    { id: "ranger", char: "legend_ranger", x: 230, y: 505, flip: false, actions: [{ id: "ranger_look", t: 1, do: "look_around", dur: 3.6 }, { id: "ranger_startle", t: 8, do: "startle", dur: 0.9 }] },
    { id: "mage", char: "legend_mage", x: 420, y: 505, appear: 0.5, actions: [{ id: "mage_walk", t: 2, do: "walk", to: [480, 505], dur: 2 }, { id: "mage_startle", t: 8.1, do: "startle", dur: 0.9 }] },
  ],
  fx: [{ id: "portal", t: 9, fx: "portal_drowned", x: 1090, y: 505 }],
  audio: [
    { id: "music", t: 0, clip: "music_dread", kind: "music", vol_db: -8 },
    { id: "vo_mage", t: 5.3, clip: "vo_rift_mage", kind: "voice", line: "There is no bottom to it..." },
  ],
};

// The reply shape the model is asked for: the timeline plus the characters it needs.
export const EXAMPLE_REPLY = {
  timeline: EXAMPLE,
  cast: [
    { id: "legend_ranger", look: "A lean ranger in a green hooded cloak with a longbow on her back.", anims: [] },
    { id: "legend_mage", look: "An old mage in deep blue robes with a white beard and a glowing staff.", anims: ["walk"] },
  ],
};

const list = (xs: string[]) => (xs.length ? xs.join(", ") : "(none)");

export function buildScenePrompt(kit: Kit, canvas: { W: number; H: number }, description: string, current: Timeline | null) {
  const ids = (k: string) => Object.entries(kit.assets).filter(([, a]) => a.kind === k).map(([id]) => id);
  const ready = readyChars(kit);
  const unready = Object.keys(kit.chars).filter((c) => !ready.includes(c));
  const chars = ready.map((c) => {
    const v = kit.chars[c];
    const faces = Object.entries(kit.faces[c] ?? {}).filter(([, f]) => f.approved).map(([e]) => e);
    return `- ${c}: animations ${list(Object.keys(v.anims))}; ${faces.length ? `faces (use as a close-up "face" with "expr"): ${faces.join(", ")}` : "no close-ups"}`;
  });
  const system = `You write timelines for a pixel-art cutscene video. Reply with one JSON object: {"timeline": ..., "cast": [...]}.

Format (complete example):
${JSON.stringify(EXAMPLE_REPLY, null, 1)}

Rules:
- "shots" are back to back: the first starts at 0, each starts where the previous ends, the last ends at "duration". Shot types: "wide" (needs "camera" keys {t,x,y} and a whole-number "bg_scale"; optional "bg", "fade_in", "fade_out") and "closeup" (needs "face" and "expr"; optional "bg").
- Actors have "char", "x", "y", optional "flip" and "appear" (seconds), and "actions". Every id in the file is unique; every "t" is between 0 and duration.
- Actions ("do"): idle; walk (needs "to": [x, y] and "dur"); move (needs "to" and "dur"); look_around (needs "dur"); startle (needs "dur"); anim:<name> for any animation the character has.
- "fx" entries: {id, t, fx, x, y}. "audio" entries: {id, t, clip, kind: music|sfx|voice, optional line, vol_db}.
- "name" uses only letters, digits, - and _.
- Canvas is ${canvas.W}x${canvas.H} pixels. bg_scale is a whole number: 2 when the background is drawn at half size and panned across, 1 otherwise. Duration: 10 to 40 seconds.
- You may use pieces the kit does not have yet (a walk, a face, a whole new character); they will be listed as missing. Prefer the kit's own ids where they fit.
- "cast" lists every character the actors use ("char"), once each: "id" uses only lowercase letters, digits and _; "look" is one or two sentences describing how it looks, for a pixel-art sprite generator (side view); "anims" are the animations the timeline needs beyond idle (e.g. walk, or the <name> of anim:<name>).

Kit:
Characters:
${chars.join("\n") || "(none)"}${unready.length ? `\nCharacters not ready yet (no approved idle; you may still use them): ${unready.join(", ")}` : ""}
Backgrounds: ${list(ids("bg"))}
Backdrops: ${list(ids("backdrop"))}
Effects (fx): ${list(ids("fx"))}
Sounds (sfx and voice): ${list([...ids("sfx"), ...ids("voice")])}
Music: ${list(ids("music"))}

Return only JSON.`;
  const user = current
    ? `Scene description:\n${description}\n\nCurrent timeline (entries with "locked": true must stay exactly as they are):\n${JSON.stringify(current)}`
    : `Scene description:\n${description}`;
  return { system, user };
}
