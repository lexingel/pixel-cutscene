// Builds public/sample/sample.zip, the project behind "Open the sample": two pixelfx rig characters (idle + walk)
// at a pixelfx campfire, a dusk background drawn here, and one CC0 library track. No outside art.
// Run: node tools/make-sample.mjs   (Node 23.6+: it imports src/core/fxBake.ts directly)
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { zipSync } from "fflate";
import { posed, STAND } from "../vendor/pixelfx/src/core/rig.js";
import { DUMMY_PAL } from "../vendor/pixelfx/src/core/actor.js";
import { hex } from "../vendor/pixelfx/src/core/color.js";
import * as campfire from "../vendor/pixelfx/src/fx/fire/campfire.js";
import { bakeFx } from "../src/core/fxBake.ts";

const crcT = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4);
  len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
};
const png = (w, h, px) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, px.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
};
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

const W = 320, H = 180, GROUND = 168;

// ---- the background: dusk sky in dithered bands, a moon, two ridges, a meadow
function background() {
  const px = new Uint8Array(W * H * 4);
  const put = (x, y, c) => px.set(c, (y * W + x) * 4);
  const SKY = ["#1b1838", "#2a2150", "#43295e", "#6a3463", "#9a4560", "#c8635a", "#e89a62"].map(rgb);
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const ridge = (x, base, amp, f, s) => base - amp * (0.6 * Math.sin(x * f + s) + 0.3 * Math.sin(x * f * 2.7 + s * 3) + 0.1 * Math.sin(x * f * 7.1));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (y / 120) * (SKY.length - 1), i = Math.min(Math.floor(u), SKY.length - 1);
      let c = SKY[Math.min(i + ((u - i) * 16 > BAYER[y & 3][x & 3] ? 1 : 0), SKY.length - 1)];
      if ((x - 252) ** 2 + (y - 30) ** 2 <= 64) c = rgb((x - 250) ** 2 + (y - 28) ** 2 <= 30 ? "#fff1c8" : "#e8d2a0");
      if (((x * 73856093) ^ (y * 19349663)) % 997 === 0 && y < 60) c = rgb("#e8e4ff");
      if (y > ridge(x, 118, 22, 0.021, 1.3)) c = rgb("#2b2440");
      if (y > ridge(x, 140, 12, 0.034, 4.1)) c = rgb("#1f2a2c");
      if (y >= 150) c = rgb(y >= 158 ? "#2f4a2a" : "#28402a");
      if (y >= 150 && Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 < 0.05) c = rgb("#4a6a3a");
      put(x, y, c);
    }
  }
  return px;
}

// ---- the characters: the pixelfx rig, recoloured from its grey dummy into two outfits
const KEY = Object.fromEntries(Object.entries(DUMMY_PAL).map(([k, v]) => [hex(v) >>> 0, k]));
const OUTFITS = {
  knight: { A: "#d8dee9", B: "#a9b4c6", C: "#7a8599", D: "#555d6e", E: "#6a4a3a", F: "#4e3528", G: "#36241c", J: "#2a2230", k: "#120e16", m: "#d8433a" },
  ranger: { A: "#a8c070", B: "#7a9a4a", C: "#557236", D: "#3a5028", E: "#8a6a44", F: "#6a4e30", G: "#4a3420", J: "#2e2418", k: "#120e10", m: "#e8c060" },
};
const CW = 32, CH = 40; // feet at the bottom centre of every frame
function frame(pose, outfit) {
  const r = posed({ ...STAND, ...pose }), px = new Uint8Array(CW * CH * 4);
  for (let i = 0; i < r.n; i++) {
    const c = r.color[i] >>> 0, k = KEY[c];
    const x = CW / 2 + r.xs[i], y = CH + r.ys[i];
    if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
    px.set(k && outfit[k] ? rgb(outfit[k]) : [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, 255], (y * CW + x) * 4);
  }
  return px;
}
const IDLE = [0, 0, 1, 1].map((d) => ({ crouch: d, fy: STAND.fy + d, by: STAND.by + d }));
const WALK = Array.from({ length: 8 }, (_, i) => {
  const s = Math.sin((i / 8) * 2 * Math.PI), c = Math.cos((i / 8) * 2 * Math.PI);
  return {
    crouch: 1 - Math.abs(c), ffx: STAND.ffx + 6 * s, fbx: STAND.fbx - 6 * s, ffy: STAND.ffy - Math.max(0, c) * 3, fby: STAND.fby - Math.max(0, -c) * 3,
    fx: STAND.fx - 4 * s, bx: STAND.bx + 4 * s,
  };
});

