import { activeAudio } from "../core/audioPlan";
import { assetStatus, type Img } from "../core/kit";
import { missingReport } from "../core/missing";
import type { Project } from "../core/project";
import { renderFrame } from "../core/render";
import { validateTimeline } from "../core/timeline";
import type { Timeline } from "../core/types";
import { decodeAudio } from "../export/audioMix";
import { pickTrack } from "./music";
import { renderApprovals } from "./approvals";
import { decode } from "./cast";
import { toast } from "./dialogs";
import { renderInspector } from "./inspector";
import { emptyTimeline } from "./scene";
import type { Step } from "./steps";
import {
  FPS, History, addAction, addEntry, deleteEntry, find, moveEntry, moveShotEdge, newId, resizeEntry, snap, splitShot, type EditResult,
} from "./timelineEditor";

const pct = (x: number) => `${(x * 100).toFixed(4)}%`;
const ICON_PLAY = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor"/></svg>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderTweak(root: HTMLElement, p: Project, changed: () => void, go: (n: Step) => void): void {
  if (!p.tl) {
    root.innerHTML = `<section class="empty-page"><h1>Tweak</h1>
      <p class="hint">There is no timeline yet. Draft one from a description in ① Scene, or start an empty one and build it here.</p>
      <div class="row"><button class="btn primary" type="button" data-act="empty">Start an empty timeline</button>
      <button class="btn" type="button" data-act="scene">Go to Scene</button></div></section>`;
    root.querySelector<HTMLButtonElement>("[data-act=empty]")!.onclick = () => {
      p.tl = emptyTimeline();
      changed();
      renderTweak(root, p, changed, go);
    };
    root.querySelector<HTMLButtonElement>("[data-act=scene]")!.onclick = () => go(2);
    return;
  }
  const tl = () => p.tl as Timeline;
  const { W, H } = p.canvas;
  const hist = new History();
  let t = 0;
  let selected: string | null = null;
  let playing = false;

  root.innerHTML = `
  <div class="tweak">
    <div class="stage"><canvas class="px preview" data-testid="preview" aria-label="Preview"></canvas></div>
    <div class="transport">
      <button class="btn icon" type="button" data-act="play" aria-label="Play (Space)" title="Play / pause (Space)"></button>
      <span class="timecode" data-testid="timecode" aria-live="off"></span>
      <span class="sep"></span>
      <button class="btn quiet" type="button" data-act="undo" title="Undo (Ctrl+Z)">Undo</button>
      <button class="btn quiet" type="button" data-act="redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
      <span class="grow"></span>
      <button class="btn quiet" type="button" data-act="actor">+ Actor</button>
      <button class="btn quiet" type="button" data-act="fx">+ Effect</button>
      <button class="btn quiet" type="button" data-act="sound">+ Sound</button>
      <button class="btn quiet" type="button" data-act="music">+ Music</button>
      <button class="btn quiet" type="button" data-act="split" title="Split the shot at the playhead">Split shot</button>
      <span class="status" data-testid="status"></span>
      <button class="btn primary" type="button" data-act="next">Next: Export</button>
    </div>
    <div class="tracks" data-testid="tracks"></div>
    <aside class="side"><section class="inspector"></section><section class="needs-box"></section></aside>
  </div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const canvas = $<HTMLCanvasElement>(".preview");
  const stage = $(".stage");
  const tracks = $(".tracks");
  const playBtn = $<HTMLButtonElement>("[data-act=play]");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  const frame: Img = { w: W, h: H, px: new Uint8ClampedArray(W * H * 4) };

  // Decoded PNGs, once per path.
  const imgs = new Map<string, Img>();
  const loadImgs = async () => {
    for (const [path, blob] of p.files) {
      if (!/\.png$/i.test(path) || imgs.has(path)) continue;
      try {
        imgs.set(path, await decode(blob));
      } catch {
        /* an unreadable file stays missing and shows in Needs approval */
      }
    }
    canvas.dataset.ready = "1";
    paint();
  };

  // Native-size canvas; CSS scales it by the largest whole number that fits (below 1×, it shrinks to fit).
  const fit = () => {
    const r = stage.getBoundingClientRect();
    const k = Math.min(r.width / W, r.height / H);
    const s = k >= 1 ? Math.floor(k) : k;
    canvas.style.width = `${W * s}px`;
    canvas.style.height = `${H * s}px`;
    canvas.title = k >= 1 ? `Preview ×${s}` : `Preview shrunk to ${Math.round(s * 100)}% to fit; the export is pixel-exact`;
  };
  new ResizeObserver(fit).observe(stage);

  function paint() {
    const T = tl();
    t = Math.min(Math.max(t, 0), T.duration);
    if (T.shots.length) renderFrame({ tl: T, kit: p.kit, img: (k) => imgs.get(k) ?? null, draft: false, W, H }, t, frame);
    else frame.px.fill(0);
    g.putImageData(new ImageData(frame.px, W, H), 0, 0);
    $("[data-testid=timecode]").innerHTML = `<b>${t.toFixed(2)}</b> / ${T.duration.toFixed(2)} s <span class="muted">· frame ${Math.round(t * FPS)}</span>`;
    tracks.style.setProperty("--p", String(t / T.duration));
    playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute("aria-label", playing ? "Pause (Space)" : "Play (Space)");
  }

  // ---- audio: decoded lazily on first play, started and stopped to follow activeAudio(t)
  let ctx: AudioContext | null = null;
  const bufs = new Map<string, AudioBuffer>(); // by clip id
  const voices = new Map<string, AudioBufferSourceNode>(); // by audio entry id
  const has = (path: string) => p.files.has(path);
  async function loadAudio() {
    ctx ??= new AudioContext();
    await ctx.resume();
    for (const e of tl().audio) {
      const a = p.kit.assets[e.clip];
      if (bufs.has(e.clip) || !a || assetStatus(p.kit, e.clip, false, has) !== "ok") continue;
      try {
        bufs.set(e.clip, await decodeAudio(ctx, p, a.path));
      } catch {
        toast(`Could not play ${e.clip}: the file is not audio this browser can read.`, "error");
      }
    }
  }
  function syncAudio() {
    if (!ctx) return;
    const T = tl();
    const lengths = Object.fromEntries([...bufs].map(([k, b]) => [k, b.duration]));
    const live = new Map(activeAudio(T.audio, t, lengths, T.duration).map((x) => [x.id, x.offset]));
    for (const [id, v] of voices) if (!live.has(id)) (v.stop(), voices.delete(id));
    for (const [id, offset] of live) {
      if (voices.has(id)) continue;
      const e = T.audio.find((x) => x.id === id)!;
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = bufs.get(e.clip)!;
      gain.gain.value = 10 ** ((e.vol_db ?? 0) / 20);
      src.connect(gain).connect(ctx.destination);
      src.start(0, offset);
      voices.set(id, src);
    }
  }
  const silence = () => (voices.forEach((v) => v.stop()), voices.clear());

  // ---- transport
  let wall0 = 0, t0 = 0;
  async function play() {
    if (t >= tl().duration) t = 0;
    playing = true;
    paint();
    try {
      await loadAudio();
    } catch {
      ctx = null; // no audio device or WebAudio: play the pictures silently
      toast("Sound could not start in this browser, so the preview plays silently.", "error");
    }
    if (!playing) return;
    wall0 = performance.now();
    t0 = t;
    requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    silence();
    paint();
  }
  function tick() {
    if (!playing) return;
    if (!canvas.isConnected) return pause();
    t = t0 + (performance.now() - wall0) / 1000;
    if (t >= tl().duration) {
      t = tl().duration;
      pause();
    }
    syncAudio();
    paint();
    if (playing) requestAnimationFrame(tick);
  }
  function seek(to: number) {
    if (playing) pause();
    t = to;
    paint();
  }
  playBtn.onclick = () => (playing ? pause() : play());

  // ---- edits: every change goes through a pure op, then into the undo stack
  function commit(r: EditResult, select?: string | null) {
    if (r.error) {
      toast(r.error, "error");
      draw();
      return;
    }
    if (select !== undefined) selected = select;
    if (r.tl !== p.tl) {
      hist.push(tl());
      p.tl = r.tl;
      changed();
    }
    draw();
  }
  function travel(to: Timeline | null) {
    if (!to) return;
    p.tl = to;
    if (selected && !find(to, selected)) selected = null;
    changed();
    draw();
  }
  $<HTMLButtonElement>("[data-act=undo]").onclick = () => travel(hist.undo(tl()));
  $<HTMLButtonElement>("[data-act=redo]").onclick = () => travel(hist.redo(tl()));
  $<HTMLButtonElement>("[data-act=next]").onclick = () => go(4);
  $<HTMLButtonElement>("[data-act=split]").onclick = () => {
    const s = tl().shots.find((x) => t > x.start && t < x.end);
    if (!s) return toast("Move the playhead inside a shot to split it.", "error");
    const r = splitShot(tl(), s.id, t);
    commit(r, r.id);
  };
  $<HTMLButtonElement>("[data-act=actor]").onclick = () => {
    const char = Object.keys(p.kit.chars)[0];
    if (!char) return toast("Add a character in ② Cast first.", "error");
    const r = addEntry(tl(), "actors", { char, x: Math.round(W / 2), y: Math.round(H * 0.8), actions: [] }, "actor");
    commit(r, r.id);
  };
  $<HTMLButtonElement>("[data-act=fx]").onclick = () => {
    const r = addEntry(tl(), "fx", { t: snap(t), fx: "effect1", x: Math.round(W / 2), y: Math.round(H / 2) }, "f");
    commit(r, r.id);
  };
  $<HTMLButtonElement>("[data-act=sound]").onclick = () => {
    const r = addEntry(tl(), "audio", { t: snap(t), clip: "sound1", kind: "sfx" }, "sound");
    commit(r, r.id);
  };
  // A music entry, then the library; closed without a pick, it waits in Needs approval.
  $<HTMLButtonElement>("[data-act=music]").onclick = async () => {
    const clip = newId(tl(), "music");
    const r = addEntry(tl(), "audio", { t: snap(t), clip, kind: "music" }, "music");
    commit(r, r.id);
    if (!r.error && (await pickTrack(p, clip))) (changed(), draw());
  };

  // ---- keys (dropped once this page is gone)
  const keys = new AbortController();
  document.addEventListener(
    "keydown",
    (e) => {
      if (!canvas.isConnected) return keys.abort();
      const tgt = e.target as HTMLElement;
      if (tgt.closest("input, select, textarea, dialog") || document.querySelector("dialog[open]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") travel(e.shiftKey ? hist.redo(tl()) : hist.undo(tl()));
      else if (mod && e.key.toLowerCase() === "y") travel(hist.redo(tl()));
      else if (e.key === " ") {
        tgt.blur?.(); // keep a focused button from also taking the press
        playing ? pause() : play();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const step = (e.shiftKey ? 1 / FPS : 1) * (e.key === "ArrowLeft" ? -1 : 1);
        seek(snap(t + step));
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) commit(deleteEntry(tl(), selected), null);
      else return;
      e.preventDefault();
    },
    { signal: keys.signal },
  );

  // ---- tracks
  function bar(id: string, label: string, start: number, dur: number | undefined, opts: { grip?: boolean; warn?: boolean; locked?: boolean; cls?: string }) {
    const D = tl().duration;
    const cls = ["clip", opts.cls ?? "", id === selected ? "sel" : "", opts.warn ? "warn" : "", opts.locked ? "locked" : ""].join(" ");
    const w = dur ? `width:${pct(dur / D)}` : "";
    return `<div class="${cls}" data-id="${esc(id)}" style="left:${pct(start / D)};${w}" title="${esc(`${id}: ${label}`)}">
      <span>${esc(label)}</span>${opts.grip ? `<i class="grip" aria-hidden="true"></i>` : ""}</div>`;
  }
  function drawTracks() {
    const T = tl();
    const D = T.duration;
    const warn = new Set(missingReport(T, p.kit, false, has).map((m) => m.used_by));
    const ticks = Array.from({ length: Math.ceil(D) }, (_, s) => `<span class="tick" style="left:${pct(s / D)}">${s}</span>`).join("");
    const shots = T.shots.map((s) => bar(s.id, s.type === "closeup" ? `${s.id} · close-up ${s.face}` : `${s.id} · wide`, s.start, s.end - s.start, { cls: "shot", warn: warn.has(s.id), locked: s.locked })).join("")
      + T.shots.slice(0, -1).map((s, i) => `<i class="edge" data-a="${esc(s.id)}" data-b="${esc(T.shots[i + 1].id)}" style="left:${pct(s.end / D)}" title="Drag to move the cut"></i>`).join("");
    const row = (label: string, lane: string, attrs = "", sel = false, cls = "") =>
      `<div class="track ${cls}"><div class="track-label${sel ? " sel" : ""}" ${attrs}>${label}</div><div class="lane" ${attrs}>${lane}</div></div>`;
    const actors = T.actors.map((a) =>
      row(
        `<span class="who">${esc(a.id)}</span><span class="small">${esc(a.char)}</span>`,
        a.actions.map((x) => bar(x.id, x.do, x.t, x.dur, { grip: x.dur !== undefined, warn: warn.has(x.id), locked: x.locked })).join(""),
        `data-actor="${esc(a.id)}" title="Double-click the lane to add an action"`,
        a.id === selected,
      )).join("");
    const fx = T.fx.map((f) => bar(f.id, f.fx, f.t, (f as { dur?: number }).dur, { grip: (f as { dur?: number }).dur !== undefined, warn: warn.has(f.id), locked: f.locked, cls: "fx" })).join("");
    const audio = T.audio.map((s) => bar(s.id, s.line ? `${s.clip} “${s.line}”` : s.clip, s.t, bufs.get(s.clip)?.duration, { warn: warn.has(s.id), locked: s.locked, cls: s.kind })).join("");
    tracks.innerHTML = `
      ${row("", ticks, `data-ruler="1" title="Click or drag to move the playhead"`, false, "ruler")}
      ${row("Shots", shots)}
      ${actors || row(`<span class="small">No actors</span>`, `<span class="lane-hint">Add one with + Actor</span>`)}
      ${row("Effects", fx)}
      ${row("Audio", audio)}
      <div class="playhead" aria-hidden="true"></div>`;
    tracks.style.setProperty("--p", String(t / D));
  }

  // One pointer handler for the whole track area: seek on the ruler, move bars, drag grips and cuts.
  let lastDown = { at: 0, actor: "" }; // two presses on an empty actor lane = double-click
  tracks.onpointerdown = (e) => {
    const el = e.target as HTMLElement;
    const label = el.closest<HTMLElement>(".track-label[data-actor]");
    if (label) return commit({ tl: tl() }, label.dataset.actor!);
    const lane = el.closest<HTMLElement>(".lane");
    if (!lane || e.button !== 0) return;
    const box = lane.getBoundingClientRect();
    const D = tl().duration;
    const at = (x: number) => ((x - box.left) / box.width) * D;
    const sec = (dx: number) => (dx / box.width) * D;
    if (lane.dataset.ruler) {
      seek(snap(at(e.clientX)));
      tracks.setPointerCapture(e.pointerId);
      tracks.onpointermove = (m) => seek(snap(at(m.clientX)));
      tracks.onpointerup = tracks.onpointercancel = () => (tracks.onpointermove = tracks.onpointerup = tracks.onpointercancel = null);
      return;
    }
    const edge = el.closest<HTMLElement>(".edge");
    const b = el.closest<HTMLElement>(".clip");
    if (!edge && !b) {
      const actor = lane.dataset.actor ?? "";
      if (actor && actor === lastDown.actor && e.timeStamp - lastDown.at < 450) {
        lastDown = { at: 0, actor: "" };
        const r = addAction(tl(), actor, { t: at(e.clientX), do: "idle" });
        return commit(r, r.id);
      }
      lastDown = { at: e.timeStamp, actor };
      return commit({ tl: tl() }, actor || null);
    }
    e.preventDefault();
    tracks.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const id = b?.dataset.id ?? "";
    const it = b ? find(tl(), id) : null;
    const grip = !!el.closest(".grip");
    const startT = (it?.e.t as number | undefined) ?? 0;
    const startDur = (it?.e.dur as number | undefined) ?? 0.5;
    const draggable = edge || (it && it.kind !== "shot");
    let moved = false;
    tracks.onpointermove = (m) => {
      const dx = m.clientX - x0;
      if (!draggable || (!moved && Math.abs(dx) < 3)) return;
      moved = true;
      if (edge) edge.style.left = pct(Math.min(Math.max(at(m.clientX) / D, 0), 1));
      else if (grip) b!.style.width = pct(Math.max(snap(startDur + sec(dx)), 1 / FPS) / D);
      else b!.style.left = pct(Math.min(Math.max(snap(startT + sec(dx)), 0), D) / D);
    };
    tracks.onpointercancel = () => {
      tracks.onpointermove = tracks.onpointerup = tracks.onpointercancel = null;
      draw(); // put the dragged bar back
    };
    tracks.onpointerup = (u) => {
      tracks.onpointermove = tracks.onpointerup = tracks.onpointercancel = null;
      const dx = u.clientX - x0;
      if (!moved) return id ? commit({ tl: tl() }, id) : undefined;
      if (edge) commit(moveShotEdge(tl(), edge.dataset.a!, edge.dataset.b!, at(u.clientX)));
      else if (grip) commit(resizeEntry(tl(), id, startDur + sec(dx)), id);
      else commit(moveEntry(tl(), id, startT + sec(dx)), id);
    };
  };
  function draw() {
    const T = tl();
    drawTracks();
    const errs = validateTimeline(T);
    const kitChanged = () => (changed(), loadImgs().then(draw));
    renderInspector($(".inspector"), T, selected, { kit: p.kit, project: p, now: () => t, errors: errs, kitChanged }, (r, sel) => commit(r, sel), (id) => commit(deleteEntry(tl(), id), null));
    renderApprovals($(".needs-box"), p, (r) => commit(r), kitChanged);
    drawStatus();
    $<HTMLButtonElement>("[data-act=undo]").disabled = !hist.canUndo;
    $<HTMLButtonElement>("[data-act=redo]").disabled = !hist.canRedo;
    paint();
  }

  // "Ready to export", or how many pieces wait, linked to the first of them in Needs approval.
  function drawStatus() {
    const box = $("[data-testid=status]");
    const n = missingReport(tl(), p.kit, false, has).length;
    const empty = !tl().actors.length && !tl().shots.some((x) => x.bg);
    box.className = n || empty ? "status muted" : "status ok";
    if (!n) return void (box.textContent = empty ? "Nothing in the scene yet" : "Ready to export");
    const b = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet warn", textContent: `${n} piece${n === 1 ? " needs" : "s need"} you` });
    b.onclick = () => {
      const row = root.querySelector<HTMLElement>(".needs > li[tabindex]");
      row?.scrollIntoView({ block: "nearest" });
      row?.focus();
    };
    box.replaceChildren(b);
  }

  draw();
  fit();
  loadImgs();
}
