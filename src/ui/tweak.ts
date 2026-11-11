import { activeAudio } from "../core/audioPlan";
import { catOfTrack, type Cat } from "./category";
import { framingIssues, type FrameIssue } from "../core/framing";
import { sceneNotes } from "../core/pacing";
import { animStatus, assetStatus, type Img } from "../core/kit";
import { actorName, fxName, labelOf, shotName, timeName } from "../core/labels";
import { moveLabel } from "../core/moves";
import { missingReport } from "../core/missing";
import type { Project } from "../core/project";
import { actorFocus, frameZoom, fxEnd, newFxDur, renderFrame } from "../core/render";
import { unzoom, zoomFrame, zoomView } from "../core/raster";
import { actionSpan, downAt, pose, shotAt } from "../core/acting";
import { charFrames } from "../core/frames";
import { validateTimeline } from "../core/timeline";
import type { Actor, CamKey, Timeline } from "../core/types";
import { decodeAudio } from "../export/audioMix";
import { loadTracks, useTrack } from "./music";
import { renderDrawer, droppedItem, knownItem, isItemDrag, type DrawerItem, type DropAt } from "./drawer";
import { addLibraryFx, loadFx, rebakeFx } from "../core/fxLibrary";
import { selBox, followKeys, aimAngle, aimHandle, camNow, dragTarget, ghostAt, groundAt, hitTest, moveBy, nudgeTarget, onAimHandle, snapGround, walks, type Target } from "./stageEdit";
import { readyChars } from "../core/kit";
import { renderApprovals } from "./approvals";
import { addMove, changeMove } from "./addMove";
import { decode } from "./cast";
import { toast } from "./dialogs";
import { renderInspector } from "./inspector";
import { openDialogue } from "./dialogue";
import { openStoryboard } from "./storyboard";
import { emptyTimeline } from "./scene";
import type { Step } from "./steps";
import {
  FPS, History, addAction, addEntry, deleteEntry, find, lanes, moveEntry, moveShotEdge, newId, playhead, resizeEntry, setField, snap, splitShot, trimStart, copyMany, pasteMany, moveMany, deleteMany, applyToOthers, type Clip, insertShot, panShot, transition, shotTransition, addTimeFx, camKeyAt, setCamera, type EditResult,
} from "./timelineEditor";

const ACTIONS_MENU = ["walk", "move", "look_around", "startle", "hurt", "dust", "say"];
const LABEL_W = 112; // the track names column; keep in step with --label in style.css
const pct = (x: number) => `${(x * 100).toFixed(4)}%`;
const ICON_PLAY = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor"/></svg>`;
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** 4.12 s as "00:04.12": minutes, seconds, hundredths. */
export const clock = (s: number) => {
  const c = Math.round(s * 100);
  return `${String(Math.floor(c / 6000)).padStart(2, "0")}:${((c % 6000) / 100).toFixed(2).padStart(5, "0")}`;
};

let clipboard: Clip[] | null = null; // Ctrl+C / Ctrl+V; kept while the tab is open, across projects

