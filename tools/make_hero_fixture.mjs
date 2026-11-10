// Writes test/fixtures/sprites/hero/idle_0..3.png: a 16x24 side-view figure that bobs 1px (breathing idle).
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

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
  for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};

// Facing right. Rows top to bottom; '.' transparent.
const art = [
  "................",
  "......HHHH......",
  ".....HHHHHH.....",
  ".....HSSSSE.....",
  ".....HSSSSS.....",
  "......SSSS......",
  "......TTTT......",
  ".....TTTTTT.....",
  "....TTTTTTTA....",
  "....TTTTTTTA....",
  "....STTTTTTS....",
  ".....BBBBBB.....",
  ".....TTTTTT.....",
  ".....PPPPPP.....",
  ".....PP..PP.....",
  ".....PP..PP.....",
  ".....PP..PP.....",
  ".....PP..PP.....",
  ".....KK..KKK....",
  ".....KKK.KKK....",
];
const pal = { H: [74, 46, 28], S: [232, 182, 140], E: [30, 24, 40], T: [52, 101, 164], A: [190, 196, 210], B: [120, 84, 40], P: [70, 60, 72], K: [40, 30, 30] };
const W = 16, H = 24, dir = new URL("../test/fixtures/sprites/hero/", import.meta.url);
mkdirSync(dir, { recursive: true });
[0, 0, 1, 1].forEach((bob, f) => {
  const px = Buffer.alloc(W * H * 4);
  art.forEach((row, ry) => {
    // the upper body (rows 0-12) sinks 1px on breath frames; legs stay planted
    const y = ry + 3 + (ry <= 12 ? bob : 0);
    [...row].forEach((ch, x) => {
      const c = pal[ch];
      if (!c) return;
      px.set([...c, 255], (y * W + x) * 4);
    });
  });
  writeFileSync(new URL(`idle_${f}.png`, dir), png(W, H, px));
});

// test/fixtures/bg/field.png: a 320x180 green field with a sand strip, the background a stranger uploads.
{
  const BW = 320, BH = 180, px = Buffer.alloc(BW * BH * 4);
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) px.set(y < BH - 20 ? [58, 94, 64, 255] : [200, 170, 90, 255], (y * BW + x) * 4);
  const bgDir = new URL("../test/fixtures/bg/", import.meta.url);
  mkdirSync(bgDir, { recursive: true });
  writeFileSync(new URL("field.png", bgDir), png(BW, BH, px));
}
