import { readyChars, type Kit } from "../core/kit";
import { FX_LIST } from "../core/fxLibrary";
import type { Timeline } from "../core/types";
import { bgScale } from "../gen/pixellab";

// A trimmed rift scene: 3 shots, 2 actors, using most of the vocabulary. Must itself pass validateTimeline (tested).
export const EXAMPLE: Timeline = {
  name: "rift",
  duration: 12,
  closeup_scale: 6,
  shots: [
    { id: "s1_arrive", type: "wide", start: 0, end: 5, bg: "rift_bg", bg_scale: 2, ground: 505, fade_in: 1.5, camera: [{ t: 0, x: 0, y: -28 }, { t: 5, x: 120, y: -28 }] },
    { id: "s2_mage", type: "closeup", start: 5, end: 7, face: "legend_mage", expr: "neutral", bg: "mage_realm" },
    { id: "s3_rumble", type: "wide", start: 7, end: 12, bg: "rift_bg", bg_scale: 2, ground: 505, shake: 0.6, flash: 0.2, fade_out: 1.5, camera: [{ t: 7, x: 120, y: -28 }], zoom: { from: 1, to: 2, x: 0, y: 0, actor: "ranger" } },
  ],
  actors: [
    { id: "ranger", char: "legend_ranger", x: 230, y: 505, flip: false, actions: [
      { id: "ranger_look", t: 1, do: "look_around", dur: 1.8 },
      { id: "ranger_say", t: 3, do: "say", text: "Do you hear that?", dur: 2 },
      { id: "ranger_shoot", t: 9.4, do: "anim:attack" },
    ] },
    { id: "mage", char: "legend_mage", x: 420, y: 505, appear: 0.5, actions: [
      { id: "mage_walk", t: 2, do: "walk", to: [480, 505], dur: 2 },
      { id: "mage_startle", t: 8.1, do: "startle", dur: 0.9 },
      { id: "mage_hurt", t: 10, do: "hurt" },
    ] },
  ],
  fx: [{ id: "portal", t: 9, fx: "arcane/portal", x: 1090, y: 505 }, { id: "arrow_hit", t: 9.9, fx: "impacts/hit-spark", x: 600, y: 480, flip: true }],
  audio: [
    { id: "music", t: 0, clip: "music_dread", kind: "music", vol_db: -8 },
    { id: "vo_mage", t: 5.3, clip: "vo_rift_mage", kind: "voice", line: "There is no bottom to it...", speaker: "legend_mage", bubble: "box" },
  ],
};

// The reply shape the model is asked for: the timeline plus the characters it needs.
export const EXAMPLE_REPLY = {
  timeline: EXAMPLE,
  cast: [
    { id: "legend_ranger", look: "A lean ranger in a green hooded cloak with a longbow on her back.", anims: ["attack"] },
    { id: "legend_mage", look: "An old mage in deep blue robes with a white beard and a glowing staff.", anims: ["walk"] },
  ],
};

const list = (xs: string[]) => (xs.length ? xs.join(", ") : "(none)");

// effects that read on their own in a scene ("moves" carry their own stock fighter, "ui" is game HUD)
export const library = () => {
  const by = new Map<string, string[]>();
  for (const f of FX_LIST) if (f.category !== "moves" && f.category !== "ui") by.set(f.category, [...(by.get(f.category) ?? []), f.id.split("/")[1]]);
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([c, names]) => `${c}: ${names.sort().join(" ")}`).join("\n");
};

/** What the model should know about scale: each ready character's idle frame size, and where feet stand. */
export type SceneScale = { sizes?: Record<string, { w: number; h: number }>; feetY?: number };

