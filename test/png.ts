// Node-only PNG codec for tests: 8-bit RGBA, no interlace, filter 0 (what our fixtures use).
// @ts-ignore node types are not part of the browser build
import { crc32, deflateSync, inflateSync } from "node:zlib";
import type { Img } from "../src/core/kit";

const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((o, p) => (out.set(p, o), o + p.length), 0);
  return out;
};
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
};
const chunk = (type: string, data: Uint8Array) => {
  const td = cat([new TextEncoder().encode(type), data]);
  return cat([u32(data.length), td, u32(crc32(td))]);
};

export function pngBytes(img: Img): Uint8Array {
  const ihdr = cat([u32(img.w), u32(img.h), new Uint8Array([8, 6, 0, 0, 0])]);
  const raw = new Uint8Array((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) raw.set(img.px.subarray(y * img.w * 4, (y + 1) * img.w * 4), y * (img.w * 4 + 1) + 1);
  return cat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))]);
}

export const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (c) => String.fromCharCode(c)).join(""));

export function decodePng(b64: string): Img {
  const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dv = new DataView(b.buffer);
  if (dv.getUint32(0) !== 0x89504e47) throw new Error("not a PNG");
  let w = 0, h = 0;
  const idat: Uint8Array[] = [];
  for (let o = 8; o < b.length; ) {
    const len = dv.getUint32(o), type = String.fromCharCode(...b.subarray(o + 4, o + 8)), data = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") (w = dv.getUint32(o + 8)), (h = dv.getUint32(o + 12));
    if (type === "IDAT") idat.push(data);
    o += 12 + len;
  }
  const raw: Uint8Array = inflateSync(cat(idat));
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    if (raw[y * (w * 4 + 1)] !== 0) throw new Error("test codec: filter 0 only");
    px.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  }
  return { w, h, px };
}

// A small pixel-art figure (few colours, no 2x2 uniform blocks) at (ox, oy) on a transparent w*h canvas.
export function figure(w: number, h: number, ox: number, oy: number, fw = 10, fh = 16, tint = 0): Img {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      if ((x + y) % 5 === 0) continue;
      px.set([(x * 37 + tint) % 256, (y * 53) % 256, (x * y) % 256, 255], ((oy + y) * w + ox + x) * 4);
    }
  return { w, h, px };
}

export const testIo = {
  decode: async (b64: string) => decodePng(b64),
  encode: async (img: Img) => new Blob([pngBytes(img)], { type: "image/png" }),
  wait: async () => {},
};
