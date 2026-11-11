// AudioEncoder and AudioData are not in TypeScript 5.6's DOM lib; the types come with mp4-muxer and webm-muxer.
/// <reference types="dom-webcodecs" />
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";

export type Container = "mp4" | "webm";

// High profile; level 4.0 covers 1920x1080, level 5.1 anything up to 4K for bigger canvases.
const avc = (w: number, h: number) => (w * h > 1920 * 1088 ? "avc1.640033" : "avc1.640028");
const VP9 = "vp09.00.40.08";
const AAC = { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 192_000 };
const OPUS = { codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 160_000 };
export type Quality = "best" | "share";
// Best is high on purpose: flat pixel art with hard edges comes back without ringing or smear (~37 Mbit/s at 1080p30).
// Share is a quarter of that (~9 Mbit/s): fits Discord, itch and social uploads; flat areas still hold up.
export const bitrate = (w: number, h: number, q: Quality = "best") => Math.round(w * h * 30 * (q === "share" ? 0.15 : 0.6));

/** "mp4" when this browser can encode H.264 at the output size and AAC, else "webm" (VP9 + Opus). */
export async function pickCodec(w = 1920, h = 1080): Promise<Container> {
  try {
    const v = await VideoEncoder.isConfigSupported({ codec: avc(w, h), width: w, height: h });
    const a = await AudioEncoder.isConfigSupported(AAC);
    return v.supported && a.supported ? "mp4" : "webm";
  } catch {
    return "webm";
  }
}

// We convert to YUV ourselves, as BT.709 limited range: what players assume for untagged HD video. Left to
// itself, Chrome converts RGBA frames to full-range YUV and does not tag it, so players crush the colours.
const BT709: VideoColorSpaceInit = { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false };
const KR = 0.2126, KB = 0.0722, KG = 1 - KR - KB;

/** RGBA -> I420 (BT.709, limited range). Chroma is the mean of each 2x2 block of the output. At an even
 * export scale (and the default x2) every chroma block lies inside one native pixel, so colours stay exact;
 * at an odd scale (x1 loops, x3) blocks straddle native pixels and chroma bleeds slightly at colour edges.
 * Width and height must be even. */
export function toI420(px: Uint8ClampedArray, w: number, h: number, out: Uint8Array): Uint8Array {
  const cw = w / 2, U = w * h, V = U + cw * (h / 2);
  for (let i = 0, j = 0; i < U; i++, j += 4) out[i] = 16 + (219 * (KR * px[j] + KG * px[j + 1] + KB * px[j + 2])) / 255 + 0.5;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const a = (y * w + x) * 4, d = a + w * 4; // top-left of this row pair, and the pixel below it
      const r = (px[a] + px[a + 4] + px[d] + px[d + 4]) / 4;
      const g = (px[a + 1] + px[a + 5] + px[d + 1] + px[d + 5]) / 4;
      const b = (px[a + 2] + px[a + 6] + px[d + 2] + px[d + 6]) / 4;
      const l = KR * r + KG * g + KB * b, c = (y / 2) * cw + x / 2;
      out[U + c] = 128 + (224 * (b - l)) / (2 * (1 - KB)) / 255 + 0.5;
      out[V + c] = 128 + (224 * (r - l)) / (2 * (1 - KR)) / 255 + 0.5;
    }
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Backpressure: wait until the encoder's queue is short again. */
async function room(enc: VideoEncoder | AudioEncoder, max = 2) {
  while (enc.encodeQueueSize > max && enc.state === "configured")
    await Promise.race([new Promise((r) => enc.addEventListener("dequeue", r, { once: true })), sleep(50)]);
}

/** A WebCodecs encoder pair writing into an in-memory MP4 or WebM. */
export function openSink(kind: Container, w: number, h: number, fps: number, withAudio: boolean, quality: Quality = "best") {
  if (w % 2 || h % 2) throw new Error(`Video needs an even width and height; this one is ${w}×${h}. Change the canvas size.`);
  const yuv = new Uint8Array((w * h * 3) / 2);
  let error: Error | null = null;
  const fail = (e: Error) => void (error ??= e);
  const check = () => {
    if (error) throw new Error(`The video encoder stopped: ${error.message}`);
  };
  const audio = withAudio ? { numberOfChannels: 2, sampleRate: 48000 } : undefined;
  const target = kind === "mp4" ? new Mp4Target() : new WebmTarget();
  const muxer =
    kind === "mp4"
      ? new Mp4Muxer({ target: target as Mp4Target, video: { codec: "avc", width: w, height: h, frameRate: fps },
          audio: audio && { codec: "aac", ...audio }, fastStart: "in-memory", firstTimestampBehavior: "offset" })
      : new WebmMuxer({ target: target as WebmTarget, video: { codec: "V_VP9", width: w, height: h, frameRate: fps },
          audio: audio && { codec: "A_OPUS", ...audio }, firstTimestampBehavior: "offset" });

  const venc = new VideoEncoder({ output: (c, m) => {
    if (m?.decoderConfig) m.decoderConfig.colorSpace = BT709; // tags the WebM; MP4 relies on the HD default
    muxer.addVideoChunk(c, m);
  }, error: fail });
  venc.configure({
    codec: kind === "mp4" ? avc(w, h) : VP9, width: w, height: h, bitrate: bitrate(w, h, quality), framerate: fps,
    ...(kind === "mp4" ? { avc: { format: "avc" as const } } : {}),
  });
  let aenc: AudioEncoder | null = null;
  try {
    aenc = withAudio ? new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: fail }) : null;
    aenc?.configure(kind === "mp4" ? AAC : OPUS);
  } catch (e) {
    venc.close(); // never leave a configured encoder behind
    throw e;
  }

  return {
    /** Encodes one RGBA frame; resolves once the encoder has room for the next. */
    async frame(px: Uint8ClampedArray, i: number, key: boolean) {
      check();
      const f = new VideoFrame(toI420(px, w, h, yuv), { format: "I420", codedWidth: w, codedHeight: h, colorSpace: BT709, timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(f, { keyFrame: key });
      f.close();
      await room(venc);
      check();
    },
    /** Encodes the whole mix, 100 ms at a time. */
    async audio(buf: AudioBuffer) {
      if (!aenc) return;
      const C = buf.numberOfChannels, step = buf.sampleRate / 10;
      for (let i = 0; i < buf.length; i += step) {
        check();
        const n = Math.min(step, buf.length - i);
        const data = new Float32Array(n * C);
        for (let c = 0; c < C; c++) data.set(buf.getChannelData(c).subarray(i, i + n), c * n);
        const a = new AudioData({ format: "f32-planar", sampleRate: buf.sampleRate, numberOfFrames: n, numberOfChannels: C, timestamp: Math.round((i * 1e6) / buf.sampleRate), data });
        aenc.encode(a);
        a.close();
        await room(aenc, 8);
      }
    },
    async finish(): Promise<Blob> {
      await venc.flush();
      await aenc?.flush();
      check();
      muxer.finalize();
      this.close();
      return new Blob([target.buffer], { type: kind === "mp4" ? "video/mp4" : "video/webm" });
    },
    close() {
      for (const e of [venc, aenc]) if (e && e.state !== "closed") e.close();
    },
  };
}