export function buildScenePrompt(kit: Kit, canvas: { W: number; H: number }, description: string, current: Timeline | null, scale: SceneScale = {}) {
  const ids = (k: string) => Object.entries(kit.assets).filter(([, a]) => a.kind === k).map(([id]) => id);
  const ready = readyChars(kit);
  const unready = Object.keys(kit.chars).filter((c) => !ready.includes(c));
  const chars = ready.map((c) => {
    const v = kit.chars[c];
    const faces = Object.entries(kit.faces[c] ?? {}).filter(([, f]) => f.approved).map(([e]) => e);
    const sz = scale.sizes?.[c], k = v.scale ?? 1;
    const big = sz ? `, ${sz.h * k} px tall and ${sz.w * k} px wide on screen` : "";
    return `- ${c}${big}: animations ${list(Object.keys(v.anims))}; ${faces.length ? `faces (use as a close-up "face" with "expr"): ${faces.join(", ")}` : "no close-ups"}`;
  });
  const system = `You write timelines for a pixel-art cutscene video. Reply with one JSON object: {"timeline": ..., "cast": [...]}.

Format (complete example):
${JSON.stringify(EXAMPLE_REPLY, null, 1)}
(The example is for a 960x540 canvas; use the numbers for this canvas below.)

Rules:
- "shots" are back to back: the first starts at 0, each starts where the previous ends, the last ends at "duration". Shot types: "wide" (needs "camera" keys {t,x,y} and a whole-number "bg_scale"; optional "bg", "fade_in", "fade_out", "ground") and "closeup" (needs "face" and "expr"; optional "bg"). "face" is the character id.
- Any shot may add "flash" (seconds of white flash at its start: a hit, a spell, lightning) and, on wide shots, "shake" (seconds of camera shake: a roar, an explosion, a heavy landing).
- A wide shot can zoom: "zoom": {"from": 1, "to": 2, "x": 0, "y": 0, "actor": "<actor id>"} eases from one zoom to the other across the shot and follows that actor (without "actor" it centres on x, y in frame pixels). Use it for a dramatic push-in; keep from and to whole numbers.
- "ground" on a wide shot is the y where feet stand on its background; put every actor's "y" (and walk targets) on it.
- Actors have "char", "x", "y" (x, y = where the feet are, in scene pixels), optional "flip" (true = faces left), "appear" (seconds) and "layer" ("back" for something huge behind everyone, like a dragon), and "actions". Root "shadows": true puts a ground shadow under every actor (good on open ground). Every id in the file is unique; every "t" is between 0 and duration.
- Actions ("do"): idle; walk (needs "to": [x, y] and "dur"); move (glide, needs "to" and "dur"); look_around (needs "dur"); startle (needs "dur"); hurt (a red flash and a shake, no "dur"); dust (needs "dur": the character crumbles and is gone); say (needs "text", the words in a speech bubble; optional "dur" and "style": "bubble" over the head or "box" along the bottom); anim:<name> plays one of the character's animations once, e.g. "anim:attack" (a weapon strike) or "anim:breathe" (a creature breathing fire), then they stand again.
- Make it move: something should happen every few seconds (a walk, a say, an attack, an effect, a shake). Give characters a line or two of "say" where it fits the story. A hit is an attack, then an effect where it lands, then "hurt" on the target.
- "fx" entries: {id, t, fx, x, y}, optional "flip" (true = faces left), "angle" (whole degrees to aim it, e.g. 20 = down toward a target) and "reach" (1 to 4: how far a breath or beam goes, 1 = as drawn). "fx" is a library effect "<category>/<name>" from the list below, or one of the kit's effects. x, y is where it starts (a breath: the mouth; an explosion: its centre on the ground).
- "audio" entries: {id, t, clip, kind: music|sfx|voice, optional line, vol_db}. A sound effect may add "dur" (0.5 to 30 seconds: how long it is made, e.g. 0.5 for a click, 4 for a roar); its "line" describes the sound. A voice line may add "speaker" (the character id who says it) and "bubble": "bubble" (over their head, the default), "box" (a dialogue box) or "none".
- "name" uses only letters, digits, - and _.
- Canvas is ${canvas.W}x${canvas.H} pixels. bg_scale is a whole number: ${bgScale(canvas)} for a background made for this canvas (that is what gets generated). Duration: 10 to 40 seconds.${scale.feetY !== undefined ? `\n- Feet stand at about y ${scale.feetY} on a background made for this canvas; use that as "ground" unless a background says otherwise.` : ""}
- You may use pieces the kit does not have yet (a walk, a face, a whole new character); they will be listed as missing. Prefer the kit's own ids where they fit.
- "cast" lists every character the actors use ("char"), once each: "id" uses only lowercase letters, digits and _; "look" is one or two sentences describing how it looks, for a pixel-art sprite generator (side view); "anims" are the animations the timeline needs beyond idle (e.g. walk, or the <name> of anim:<name>).

Library effects (use as "<category>/<name>"):
${library()}

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
