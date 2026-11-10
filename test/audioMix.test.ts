import { afterEach, describe, expect, it, vi } from "vitest";
import { mixAudio } from "../src/export/audioMix";
import { newProject, type Project } from "../src/core/project";

// A minimal OfflineAudioContext that really mixes: buffer sources -> gain (value, setValueAtTime,
// linearRampToValueAtTime) -> destination, sample by sample.
class Buf {
  data: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(c: number) { return this.data[c]; }
}
type Ev = { v: number; t: number; ramp: boolean };
class Param {
  ev: Ev[] = [];
  constructor(public value: number) {}
  setValueAtTime(v: number, t: number) { this.ev.push({ v, t, ramp: false }); }
  linearRampToValueAtTime(v: number, t: number) { this.ev.push({ v, t, ramp: true }); }
  at(t: number) {
    let v = this.value, t0 = 0;
    for (const e of this.ev) {
      if (t < e.t) return e.ramp ? v + ((e.v - v) * (t - t0)) / (e.t - t0) : v;
      v = e.v; t0 = e.t;
    }
    return v;
  }
}
class Stub {
  sources: { buffer: Buf | null; gain?: Param; start: number; offset: number; stop: number }[] = [];
  destination = {};
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {}
  createBuffer(c: number, n: number, sr: number) { return new Buf(c, n, sr); }
  createGain() {
    const gain = new Param(1);
    return { gain, connect: (d: unknown) => d };
  }
  createBufferSource() {
    const s = { buffer: null as Buf | null, gain: undefined as Param | undefined, start: 0, offset: 0, stop: Infinity };
    this.sources.push(s);
    return {
      set buffer(b: Buf) { s.buffer = b; },
      connect: (g: { gain: Param }) => ((s.gain = g.gain), g),
      start: (when = 0, offset = 0) => ((s.start = when), (s.offset = offset)),
      stop: (when = 0) => (s.stop = when),
    };
  }
  async startRendering() {
    const out = new Buf(this.numberOfChannels, this.length, this.sampleRate);
    for (const s of this.sources) {
      for (let i = 0; i < this.length; i++) {
        const t = i / this.sampleRate;
        if (t < s.start || t >= s.stop) continue;
        const j = Math.floor((t - s.start + s.offset) * s.buffer!.sampleRate);
        if (j >= s.buffer!.length) continue;
        for (let c = 0; c < out.numberOfChannels; c++)
          out.data[c][i] += s.buffer!.data[Math.min(c, s.buffer!.numberOfChannels - 1)][j] * (s.gain?.at(t) ?? 1);
      }
    }
    return out;
  }
}

const SR = 48000;
function project(duration: number, audio: { t: number; vol_db?: number }[]): Project {
  const p = newProject("mix");
  p.files.set("sfx/one.wav", new Blob([new Uint8Array(4)]));
  p.kit.assets.one = { approved: true, source: "user", kind: "sfx", path: "sfx/one.wav" };
  p.tl = {
    name: "mix", duration, shots: [], actors: [], fx: [],
    audio: audio.map((a, i) => ({ id: `s${i}`, clip: "one", kind: "sfx" as const, ...a })),
  };
  return p;
}
// A 1 s clip of constant 0.5, mono.
const decodeOnes = async () => {
  const b = new Buf(1, SR, SR);
  b.data[0].fill(0.5);
  return b as unknown as AudioBuffer;
};

afterEach(() => vi.unstubAllGlobals());

describe("mixAudio", () => {
  it("vol_db_applied", async () => {
    vi.stubGlobal("OfflineAudioContext", Stub);
    const out = await mixAudio(project(2, [{ t: 0.5, vol_db: -6 }]), decodeOnes);
    expect(out.sampleRate).toBe(48000);
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(2 * SR);
    const L = out.getChannelData(0), R = out.getChannelData(1);
    expect(L[Math.round(0.25 * SR)]).toBe(0); // before the clip
    expect(L[Math.round(1.0 * SR)]).toBeCloseTo(0.5 * 10 ** (-6 / 20), 5);
    expect(R[Math.round(1.0 * SR)]).toBeCloseTo(0.5 * 10 ** (-6 / 20), 5);
    expect(L[Math.round(1.75 * SR)]).toBe(0); // after its 1 s
  });

  it("clip_cut_at_duration_with_fade", async () => {
    vi.stubGlobal("OfflineAudioContext", Stub);
    const out = await mixAudio(project(1.5, [{ t: 1.0 }]), decodeOnes);
    expect(out.length).toBe(1.5 * SR);
    const L = out.getChannelData(0);
    expect(L[Math.round(1.2 * SR)]).toBeCloseTo(0.5, 5); // full level well before the end
    expect(L[Math.round(1.495 * SR)]).toBeCloseTo(0.25, 2); // halfway down the last 10 ms
    expect(Math.abs(L[L.length - 1])).toBeLessThan(0.01); // reaches silence at the cut, no click
    expect(L[Math.round((1.5 - 0.011) * SR)]).toBeCloseTo(0.5, 5); // the fade is only 10 ms long
  });
});