export function renderTweak(root: HTMLElement, p: Project, changed: () => void, go: (n: Step) => void): void {
  if (!p.tl) {
    root.innerHTML = `<section class="empty-page"><h1>Tweak</h1>
      <p class="hint">There is no timeline yet. Draft one from a description in Scene, or start an empty one and build it here.</p>
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
  const multi = new Set<string>(); // more bars selected with Shift/Ctrl+click, besides `selected`
  const isSel = (id: string) => id === selected || multi.has(id);
  const group = () => [...new Set([selected, ...multi].filter((x): x is string => !!x))];
  // a locked row: its bars still select, but they don't move, paste or delete (kept with the project)
  const rowOf = (id: string) => {
    const at = find(tl(), id);
    return at?.kind === "action" ? (at.actor.id as string) : at?.kind === "actor" ? (at.e.id as string) : at?.kind === "fx" ? "fx" : at?.kind === "audio" ? "audio" : null;
  };
  const rowLocked = (row: string | null) => !!row && (p.lockedRows ?? []).includes(row);
  const rowName = (r: string) => (r === "fx" ? "Effects" : r === "audio" ? "Audio" : actorName(tl(), r));
  const refuseRows = (rows: (string | null)[]) => {
    const r = rows.find(rowLocked);
    if (r) toast(`The ${rowName(r)} row is locked. Unlock it with its padlock first.`, "error");
    return !!r;
  };
  let playing = false;

  root.innerHTML = `
  <div class="tweak">
    <aside class="drawer" data-testid="drawer" aria-label="Library"></aside>
    <div class="d-resize" role="separator" aria-orientation="vertical" aria-label="Library width" aria-valuemin="160" aria-valuemax="480" tabindex="0" title="Drag to resize the library"></div>
    <div class="stage"><canvas class="px preview" data-testid="preview" aria-label="Preview" tabindex="0"></canvas><canvas class="px overlay" aria-hidden="true"></canvas></div>
    <div class="transport">
      <button class="btn icon" type="button" data-act="play" aria-label="Play (Space)" title="Play / pause (Space)"></button>
      <span class="timecode" data-testid="timecode" aria-hidden="true"></span><span class="sr-only" data-testid="sr-time" aria-live="polite"></span>
      <span class="sep"></span>
      <button class="btn quiet" type="button" data-act="undo" title="Undo (Ctrl+Z)">Undo</button>
      <button class="btn quiet" type="button" data-act="redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
      <span class="sep"></span>
      <span class="zoom" role="group" aria-label="Timeline zoom"><span class="zoom-lbl" aria-hidden="true">Zoom</span><button class="btn icon quiet" type="button" data-act="zoom-out" aria-label="Zoom the timeline out" title="Zoom the timeline out (Ctrl+wheel on the tracks)">−</button><button class="btn icon quiet" type="button" data-act="zoom-in" aria-label="Zoom the timeline in" title="Zoom the timeline in (Ctrl+wheel on the tracks)">+</button></span>
      <span class="grow"></span>
      <button class="btn quiet" type="button" data-act="keys" aria-haspopup="dialog" title="Keyboard shortcuts (?)">Keys</button>
      <button class="btn quiet" type="button" data-act="shot" aria-haspopup="menu" aria-expanded="false" title="Add a shot or a transition at the playhead">+ Shot ▾</button>
      <span class="brk" aria-hidden="true"></span>
      <span class="scale-line" data-testid="scale-line"></span>
      <button class="btn quiet" type="button" data-act="storyboard" title="Every shot as a picture: jump to one, or drag it to a new place">Storyboard</button>
      <button class="btn quiet" type="button" data-act="dialogue" title="Every line of the scene in one list: who says what, spoken or not">Dialogue</button>
      <span class="status" data-testid="status"></span>
      <button class="btn primary" type="button" data-act="next">Next: Export</button>
    </div>
    <div class="tracks" data-testid="tracks"></div>
    <aside class="side"><section class="inspector"></section><section class="guide-box" role="region" aria-label="Getting started" hidden></section><section class="frame-box" data-testid="framing" hidden></section></aside>
    <dialog class="approvals" aria-label="Approve pieces"><div class="needs-box"></div><div class="row end"><button class="btn" type="button" data-act="approvals-close">Close</button></div></dialog>
  </div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const approvals = $<HTMLDialogElement>(".approvals");
  const openApprovals = () => (approvals.open ? undefined : approvals.showModal());
  $(".tweak").addEventListener("pc:approvals", openApprovals); // the top-bar band asks for it
  $<HTMLButtonElement>("[data-act=approvals-close]").onclick = () => approvals.close();
  approvals.onclose = () => root.ownerDocument.querySelector<HTMLElement>("[data-testid=next-band]:not([hidden])")?.focus(); // Esc lands back on the band
  const canvas = $<HTMLCanvasElement>(".preview");
  const stage = $(".stage");
  const over = $<HTMLCanvasElement>(".overlay");
  const tracks = $(".tracks");
  const playBtn = $<HTMLButtonElement>("[data-act=play]");
  canvas.width = W;
  canvas.height = H;
  over.width = W;
  over.height = H;
  $("[data-testid=scale-line]").textContent = `${W}×${H} · ×${p.canvas.exportScale} → ${W * p.canvas.exportScale}×${H * p.canvas.exportScale} · pixel-exact`;
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
    drawFraming();
  };

  // Native-size canvas; CSS scales it by the largest whole number that fits (below 1×, it shrinks to fit).
  const fit = () => {
    const r = stage.getBoundingClientRect();
    const k = Math.min(r.width / W, r.height / H);
    const s = k >= 1 ? Math.floor(k) : k;
    canvas.style.width = `${W * s}px`;
    canvas.style.height = `${H * s}px`;
    over.style.width = canvas.style.width;
    over.style.height = canvas.style.height;
    canvas.title = k >= 1 ? `Preview ×${s}` : `Preview shrunk to ${Math.round(s * 100)}% to fit; the export is pixel-exact`;
  };
  new ResizeObserver(fit).observe(stage);

  // the library is as wide as the user drags it (160-480 px, remembered in this browser)
  const grid = $(".tweak"), grip = $(".d-resize");
  const setDrawer = (w: number) => {
    w = Math.round(Math.min(480, Math.max(160, w)));
    grid.style.setProperty("--drawer", `${w}px`);
    grip.setAttribute("aria-valuenow", String(w));
  };
  const saveDrawer = () => { try { localStorage.setItem("pc.drawer", grip.getAttribute("aria-valuenow")!); } catch { /* private window */ } };
  try { setDrawer(Number(localStorage.getItem("pc.drawer")) || 220); } catch { setDrawer(220); }
  grip.onpointerdown = (e) => {
    grip.setPointerCapture(e.pointerId);
    const left = $(".drawer").getBoundingClientRect().left;
    grip.onpointermove = (m) => setDrawer(m.clientX - left);
    grip.onpointerup = grip.onpointercancel = () => (grip.onpointermove = grip.onpointerup = grip.onpointercancel = null, saveDrawer());
  };
  grip.onkeydown = (e) => {
    const step = e.key === "ArrowLeft" ? -20 : e.key === "ArrowRight" ? 20 : 0;
    if (step) { e.preventDefault(); e.stopPropagation(); setDrawer($(".drawer").getBoundingClientRect().width + step); saveDrawer(); }
  };

  const zoomed = new Uint8ClampedArray(W * H * 4); // preview zoom is nearest-neighbour at canvas size
  let view: ReturnType<typeof zoomView> | null = null; // the zoom on screen now: picking, dragging and overlays go through it
  function paint() {
    const T = tl();
    t = Math.min(Math.max(t, 0), T.duration);
    const inp = { tl: T, kit: p.kit, img: (k: string) => imgs.get(k) ?? null, draft: false, W, H };
    if (T.shots.length) renderFrame(inp, t, frame);
    else frame.px.fill(0);
    const z = T.shots.length ? frameZoom(inp, t) : null;
    // stepped like the export, so the preview zooms at the same moments
    if (z) zoomFrame(frame, z.z, z.x, z.y, 1, zoomed, p.canvas.exportScale);
    view = z ? zoomView(W, H, z.z, z.x, z.y, 1, p.canvas.exportScale) : null;
    g.putImageData(new ImageData(z ? zoomed : frame.px, W, H), 0, 0);
    $("[data-testid=timecode]").innerHTML = `<b>${clock(t)}</b> / ${clock(T.duration)} <span class="frame-no">· frame ${Math.round(t * FPS)}</span>`;
    if (!playing) say(T); // read out where a stopped playhead is, never every frame of playback
    tracks.style.setProperty("--p", String(t / T.duration));
    if (playing && zoom > 1) { // a zoomed strip follows the playhead
      const x = LABEL_W + 10 + ((tracks.scrollWidth - LABEL_W) - 20) * (t / T.duration) - tracks.scrollLeft;
      if (x < LABEL_W || x > tracks.clientWidth - 20) tracks.scrollLeft += x - LABEL_W - 20;
    }
    // only when it changes: rebuilding the icon every frame swallowed clicks that landed on it
    if (playBtn.dataset.state !== String(playing)) {
      playBtn.dataset.state = String(playing);
      playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
      playBtn.setAttribute("aria-label", playing ? "Pause (Space)" : "Play (Space)");
    }
    drawOverlay();
  }

  // what screen readers get: the preview describes its frame, and a stopped playhead is announced once it settles
  let sayTimer = 0;
  function say(T: Timeline) {
    const shot = T.shots.length ? shotAt(T, t) : null;
    const frames = charFrames(p.kit, (k: string) => imgs.get(k) ?? null, false, (f: string) => p.files.has(f));
    const on = T.actors.filter((a) => { const q = pose(a, t, frames); return q && !q.gone; }).map((a) => actorName(T, a.id));
    canvas.setAttribute("aria-label", `Preview at ${t.toFixed(2)} s, ${shot ? shotName(T, shot.id) : "no shots"}, ${on.length ? `${on.join(", ")} on stage` : "nobody on stage"}`);
    clearTimeout(sayTimer);
    const text = `${t.toFixed(2)} of ${T.duration.toFixed(2)} s, frame ${Math.round(t * FPS)}`;
    sayTimer = window.setTimeout(() => ($("[data-testid=sr-time]").textContent = text), 250);
  }

  // ---- audio: decoded lazily on first play, started and stopped to follow activeAudio(t)
  let ctx: AudioContext | null = null;
  const bufs = new Map<string, AudioBuffer>(); // by clip id
  const decodedFrom = new Map<string, Blob>(); // the file each buffer came from: a redone clip is decoded again
  const voices = new Map<string, AudioBufferSourceNode>(); // by audio entry id
  const has = (path: string) => p.files.has(path);
  // decodes every usable clip not decoded yet; an offline context needs no click, so the bars get their length on open
  async function decodeClips(c: BaseAudioContext, quiet: boolean) {
    for (const e of tl().audio) {
      const a = p.kit.assets[e.clip];
      const file = a && p.files.get(a.path);
      if (!a || !file || decodedFrom.get(e.clip) === file || assetStatus(p.kit, e.clip, false, has) !== "ok") continue;
      try {
        const b = await decodeAudio(c, p, a.path);
        bufs.set(e.clip, b);
        decodedFrom.set(e.clip, file);
        // voice bubbles last as long as their clip; kept in memory, saved with the next real edit (opening is not an edit)
        a.len = Math.round(b.duration * 100) / 100;
      } catch {
        if (!quiet) toast(`Could not play ${e.clip}: the file is not audio this browser can read.`, "error");
      }
    }
  }
  const clipLengths = () => decodeClips(new OfflineAudioContext(2, 1, 48000), true).then(() => draw());
  async function loadAudio() {
    ctx ??= new AudioContext();
    await ctx.resume();
    await decodeClips(ctx, false);
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
  let played = false;
  async function play() {
    if (t >= tl().duration) t = 0;
    playing = true;
    played = true;
    drawGuide();
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
    t = playhead(t0, performance.now() - wall0);
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
  /** `select`: one id, null, or a list (the first becomes the main selection, the rest stay selected with it). */
  function commit(r: EditResult, select?: string | null | string[]) {
    if (r.error) {
      toast(r.error, "error");
      draw();
      return;
    }
    if (select !== undefined) {
      multi.clear();
      if (Array.isArray(select)) {
        selected = select[0] ?? null;
        select.slice(1).forEach((x) => multi.add(x));
      } else selected = select;
    }
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
    for (const x of multi) if (!find(to, x)) multi.delete(x);
    changed();
    draw();
  }
  $<HTMLButtonElement>("[data-act=undo]").onclick = () => travel(hist.undo(tl()));
  $<HTMLButtonElement>("[data-act=redo]").onclick = () => travel(hist.redo(tl()));
  $<HTMLButtonElement>("[data-act=next]").onclick = () => go(4);
  $<HTMLButtonElement>("[data-act=storyboard]").onclick = () =>
    openStoryboard(tl, (T, at) => {
      const o: Img = { w: W, h: H, px: new Uint8ClampedArray(W * H * 4) };
      renderFrame({ tl: T, kit: p.kit, img: (k: string) => imgs.get(k) ?? null, draft: false, W, H }, at, o);
      return o;
    }, (r) => commit(r), (at) => seek(at));
  $<HTMLButtonElement>("[data-act=dialogue]").onclick = () =>
    tl().actors.length ? openDialogue(tl(), p.kit, t, (r) => commit(r, null)) : toast("Add a character first: dialogue belongs to someone.", "error");
  // A 2 s close-up on actor a at `at`: a zoom on them, sized so they fill most of the frame's height. Null off a wide shot.
  function focusAt(T: Timeline, a: Actor, at: number) {
    const cam = camNow(T, at);
    const q = pose(a, at, charFrames(p.kit, imgOf, false, has));
    if (!q?.img || !cam) return null;
    return { ...actorFocus(q as Parameters<typeof actorFocus>[0], cam), z: Math.max(2, Math.min(4, Math.floor((H * 0.9) / q.img.h))) };
  }
  function closeUpOn(T: Timeline, a: Actor, at: number): EditResult | null {
    const f = focusAt(T, a, at);
    return f && insertShot(T, at, 2, { zoom: { from: f.z, to: f.z, x: Math.round(f.x), y: Math.round(f.y), actor: a.id } });
  }
  // ---- + Shot: cuts, close-ups, pans, zooms and transitions, all at the playhead
  const shotBtn = $<HTMLButtonElement>("[data-act=shot]");
  shotBtn.onclick = () => {
    const T = tl(), at = snap(t), cam = camNow(T, at);
    const wideOnly = (f: () => EditResult) => () => (cam ? f() : { tl: T, error: "Move the playhead to a wide shot first (close-ups have no camera)." });
    const items: [string, () => EditResult][] = [];
    items.push(["Cut here", () => {
      const s = T.shots.find((x) => at > x.start && at < x.end);
      return s ? splitShot(T, s.id, at) : { tl: T, error: "Move the playhead inside a shot to cut it." };
    }]);
    for (const a of T.actors) {
      const r = closeUpOn(T, a, at);
      if (r) items.push([`Close-up on ${actorName(T, a.id)}`, () => r]);
    }
    for (const [face, exprs] of Object.entries(p.kit.faces))
      for (const expr of Object.keys(exprs)) items.push([`Close-up portrait: ${face} · ${expr}`, () => insertShot(T, at, 2, { type: "closeup", face, expr })]);
    const sh = T.shots.length ? shotAt(T, at) : null;
    const bg = sh?.bg ? imgs.get(p.kit.assets[sh.bg]?.path ?? "") : undefined;
    const k = sh?.type === "wide" ? (sh.bg_scale ?? 1) : 1;
    const extra = { x: bg ? bg.w * k - W : 0, y: bg ? bg.h * k - H : 0 };
    for (const d of ["left", "right", "up", "down"] as const) items.push([`Pan ${d}`, wideOnly(() => panShot(T, at, d, extra))]);
    const focusOn = (a: Actor) => focusAt(T, a, at);
    const sel = T.actors.find((a) => a.id === selected);
    const zf = (sel && focusOn(sel)) || { x: W / 2, y: H / 2 };
    const on = sel ? ` on ${actorName(T, sel.id)}` : "";
    const follow = sel && focusOn(sel) ? { actor: sel.id } : {};
    items.push([`Zoom in${on}`, wideOnly(() => insertShot(T, at, undefined, { zoom: { from: 1, to: 2, x: Math.round(zf.x), y: Math.round(zf.y), ...follow } }))]);
    items.push([`Zoom out${on}`, wideOnly(() => insertShot(T, at, undefined, { zoom: { from: 2, to: 1, x: Math.round(zf.x), y: Math.round(zf.y), ...follow } }))]);
    items.push(["Fade in from black", () => transition(T, at, "fade_in")]);
    items.push(["Fade out to black", () => transition(T, at, "fade_out")]);
    items.push(["White flash", () => transition(T, at, "flash")]);
    items.push(["Shake", wideOnly(() => transition(T, at, "shake"))]);
    for (const a of T.actors) items.push([`Camera follows ${actorName(T, a.id)} (this shot)`, wideOnly(() => {
      const ks = followKeys(T, p.kit, imgOf, sh!.id, a.id, W, H, extra);
      return ks.length ? { ...setCamera(T, sh!.id, ks), id: sh!.id } : { tl: T, error: "Nothing to follow here." };
    })]);
    items.push([T.letterbox ? "Remove the cinema bars" : "Cinema bars (top and bottom)", () => setField(T, "(root)", "letterbox", T.letterbox ? undefined : Math.round(H * 0.12))]);
    items.push(["Dissolve in from the shot before", () => shotTransition(T, at, "dissolve")]);
    items.push(["Wipe in from the shot before", () => shotTransition(T, at, "wipe")]);
    items.push(["Iris in (a circle opens from black)", () => shotTransition(T, at, "iris")]);
    items.push(["Iris out at the shot's end", () => shotTransition(T, at, "iris_out")]);
    items.push(["Slow motion here (1 s)", () => addTimeFx(T, at, "slow")]);
    items.push(["Hold the frame here (0.5 s)", () => addTimeFx(T, at, "hold")]);
    items.push(["Hit-stop here (3 frames)", () => addTimeFx(T, at, "hitstop")]);
    popMenu(shotBtn, "Shots and transitions", items.map(([label, run]) => [label, () => {
      const r = run();
      if (r.error) return toast(r.error, "error");
      commit(r, r.id);
    }]));
  };
  // ---- the library drawer: click/Enter adds at the playhead, a drop adds where it landed.
  // One add at a time (a bake or a download may take a moment), so ids never collide.
  let queue: Promise<void> = Promise.resolve();
  let dragging = false; // a preview drag is live: undo, redo, nudges and adds wait
  const add = (it: DrawerItem, at: DropAt) => {
    if (dragging) return; // a drag in the preview is under way: pointer up would overwrite this
    queue = queue.then(() => addItem(it, at)).catch((e: Error) => void toast(`Could not add that: ${e.message}`, "error"));
  };
  async function addItem(it: DrawerItem, at: DropAt) {
    if (!knownItem(p.kit, it)) return void toast("That item is not in this project.", "error");
    const when = at.t !== undefined ? snap(at.t) : snap(t);
    if (it.kind === "char") {
      const r = addEntry(tl(), "actors", { char: it.char, x: at.x ?? Math.round(W / 2), y: snapGround(at.y ?? groundAt(tl(), when) ?? Math.round(H * 0.8), groundAt(tl(), when)), actions: [], ...(when > 0 ? { appear: when } : {}) }, "actor");
      return commit(r, r.id);
    }
    if (it.kind === "fx") {
      const had = new Set(Object.keys(p.kit.assets));
      const fx = await addLibraryFx(p, it.id);
      const meta = p.kit.assets[fx]?.fx;
      const dur = meta && newFxDur(meta);
      const r = addEntry(tl(), "fx", { t: when, fx, x: at.x ?? Math.round(W / 2), y: at.y ?? Math.round(H / 2), ...(dur ? { dur } : {}) }, "f");
      if (r.error && !had.has(fx)) {
        const a = p.kit.assets[fx]; // baked just now for this add: take it back
        delete p.kit.assets[fx];
        if (a) p.files.delete(a.path);
      }
      commit(r, r.id);
      return void (await loadImgs());
    }
    if (it.kind === "clip") {
      const r = addEntry(tl(), "audio", { t: when, clip: it.clip, kind: p.kit.assets[it.clip].kind === "voice" ? "voice" : "sfx" }, "sound");
      return commit(r, r.id);
    }
    if (it.kind === "sound") {
      const r = addEntry(tl(), "audio", { t: when, clip: newId(tl(), "sound"), kind: "sfx" }, "sound");
      return commit(r, r.id);
    }
    // a library track: fetched first, so a failed download leaves nothing behind
    const track = (await loadTracks()).find((x) => x.id === it.id);
    if (!track) throw new Error("that track is not in the library");
    let clip = newId(tl(), "music");
    while (p.kit.assets[clip]) clip += "_";
    await useTrack(p, clip, track);
    const r = addEntry(tl(), "audio", { t: when, clip, kind: "music" }, "music");
    if (r.error) {
      const a = p.kit.assets[clip];
      delete p.kit.assets[clip];
      if (a) p.files.delete(a.path);
    }
    commit(r, r.id);
  }
  let drawerSig = "";
  function drawDrawer() {
    const sounds = Object.entries(p.kit.assets).filter(([, a]) => a.kind === "sfx" || a.kind === "voice").map(([k, a]) => [k, has(a.path)]);
    const sig = JSON.stringify([readyChars(p.kit, has), sounds]);
    if (sig === drawerSig) return;
    drawerSig = sig;
    renderDrawer($(".drawer"), p, add);
  }
  canvas.ondragover = (e) => isItemDrag(e) && e.preventDefault();
  // pointer -> frame pixels before any zoom (not rounded); the drop and the stage editing share it
  // canvas px per screen px (the preview is shown scaled, and zoomed by view.P)
  const perScreenPx = (v = view) => W / (canvas.getBoundingClientRect().width || W) / (v?.P ?? 1);
  const canvasPt = (e: { clientX: number; clientY: number }, v = view) => {
    const r = canvas.getBoundingClientRect();
    const c = { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
    return v ? unzoom(v, c.x, c.y, W, H, 1) : c;
  };
  canvas.ondrop = (e) => {
    const it = droppedItem(e);
    if (!it) return;
    e.preventDefault();
    const cam = camNow(tl(), t) ?? { x: 0, y: 0 };
    const c = canvasPt(e);
    add(it, { x: Math.round(c.x) + cam.x, y: Math.round(c.y) + cam.y });
  };

  // ---- editing in the preview: pick, drag, aim. Overlays live on their own canvas, never in the frames.
  const aimable = new Map<string, boolean>(); // library effect id -> takes an angle (its options list one, or it is "directional")
  let aimLive: { id: string; deg: number } | null = null;
  const imgOf = (k: string) => imgs.get(k) ?? null;
  const selectedFx = () => {
    const f = selected ? tl().fx.find((x) => x.id === selected) : undefined;
    const a = f && p.kit.assets[f.fx];
    const ref = a && a.source === "pixelfx" ? a.ref : undefined;
    if (!f || !ref) return null;
    if (!aimable.has(ref)) {
      aimable.set(ref, false);
      loadFx(ref).then((m) => (aimable.set(ref, "angle" in (m.meta.options ?? {}) || (m.meta.tags ?? []).includes("directional")), drawOverlay())).catch(() => {});
    }
    return aimable.get(ref) ? f : null;
  };
  function drawOverlay() {
    const o = over.getContext("2d")!;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, W, H);
    if (view) o.setTransform(view.P, 0, 0, view.P, W / 2 - view.cx * view.P, H / 2 - view.cy * view.P); // overlays sit on the zoomed picture
    const T = tl();
    const cam = camNow(T, t);
    const found = selected ? find(T, selected) : null;
    const ground = groundAt(T, t);
    if (cam && ground !== undefined && !playing) {
      // the ground guide: where feet stand on this background
      o.fillStyle = "rgba(120, 220, 255, 0.7)";
      for (let x = 0; x < W; x += 6) o.fillRect(x, ground - cam.y, 3, 1 / (view?.P ?? 1));
    }
    if (!cam || !found || playing) return;
    o.fillStyle = o.strokeStyle = "#f5b94a";
    o.lineWidth = 1 / (view?.P ?? 1);
    if (found.kind === "shot" && found.e.type === "wide") {
      // the camera's path: where the middle of the frame goes, key by key (a drag on the picture sets the key at the playhead)
      const pts = (found.e.camera as CamKey[]).map((k) => ({ x: Math.round(k.x - cam.x + W / 2), y: Math.round(k.y - cam.y + H / 2), now: Math.abs(k.t - snap(t)) < 1e-6 }));
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]], n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        for (let j = 0; j <= n; j += 3) o.fillRect(Math.round(a.x + ((b.x - a.x) * j) / (n || 1)), Math.round(a.y + ((b.y - a.y) * j) / (n || 1)), 1, 1);
      }
      for (const q of pts) q.now ? o.fillRect(q.x - 2, q.y - 2, 5, 5) : o.strokeRect(q.x - 1.5, q.y - 1.5, 4, 4);
      o.strokeRect(W / 2 - 3.5, H / 2 + 0.5, 8, 0); // the frame's middle now
      o.strokeRect(W / 2 + 0.5, H / 2 - 3.5, 0, 8);
    }
    // a box around everything selected that is on screen: what a drag on the preview moves
    const boxes = new Map<string, NonNullable<ReturnType<typeof selBox>>>();
    for (const id of group()) {
      const b = selBox(T, p.kit, imgOf, t, id);
      if (b) boxes.set(b.id, b);
    }
    for (const b of boxes.values()) {
      const [x, y, w, h] = [b.x - 2, b.y - 2, b.w + 3, b.h + 3];
      o.strokeRect(x + 0.5, y + 0.5, w, h);
      const k = Math.min(4, Math.floor(Math.min(w, h) / 3)); // corner ticks: reads as a selection, not a sprite edge
      for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
        o.fillRect(sx > 0 ? cx : cx - k + 1, cy, k, 1);
        o.fillRect(cx, sy > 0 ? cy : cy - k + 1, 1, k);
      }
    }
    const actor = found.kind === "actor" ? (found.e as Actor) : found.kind === "action" ? (found.actor as Actor) : null;
    if (actor) {
      for (const w of walks(T, p.kit, imgOf, actor)) {
        const [x0, y0, x1, y1] = [w.from[0] - cam.x, w.from[1] - cam.y, w.to[0] - cam.x, w.to[1] - cam.y];
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let i = 0; i <= n; i += 3) o.fillRect(Math.round(x0 + ((x1 - x0) * i) / (n || 1)), Math.round(y0 + ((y1 - y0) * i) / (n || 1)), 1, 1);
        o.setLineDash([2, 2]);
        o.strokeRect(w.box.x - cam.x + 0.5, w.box.y - cam.y + 0.5, Math.max(w.box.w - 1, 1), Math.max(w.box.h - 1, 1));
        o.setLineDash([]);
      }
    }
    const f = selectedFx();
    if (f) {
      const h = aimHandle(f, cam, aimLive?.id === f.id ? aimLive.deg : f.angle ?? 0);
      const r = Math.max(2, 4 * perScreenPx()); // about 8 screen px across, whatever the preview size
      o.fillRect(h.x - r, h.y - r, 2 * r, 2 * r);
    }
  }

  // Pointer down picks (or grabs the aim handle / a walk's ghost). A drag shows live without touching the undo
  // stack or saving; pointer up commits once. An aim drag re-bakes the effect once, at the end.
  canvas.onpointerdown = (e) => {
    const T0 = tl();
    const cam = camNow(T0, t);
    if (e.button !== 0 || !cam || playing) return;
    canvas.focus();
    const v0 = view; // a drag keeps the view it started in (a zoom that follows the dragged actor would chase it)
    const c = canvasPt(e, v0);
    const f = selectedFx();
    let target: Target | null = null;
    let aim = false;
    const hd = f ? aimHandle(f, cam, f.angle ?? 0) : null;
    if (f && hd && onAimHandle(c, hd, perScreenPx(v0))) aim = true;
    else {
      const sel = selected ? find(T0, selected) : null;
      const actor = sel?.kind === "actor" ? (sel.e as Actor) : sel?.kind === "action" ? (sel.actor as Actor) : null;
      const ghost = actor ? ghostAt(walks(T0, p.kit, imgOf, actor), cam, c.x, c.y) : null;
      if (ghost) {
        target = { id: ghost, key: "to" };
        commit({ tl: T0 }, ghost);
      } else {
        const hit = hitTest(T0, p.kit, imgOf, t, c.x, c.y);
        if (!hit && sel?.kind === "shot" && sel.e.id === shotAt(T0, t).id) return panCamera(e, T0, cam, c, v0); // the shot is selected: the drag moves its camera
        commit({ tl: T0 }, hit);
        if (hit) target = dragTarget(T0, hit, t);
      }
    }
    if (!target && !aim) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    const end = () => ((dragging = false), (canvas.onpointermove = canvas.onpointerup = canvas.onpointercancel = null));
    canvas.onpointermove = (m) => {
      const q = canvasPt(m, v0);
      if (aim) aimLive = { id: f!.id, deg: aimAngle(f!, cam, q.x, q.y) };
      else p.tl = moveBy(T0, target!, q.x - c.x, q.y - c.y, groundAt(T0, t)).tl; // live only: no history, no save
      paint();
    };
    canvas.onpointercancel = () => {
      end();
      p.tl = T0;
      aimLive = null;
      paint();
    };
    canvas.onpointerup = (u) => {
      end();
      const q = canvasPt(u, v0);
      p.tl = T0;
      aimLive = null;
      if (aim) {
        const id = f!.id, deg = aimAngle(f!, cam, q.x, q.y);
        if (deg === (f!.angle ?? 0)) return paint();
        return aimTo(id, deg);
      }
      const r = moveBy(T0, target!, q.x - c.x, q.y - c.y, groundAt(T0, t));
      if (r.error) return void (toast(r.error, "error"), draw());
      if (JSON.stringify(r.tl) === JSON.stringify(T0)) return paint(); // a click: it only selected
      commit(r);
    };
  };

  // Dragging the picture of a selected wide shot sets its camera key at the playhead (the picture follows the pointer).
  function panCamera(e: PointerEvent, T0: Timeline, cam: { x: number; y: number }, c: { x: number; y: number }, v0: typeof view) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    const at = (m: PointerEvent) => {
      const q = canvasPt(m, v0);
      return camKeyAt(T0, t, cam.x - (q.x - c.x), cam.y - (q.y - c.y));
    };
    const end = () => ((dragging = false), (canvas.onpointermove = canvas.onpointerup = canvas.onpointercancel = null));
    canvas.onpointermove = (m) => ((p.tl = at(m).tl), paint());
    canvas.onpointercancel = () => (end(), (p.tl = T0), paint());
    canvas.onpointerup = (u) => {
      end();
      const r = at(u);
      p.tl = T0;
      if (r.error) return void (toast(r.error, "error"), draw());
      if (JSON.stringify(r.tl) === JSON.stringify(T0)) return paint();
      commit(r, r.id);
    };
  }

  // ---- keys (dropped once this page is gone)
  const keys = new AbortController();
  document.addEventListener(
    "keydown",
    (e) => {
      if (!canvas.isConnected) return keys.abort();
      if (dragging) return;
      const tgt = e.target as HTMLElement;
      if (tgt.closest("input, select, textarea, dialog, .move-menu") || document.querySelector("dialog[open]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const nudge = !mod && document.activeElement === canvas ? nudgeTarget(tl(), selected, t) : null; // preview focused + something movable selected
      if (mod && e.key.toLowerCase() === "z") travel(e.shiftKey ? hist.redo(tl()) : hist.undo(tl()));
      else if (mod && e.key.toLowerCase() === "y") travel(hist.redo(tl()));
      else if (mod && e.key.toLowerCase() === "c" && selected) copySel();
      else if (mod && e.key.toLowerCase() === "v" && clipboard) pasteHere();
      else if (e.key === " ") {
        tgt.blur?.(); // keep a focused button from also taking the press
        playing ? pause() : play();
      } else if (e.key === "Escape" && selected) {
        selected = null;
        multi.clear();
        (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>(".clip")?.blur(); // a redraw would refocus it, and focus selects
        draw();
      } else if (e.altKey && selected && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const ids = group().filter((id) => { const at = find(tl(), id); return !!at && at.kind !== "shot" && at.kind !== "root"; });
        if (!ids.length || refuseRows(ids.map(rowOf))) return;
        const step = (e.shiftKey ? 1 : 1 / FPS) * (e.key === "ArrowLeft" ? -1 : 1);
        commit(moveMany(tl(), ids, step), ids);
      } else if (e.key === "?") showKeys();
      else if (nudge && ARROWS[e.key]) {
        const [dx, dy] = ARROWS[e.key];
        const k = e.shiftKey ? 8 : 1;
        commit(moveBy(tl(), nudge, dx * k, dy * k));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const step = (e.shiftKey ? 1 / FPS : 1) * (e.key === "ArrowLeft" ? -1 : 1);
        seek(snap(t + step));
      } else if (e.key === "Home" || e.key === "End") seek(e.key === "Home" ? 0 : tl().duration);
      else if ((e.key === "[" || e.key === "]") && selected && tl().shots.some((x) => x.id === selected)) { // a shot: move its cut
        const S = tl().shots, i = S.findIndex((x) => x.id === selected), j = e.key === "[" ? i - 1 : i + 1;
        if (S[j]) commit(e.key === "[" ? moveShotEdge(tl(), S[j].id, selected, t) : moveShotEdge(tl(), selected, S[j].id, t));
      } else if (e.key === "[" && selected) commit(trimStart(tl(), selected, t)); // the bar starts here, its end stays
      else if (e.key === "]" && selected) { // the bar ends here
        const at = find(tl(), selected);
        const t0 = at && "t" in at.e ? Number(at.e.t) : NaN;
        if (t > t0) commit(resizeEntry(tl(), selected, t - t0));
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) delSel();
      else return;
      e.preventDefault();
    },
    { signal: keys.signal },
  );

  const KEYS: [string, string][] = [
    ["Space", "Play / pause"],
    ["← →", "Move the playhead 1 s (Shift: one frame)"],
    ["Home / End", "Jump to the start / end"],
    ["Tab", "Go through the bars; the focused bar is selected"],
    ["Alt + ← →", "Move the selected bar one frame (Shift: 1 s)"],
    ["[ / ]", "Start / end the selected bar at the playhead (on a shot: move its cut)"],
    ["Delete", "Remove the selected bars"],
    ["Shift + click / Ctrl + click", "Add a bar to the selection (or take it out); drag one to move them all"],
    ["Alt + drag", "Drag a copy of the selected bars"],
    ["Right-click a bar", "Copy, paste, give a move to everyone, lock its row, delete"],
    ["Ctrl + C / Ctrl + V", "Copy the selected bars, paste them at the playhead"],
    ["Ctrl + Z / Ctrl + Shift + Z", "Undo / redo"],
    ["Ctrl + wheel", "Zoom the timeline"],
    ["Arrows on the preview", "Nudge the selected actor or effect (Shift: 8 px)"],
    ["Esc", "Clear the selection"],
  ];
  function showKeys() {
    const d = Object.assign(document.createElement("dialog"), { className: "dialog keys" });
    d.setAttribute("aria-label", "Keyboard shortcuts");
    d.innerHTML = `<h2>Keyboard shortcuts</h2><dl>${KEYS.map(([k, v]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <div class="row end"><button class="btn primary" type="button">Close</button></div>`;
    document.body.append(d);
    d.querySelector("button")!.onclick = () => d.close();
    d.onclose = () => (d.remove(), $<HTMLButtonElement>("[data-act=keys]").focus());
    d.showModal();
  }
  $<HTMLButtonElement>("[data-act=keys]").onclick = showKeys;

  // ---- tracks
  // timeline zoom: the lanes are `zoom` times the strip's width and scroll sideways; the names stay pinned
  let zoom = 1;
  const setZoom = (z: number, anchorX?: number) => {
    z = Math.min(16, Math.max(1, Math.round(z * 100) / 100));
    if (z === zoom) return;
    const box = tracks.getBoundingClientRect(), label = LABEL_W;
    // keep the time under anchorX (or the playhead) where it is on screen
    const ax = anchorX ?? Math.min(box.width, Math.max(label, label + (tracks.scrollWidth - label) * (t / tl().duration) - tracks.scrollLeft));
    const frac = (tracks.scrollLeft + ax - label) / (tracks.scrollWidth - label);
    zoom = z;
    tracks.style.setProperty("--z", String(z));
    drawTracks();
    tracks.scrollLeft = frac * (tracks.scrollWidth - label) - (ax - label);
    $<HTMLButtonElement>("[data-act=zoom-out]").disabled = z <= 1;
    $<HTMLButtonElement>("[data-act=zoom-in]").disabled = z >= 16;
  };
  $<HTMLButtonElement>("[data-act=zoom-in]").onclick = () => setZoom(zoom * 1.5);
  $<HTMLButtonElement>("[data-act=zoom-out]").onclick = () => setZoom(zoom / 1.5);
  $<HTMLButtonElement>("[data-act=zoom-out]").disabled = true;
  tracks.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX - tracks.getBoundingClientRect().left);
  }, { passive: false });

  function bar(id: string, label: string, start: number, dur: number | undefined, opts: { grip?: boolean; warn?: boolean; locked?: boolean; cls?: string; lane?: number; tip?: string }) {
    const D = tl().duration;
    const cls = ["clip", opts.cls ?? "", isSel(id) ? "sel" : "", opts.warn ? "warn" : "", opts.locked ? "locked" : "", rowLocked(rowOf(id)) ? "row-locked" : ""].join(" ");
    const w = dur ? `width:${pct(dur / D)}` : "";
    const end = dur ? `to ${(start + dur).toFixed(1)} s` : "";
    const name = `${labelOf(tl(), p.kit, id)}, ${start.toFixed(1)} s ${end}`.trim();
    return `<div class="${cls}" data-id="${esc(id)}" role="button" tabindex="0" aria-pressed="${isSel(id)}" aria-label="${esc(name)}" style="left:${pct(start / D)};${w};--k:${opts.lane ?? 0}" title="${esc(opts.tip ?? labelOf(tl(), p.kit, id))}">
      <span>${esc(label)}</span>${opts.grip ? `<i class="grip" aria-hidden="true"></i>` : ""}</div>`;
  }
  function drawTracks() {
    const T = tl();
    const D = T.duration;
    const warn = new Set(missingReport(T, p.kit, false, has).map((m) => m.used_by));
    const ticks = Array.from({ length: Math.ceil(D) }, (_, s) => `<span class="tick" style="left:${pct(s / D)}">${s}</span>`).join("");
    const shots = T.shots.map((s) => bar(s.id, shotName(T, s.id), s.start, s.end - s.start, { cls: "shot", warn: warn.has(s.id), locked: s.locked })).join("")
      + T.shots.slice(0, -1).map((s, i) => `<i class="edge" data-a="${esc(s.id)}" data-b="${esc(T.shots[i + 1].id)}" style="left:${pct(s.end / D)}" title="Drag to move the cut"></i>`).join("");
    const lock = (r: string, name: string) => `<button class="row-lock" type="button" data-lock="${esc(r)}" aria-pressed="${rowLocked(r)}" aria-label="Lock the ${esc(name)} row" title="${rowLocked(r) ? "Unlock this row" : "Lock this row: its bars can't be moved or deleted"}">${rowLocked(r) ? "🔒" : "🔓"}</button>`;
    const row = (label: string, lane: string, attrs = "", sel = false, cls = "", n = 1, cat?: Cat) =>
      `<div class="track ${cls}"${cat ? ` data-cat="${cat}"` : ""}${n > 1 ? ` style="min-height:${4 + n * 26}px"` : ""}><div class="track-label${sel ? " sel" : ""}" ${attrs}>${label}</div><div class="lane" ${attrs}>${lane}</div></div>`;
    // bars that overlap stack in lanes; a short bar counts as 44 px wide so its label shows
    const minS = (D * 44) / Math.max(200, (tracks.clientWidth - LABEL_W) * zoom);
    const stack = (items: { t: number; len?: number }[]) => {
      const k = lanes(items, minS);
      return { k, n: Math.max(1, ...k.map((x) => x + 1)) };
    };
    const frames = charFrames(p.kit, imgOf, false, has); // bars without a "dur" are as long as what plays
    const actors = T.actors.map((a) => {
      const spans = a.actions.map((x) => ({ t: x.t, len: actionSpan(x, a.char, frames) }));
      const { k, n } = stack(spans);
      return row(
        `<span class="who">${esc(actorName(T, a.id))}</span>${lock(a.id, actorName(T, a.id))}<button class="row-add" type="button" data-add="${esc(a.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="Add a move for ${esc(actorName(T, a.id))}" title="Add a move at the playhead">+</button>`,
        a.actions.map((x, i) => bar(x.id, x.do === "say" ? `“${x.text ?? ""}”` : moveLabel(x.do), x.t, spans[i].len, {
          grip: x.dur !== undefined, warn: warn.has(x.id), locked: x.locked, lane: k[i],
          // Stand up is a moment, not a stretch: a tag; faded when the actor is already standing
          cls: x.do === "idle" ? `mark${downAt(a, x.t - 1e-6, frames) ? "" : " noop"}` : undefined,
          tip: x.do === "idle" && !downAt(a, x.t - 1e-6, frames) ? "Does nothing here: the actor is already standing. Stand up gets an actor back up after a fall, a kneel or a death." : undefined,
        })).join(""),
        `data-actor="${esc(a.id)}" title="Double-click the lane to add an action"`,
        a.id === selected, "", n, catOfTrack("actor"),
      );
    }).join("");
    const fxSpans = T.fx.map((f) => {
      const meta = p.kit.assets[f.fx]?.fx;
      return { t: f.t, len: meta ? fxEnd(f, meta, D) - f.t : f.dur }; // the bar covers exactly what plays
    });
    const fxLanes = stack(fxSpans);
    const fx = T.fx.map((f, i) => bar(f.id, fxName(p.kit, f.fx), f.t, fxSpans[i].len, { grip: true, warn: warn.has(f.id), locked: f.locked, cls: "fx", lane: fxLanes.k[i] })).join("");
    const auSpans = T.audio.map((s) => ({ t: s.t, len: bufs.get(s.clip)?.duration }));
    const auLanes = stack(auSpans);
    const audio = T.audio.map((s, i) => bar(s.id, s.line ? `${s.clip} “${s.line}”` : s.clip, s.t, auSpans[i].len, { warn: warn.has(s.id), locked: s.locked, cls: s.kind, lane: auLanes.k[i] })).join("");
    const time = (T.time ?? []).map((w) => bar(w.id, timeName(w), w.t, w.dur, { grip: true, locked: w.locked, cls: "time" })).join("");
    const focused = (document.activeElement as HTMLElement | null)?.closest?.(".clip")?.getAttribute("data-id");
    tracks.innerHTML = `
      ${row("", ticks, `data-ruler="1" title="Click or drag to move the playhead"`, false, "ruler")}
      ${row("Shots", shots, "", false, "", 1, catOfTrack("shots"))}
      ${time ? row(`<span title="Slow motion, held frames and hit-stops: what time of the scene is on screen">Time</span>`, time, "", false, "", 1, catOfTrack("shots")) : ""}
      ${actors || row(`<span class="small">No actors</span>`, `<span class="lane-hint">Drag a character in from Cast on the left</span>`)}
      ${row(`<span>Effects</span>${lock("fx", "Effects")}`, fx, "", false, "", fxLanes.n, catOfTrack("fx"))}
      ${row(`<span>Audio</span>${lock("audio", "Audio")}`, audio, "", false, "", auLanes.n, catOfTrack("sfx"))}
      <div class="playhead" aria-hidden="true"></div>`;
    tracks.style.setProperty("--p", String(t / D));
    // a redraw replaces the bars: keep keyboard focus on the same one
    if (focused) tracks.querySelector<HTMLElement>(`.clip[data-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  // One pointer handler for the whole track area: seek on the ruler, move bars, drag grips and cuts.
  let lastDown = { at: 0, actor: "" }; // two presses on an empty actor lane = double-click
  tracks.ondragover = (e) => isItemDrag(e) && e.preventDefault();
  tracks.ondrop = (e) => {
    const it = droppedItem(e);
    if (!it) return;
    e.preventDefault();
    const lane = (e.target as HTMLElement).closest<HTMLElement>(".lane");
    if (!lane || lane.dataset.ruler) return;
    const box = lane.getBoundingClientRect();
    const D = tl().duration;
    add(it, { t: Math.min(Math.max(((e.clientX - box.left) / box.width) * D, 0), D) });
  };
  tracks.onpointerdown = (e) => {
    const el = e.target as HTMLElement;
    if (el.closest("[data-add], [data-lock]")) return; // the + and the padlock act on click; a redraw now would eat the click
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
    const fxMeta = it?.kind === "fx" ? p.kit.assets[it.e.fx as string]?.fx : undefined;
    const startDur = fxMeta ? fxEnd(it!.e as { t: number; dur?: number }, fxMeta, D) - startT : ((it?.e.dur as number | undefined) ?? 0.5); // the length the bar shows
    const pick = e.shiftKey || e.ctrlKey || e.metaKey; // add to / take out of the selection, no drag
    const copying = e.altKey && !grip && !edge; // Alt+drag: a copy goes where you drop
    // dragging a selected bar drags every selected bar; any other bar drags alone
    const ids = !edge && !grip && it && isSel(id) && group().length > 1 ? group().filter((x) => { const f = find(tl(), x); return !!f && f.kind !== "shot"; }) : id ? [id] : [];
    const starts = new Map(ids.map((x) => [x, Number(find(tl(), x)?.e.t ?? 0)]));
    const locked = !copying && ids.some((x) => rowLocked(rowOf(x)));
    const draggable = !pick && !locked && (edge || (it && it.kind !== "shot"));
    let moved = false;
    tracks.onpointermove = (m) => {
      const dx = m.clientX - x0;
      if (!draggable || (!moved && Math.abs(dx) < 3)) return;
      moved = true;
      tracks.classList.toggle("copying", copying);
      if (edge) edge.style.left = pct(Math.min(Math.max(at(m.clientX) / D, 0), 1));
      else if (grip) b!.style.width = pct(Math.max(snap(startDur + sec(dx)), 1 / FPS) / D);
      else
        for (const [x, s0] of starts) {
          const el2 = tracks.querySelector<HTMLElement>(`.clip[data-id="${CSS.escape(x)}"]`);
          if (el2) el2.style.left = pct(Math.min(Math.max(snap(s0 + sec(dx)), 0), D) / D);
        }
    };
    tracks.onpointercancel = () => {
      tracks.onpointermove = tracks.onpointerup = tracks.onpointercancel = null;
      draw(); // put the dragged bar back
    };
    tracks.onpointerup = (u) => {
      tracks.onpointermove = tracks.onpointerup = tracks.onpointercancel = null;
      tracks.classList.remove("copying");
      const dx = u.clientX - x0;
      if (!moved) {
        if (!id) return;
        if (locked && !pick && it && it.kind !== "shot" && Math.abs(dx) >= 3) refuseRows(ids.map(rowOf)); // tried to drag a locked row
        if (!pick) return commit({ tl: tl() }, id);
        if (isSel(id)) { // take it out
          if (id === selected) selected = [...multi][0] ?? null;
          multi.delete(id);
          if (selected) multi.delete(selected);
        } else if (selected) multi.add(id);
        else selected = id;
        return draw();
      }
      if (edge) commit(moveShotEdge(tl(), edge.dataset.a!, edge.dataset.b!, at(u.clientX)));
      else if (grip) commit(resizeEntry(tl(), id, startDur + sec(dx)), id);
      else if (copying) {
        const r = pasteMany(tl(), copyMany(tl(), ids), Math.min(...starts.values()) + sec(dx));
        commit(r, r.error ? undefined : r.ids);
      } else if (ids.length > 1) commit(moveMany(tl(), ids, sec(dx)), ids);
      else commit(moveEntry(tl(), id, startT + sec(dx)), id);
    };
  };
  // a bar reached by Tab is selected, as a click would
  tracks.addEventListener("focusin", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".clip");
    if (b?.dataset.id && !isSel(b.dataset.id)) commit({ tl: tl() }, b.dataset.id);
  });
  // ---- right-click on a bar
  tracks.oncontextmenu = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".clip");
    const id = b?.dataset.id;
    if (!b || !id) return;
    e.preventDefault();
    if (!isSel(id)) commit({ tl: tl() }, id);
    const at = find(tl(), id);
    const ids = group();
    const row = rowOf(id);
    const bar = tracks.querySelector<HTMLElement>(`.clip[data-id="${CSS.escape(id)}"]`) ?? b;
    const items: [string, () => void][] = [];
    if (at && at.kind !== "shot") items.push([ids.length > 1 ? `Copy ${ids.length} bars` : "Copy", copySel]);
    if (clipboard) items.push(["Paste at the playhead", pasteHere]);
    if (at && at.kind !== "shot") items.push(["Duplicate at the playhead", () => { const r = pasteMany(tl(), copyMany(tl(), ids), t); commit(r, r.error ? undefined : r.ids); }]);
    if (at?.kind === "action" && ids.length === 1 && tl().actors.length > 1)
      items.push(["Give this move to the other actors", () => { const r = applyToOthers(tl(), id); commit(r, r.error ? undefined : [id, ...r.ids]); }]);
    if (row) items.push([rowLocked(row) ? "Unlock this row" : "Lock this row", () => toggleRow(row)]);
    items.push([ids.length > 1 ? `Delete ${ids.length} bars` : "Delete", delSel]);
    popMenu(bar, "Bar menu", items, { x: e.clientX, y: e.clientY });
  };
  function copySel() {
    const c = copyMany(tl(), group());
    if (!c.length) return;
    clipboard = c;
    toast(c.length > 1 ? `Copied ${c.length} bars. Ctrl+V pastes them at the playhead, spaced as they were.` : "Copied. Select an actor (or one of its moves) and press Ctrl+V to paste at the playhead.");
  }
  function pasteHere() {
    if (!clipboard) return;
    const at = selected ? find(tl(), selected) : null;
    const actor = at?.kind === "actor" ? (at.e.id as string) : at?.kind === "action" ? (at.actor.id as string) : undefined;
    const one = new Set(clipboard.filter((c) => c.kind === "action").map((c) => c.actor)).size === 1;
    if (refuseRows(clipboard.map((c) => (c.kind === "action" ? (one && actor) || c.actor || null : c.kind)))) return;
    const r = pasteMany(tl(), clipboard, t, actor);
    commit(r, r.error ? undefined : r.ids);
  }
  function delSel() {
    const ids = group();
    if (!ids.length || refuseRows(ids.map(rowOf))) return;
    commit(ids.length > 1 ? deleteMany(tl(), ids) : deleteEntry(tl(), ids[0]), null);
  }
  function toggleRow(row: string) {
    const L = new Set(p.lockedRows ?? []);
    if (L.has(row)) L.delete(row);
    else L.add(row);
    p.lockedRows = [...L];
    changed();
    draw();
  }
  // ---- the + on an actor's row: a small menu of moves, each added at the playhead
  tracks.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-add]");
    if (b) openMoveMenu(b, b.dataset.add!);
    const l = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-lock]");
    if (l) toggleRow(l.dataset.lock!);
  };
  function openMoveMenu(anchor: HTMLElement, actorId: string) {
    document.querySelector(".move-menu")?.remove();
    const a = tl().actors.find((x) => x.id === actorId);
    if (!a) return;
    const own = Object.keys(p.kit.chars[a.char]?.anims ?? {}).filter((n) => n !== "idle" && n !== "walk" && n !== "hurt" && animStatus(p.kit, a.char, n, false, has) === "ok");
    // Attack and Breathe fire are always offered (the kit has no creature flag); picking one before it exists lands it in Needs approval
    const frames = charFrames(p.kit, imgOf, false, has);
    // Stand up only when there is something to get up from
    const items = [...(downAt(a, t, frames) ? ["idle"] : []), ...ACTIONS_MENU, "anim:attack", "anim:breathe", ...own.filter((n) => n !== "attack" && n !== "breathe").map((n) => `anim:${n}`)];
    const menu = Object.assign(document.createElement("div"), { className: "move-menu", role: "menu" });
    menu.setAttribute("aria-label", `Moves for ${actorName(tl(), actorId)}`);
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${r.right + 4}px`;
    menu.style.top = `${Math.max(4, Math.min(r.top, innerHeight - 24 * items.length - 12))}px`;
    const close = () => (menu.remove(), document.removeEventListener("pointerdown", away, true), anchor.setAttribute("aria-expanded", "false"), refocus());
    const refocus = () => tracks.querySelector<HTMLElement>(`[data-add="${CSS.escape(actorId)}"]`)?.focus();
    const away = (e: Event) => menu.contains(e.target as Node) || (menu.remove(), document.removeEventListener("pointerdown", away, true), anchor.setAttribute("aria-expanded", "false"));
    anchor.setAttribute("aria-expanded", "true");
    for (const doId of items) {
      const it = Object.assign(document.createElement("button"), { type: "button", role: "menuitem", textContent: moveLabel(doId) });
      it.onclick = () => {
        close(); // also puts focus back on the + (the row redraws, so find it again below)
        if (dragging) return;
        queue = queue
          .then(async () => {
            const res = await addMove(p, tl(), actorId, doId, snap(t), imgOf);
            commit(res, res.id);
            refocus(); // the row was redrawn by the commit
            await loadImgs();
          })
          .catch((err: Error) => void toast(`Could not add that: ${err.message}`, "error"));
      };
      menu.append(it);
    }
    menu.onkeydown = (e) => {
      const btns = [...menu.querySelectorAll<HTMLButtonElement>("button")];
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") close();
      else if (e.key === "ArrowDown") btns[(i + 1) % btns.length].focus();
      else if (e.key === "ArrowUp") btns[(i - 1 + btns.length) % btns.length].focus();
      else if (e.key === "Tab") close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.body.append(menu);
    menu.style.top = `${Math.max(4, Math.min(parseFloat(menu.style.top), innerHeight - menu.offsetHeight - 8))}px`; // measured: keep the last item on screen
    document.addEventListener("pointerdown", away, true);
    menu.querySelector("button")!.focus();
  }
  /** A small menu under anchor; Escape, Tab or a click outside closes it and focus goes back to anchor. */
  function popMenu(anchor: HTMLElement, label: string, items: [string, () => void][], point?: { x: number; y: number }) {
    document.querySelector(".move-menu")?.remove();
    const menu = Object.assign(document.createElement("div"), { className: "move-menu", role: "menu" });
    menu.setAttribute("aria-label", label);
    const r = anchor.getBoundingClientRect();
    if (point) { // a right-click: at the pointer
      menu.style.left = `${Math.min(point.x, innerWidth - 260)}px`;
      menu.style.top = `${point.y}px`;
    } else {
      menu.style.left = `${Math.min(r.left, innerWidth - 240)}px`;
      menu.style.bottom = `${innerHeight - r.top + 4}px`; // opens upwards: the timeline is below the button
      menu.style.maxHeight = `${r.top - 12}px`;
    }
    menu.style.overflowY = "auto";
    const shut = () => (menu.remove(), document.removeEventListener("pointerdown", away, true), anchor.setAttribute("aria-expanded", "false"));
    const close = () => (shut(), anchor.isConnected ? anchor.focus() : tracks.querySelector<HTMLElement>(".clip.sel")?.focus({ preventScroll: true }));
    const away = (e: Event) => menu.contains(e.target as Node) || shut();
    anchor.setAttribute("aria-expanded", "true");
    for (const [text, run] of items) {
      const it = Object.assign(document.createElement("button"), { type: "button", role: "menuitem", textContent: text });
      it.onclick = () => (close(), dragging || run());
      menu.append(it);
    }
    menu.onkeydown = (e) => {
      const btns = [...menu.querySelectorAll<HTMLButtonElement>("button")];
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape" || e.key === "Tab") close();
      else if (e.key === "ArrowDown") btns[(i + 1) % btns.length].focus();
      else if (e.key === "ArrowUp") btns[(i - 1 + btns.length) % btns.length].focus();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.body.append(menu);
    menu.style.top = `${Math.max(4, Math.min(parseFloat(menu.style.top), innerHeight - menu.offsetHeight - 8))}px`; // measured: keep the last item on screen
    document.addEventListener("pointerdown", away, true);
    menu.querySelector("button")!.focus();
  }
  // Changing an existing action's move (inspector, Needs approval): Breathe fire brings its flame, as from the + menu.
  const moveTo = (actionId: string, doId: string) => {
    if (dragging) return draw();
    queue = queue
      .then(async () => {
        commit(await changeMove(p, tl(), actionId, doId, imgOf), actionId);
        await loadImgs();
      })
      .catch((err: Error) => void toast(`Could not change that: ${err.message}`, "error"));
  };
  // a flame (or any library effect that takes it) re-baked to carry further; one undo step
  const aimTo = (fxId: string, deg: number) => {
    queue = queue
      .then(async () => {
        toast("Aiming…");
        await new Promise((r) => setTimeout(r, 30)); // let the toast paint before the bake blocks the page
        commit(await rebakeFx(p, tl(), fxId, deg), fxId);
        await loadImgs();
      })
      .catch((err: Error) => void toast(`Could not aim that: ${err.message}`, "error"));
  };
  const reachTo = (fxId: string, reach: number) => {
    queue = queue
      .then(async () => {
        const f = tl().fx.find((x) => x.id === fxId);
        if (!f) return;
        toast("Stretching…");
        await new Promise((r) => setTimeout(r, 30)); // let the toast paint before the bake blocks the page
        commit(await rebakeFx(p, tl(), fxId, f.angle ?? 0, undefined, reach), fxId);
        await loadImgs();
      })
      .catch((err: Error) => void toast(`Could not change the reach: ${err.message}`, "error"));
  };
  function draw() {
    const T = tl();
    drawTracks();
    drawDrawer();
    const errs = validateTimeline(T);
    const kitChanged = () => (changed(), loadImgs().then(draw), void clipLengths());
    renderInspector($(".inspector"), T, selected, { kit: p.kit, project: p, now: () => t, errors: errs, kitChanged, move: moveTo, reach: reachTo, aim: aimTo }, (r, sel) => commit(r, sel), (id) => commit(deleteEntry(tl(), id), null));
    renderApprovals($(".needs-box"), p, (r) => commit(r), kitChanged, moveTo);
    drawFraming();
    drawGuide();
    drawStatus();
    $<HTMLButtonElement>("[data-act=undo]").disabled = !hist.canUndo;
    $<HTMLButtonElement>("[data-act=redo]").disabled = !hist.canRedo;
    paint();
  }

  // Getting started: three steps that tick as they are done, until "Got it" (remembered in this browser).
  function drawGuide() {
    const box = $(".guide-box");
    let gone = false;
    try { gone = localStorage.getItem("pc.guide") === "done"; } catch { /* private window: show it */ }
    box.hidden = gone;
    if (gone) return;
    const T = tl();
    const steps: [boolean, string][] = [
      [T.actors.length > 0, "Drag a character from the left onto the picture (or click it)."],
      [T.actors.some((a) => a.actions.length > 0), "Click + beside its name to give it something to do."],
      [played, "Press Space to watch it, then Next: Export."],
    ];
    box.innerHTML = `<div class="need-head"><h2>Getting started</h2><button class="btn quiet" type="button">Got it</button></div><ol></ol>`;
    box.querySelector("ol")!.append(...steps.map(([done, text]) => Object.assign(document.createElement("li"), { className: done ? "done" : "", textContent: text })));
    box.querySelector("button")!.onclick = () => {
      try { localStorage.setItem("pc.guide", "done"); } catch { /* it comes back next time */ }
      box.hidden = true;
    };
  }

  // Black gaps around a background, actors cut by an edge: worth a look, never a block on export.
  function drawFraming() {
    const box = $(".frame-box");
    const T = tl();
    const issues: (FrameIssue & { fix?: [string, () => EditResult | null] })[] = framingIssues(T, p.kit, (k) => imgs.get(k) ?? null, W, H);
    for (const n of sceneNotes(T)) {
      const a = T.actors.find((x) => x.id === n.id);
      const fix: [string, () => EditResult | null] | undefined =
        n.kind === "still" && a ? [`Add a look around for ${actorName(T, a.id)}`, () => addAction(tl(), a.id, { t: snap(n.at + 0.5), do: "look_around", dur: 2 })]
        : n.kind === "long" ? ["Cut it in two", () => splitShot(tl(), n.id, snap(n.at))]
        : n.kind === "talk" && a ? [`Close-up on ${actorName(T, a.id)}`, () => closeUpOn(tl(), a, snap(n.at))]
        : undefined;
      issues.push({ id: n.id, at: n.at, msg: n.msg, fix });
    }
    box.hidden = !issues.length;
    box.innerHTML = `<h2>Check the scene</h2><ul class="needs"></ul>`;
    for (const f of issues) {
      const li = document.createElement("li");
      li.append(Object.assign(document.createElement("span"), { textContent: f.msg }));
      const acts = Object.assign(document.createElement("div"), { className: "row wrap acts" });
      const show = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: "Show" });
      show.onclick = () => ((t = f.at), commit({ tl: tl() }, f.id));
      acts.append(show);
      if (f.fill) {
        const fill = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: "Fill the frame" });
        fill.title = `Set bg scale to ${f.fill}`;
        fill.onclick = () => commit(setField(tl(), f.id, "bg_scale", f.fill), f.id);
        acts.append(fill);
      }
      if (f.fix) {
        const [label, run] = f.fix;
        const b = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: label });
        b.onclick = () => {
          const r = run();
          if (!r) return toast("Move to a wide shot where they are on screen first.", "error");
          t = f.at;
          commit(r, r.id ?? f.id);
        };
        acts.append(b);
      }
      li.append(acts);
      box.querySelector("ul")!.append(li);
    }
  }

  // "Ready to export", or how many pieces wait, linked to the first of them in Needs approval.
  function drawStatus() {
    const box = $("[data-testid=status]");
    const n = missingReport(tl(), p.kit, false, has).length;
    const empty = !tl().actors.length && !tl().shots.some((x) => x.bg);
    box.className = n || empty ? "status muted" : "status ok";
    if (!n) return void (box.textContent = empty ? "Nothing in the scene yet" : "Ready to export");
    const b = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet warn", textContent: `${n} piece${n === 1 ? " needs" : "s need"} you` });
    b.onclick = openApprovals;
    box.replaceChildren(b);
  }

  draw();
  fit();
  loadImgs();
  void clipLengths();
}