const files = {};
const kit = { chars: {}, faces: {}, assets: {} };
for (const [name, outfit] of Object.entries(OUTFITS)) {
  const anims = {};
  for (const [anim, poses] of [["idle", IDLE], ["walk", WALK]]) {
    const frames = poses.map((q, i) => {
      const path = `chars/${name}/${anim}/${anim}_${i}.png`;
      files[`files/${path}`] = png(CW, CH, frame(q, outfit));
      return path;
    });
    anims[anim] = { approved: true, source: "pixelfx", frames };
  }
  kit.chars[name] = { view: "side", anims };
}
files["files/bg/dusk.png"] = png(W, H, background());
kit.assets.dusk = { approved: true, source: "user", kind: "bg", path: "bg/dusk.png" };

const fire = bakeFx(campfire, {}, 12);
files["files/fx/campfire.png"] = png(fire.sheet.w, fire.sheet.h, fire.sheet.px);
kit.assets.campfire = {
  approved: true, source: "pixelfx", ref: "fire/campfire", kind: "fx", path: "fx/campfire.png",
  fx: { cols: fire.cols, frames: fire.frames, fps: fire.fps, loop: fire.loop, dx: fire.dx, dy: fire.dy },
};

// the shortest calm CC0 track in the library
const tracks = JSON.parse(readFileSync(new URL("../public/music/manifest.json", import.meta.url), "utf8"));
const track = tracks.filter((t) => t.license === "CC0-1.0" && t.mood.includes("calm")).sort((a, b) => a.seconds - b.seconds)[0];
files["files/audio/calm.ogg"] = readFileSync(new URL(`../public/music/${track.file}`, import.meta.url));
kit.assets.calm = { approved: true, source: "library", ref: track.id, kind: "music", path: "audio/calm.ogg" };

const project = {
  id: "sample-campfire",
  name: "Sample: campfire at dusk",
  step: 3,
  description: "A knight waits by a campfire at dusk. A ranger walks in from the right and joins him; the knight looks around.",
  tl: {
    name: "campfire", duration: 8,
    shots: [{ id: "s1", type: "wide", start: 0, end: 8, bg: "dusk", bg_scale: 1, fade_out: 0.8, camera: [{ t: 0, x: 0, y: 0 }] }],
    actors: [
      { id: "knight1", char: "knight", x: 118, y: GROUND, actions: [{ id: "k_idle", t: 0, do: "idle" }, { id: "k_look", t: 4.5, do: "look_around", dur: 1.6 }] },
      { id: "ranger1", char: "ranger", x: 350, y: GROUND, flip: true, actions: [{ id: "r_walk", t: 0.8, do: "walk", to: [208, GROUND], dur: 3.2 }] },
    ],
    fx: [{ id: "fire1", t: 0, fx: "campfire", x: 162, y: GROUND + 2 }],
    audio: [{ id: "music1", t: 0, clip: "calm", kind: "music", vol_db: -4 }],
  },
  kit,
  cast: {},
  canvas: { W, H, exportScale: 4 },
};
files["project.json"] = Buffer.from(JSON.stringify(project, null, 1));

const out = new URL("../public/sample/", import.meta.url);
mkdirSync(out, { recursive: true });
const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Uint8Array(v)])), { level: 9 });
writeFileSync(new URL("sample.zip", out), zipped);
console.log(`sample.zip ${(zipped.length / 1024).toFixed(0)} KB, track ${track.id}`);
