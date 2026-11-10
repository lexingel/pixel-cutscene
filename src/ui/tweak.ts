import { activeAudio } from "../core/audioPlan";
import { framingIssues } from "../core/framing";
import { animStatus, assetStatus, type Img } from "../core/kit";
import { actorName, fxName, labelOf, shotName } from "../core/labels";
import { moveLabel } from "../core/moves";
import { missingReport } from "../core/missing";
import type { Project } from "../core/project";
import { frameZoom, fxEnd, newFxDur, renderFrame } from "../core/render";
import { zoomFrame } from "../core/raster";
import { pose, shotAt } from "../core/acting";
import { charFrames } from "../core/frames";
import { validateTimeline } from "../core/timeline";
import type { Actor, Timeline } from "../core/types";
import { decodeAudio } from "../export/audioMix";
import { loadTracks, useTrack } from "./music";
import { renderDrawer, droppedItem, knownItem, isItemDrag, type DrawerItem, type DropAt } from "./drawer";
import { addLibraryFx, loadFx, rebakeFx } from "../core/fxLibrary";
import { aimAngle, aimHandle, camNow, dragTarget, ghostAt, hitTest, moveBy, nudgeTarget, walks, type Target } from "./stageEdit";
import { readyChars } from "../core/kit";
import { renderApprovals } from "./approvals";
import { addMove, changeMove } from "./addMove";
import { decode } from "./cast";
import { toast } from "./dialogs";
import { renderInspector } from "./inspector";
import { emptyTimeline } from "./scene";
import type { Step } from "./steps";
import {
  FPS, History, addAction, addEntry, deleteEntry, find, moveEntry, moveShotEdge, newId, resizeEntry, setField, snap, splitShot, insertShot, panShot, transition, type EditResult,
} from "./timelineEditor";

const ACTIONS_MENU = ["idle", "walk", "move", "look_around", "startle", "hurt", "dust"];
const pct = (x: number) => `${(x * 100).toFixed(4)}%`;
const ICON_PLAY = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor"/></svg>`;
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
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
    <aside class="drawer" data-testid="drawer" aria-label="Library"></aside>
    <div class="d-resize" role="separator" aria-orientation="vertical" aria-label="Library width" tabindex="0" title="Drag to resize the library"></div>
    <div class="stage"><canvas class="px preview" data-testid="preview" aria-label="Preview" tabindex="0"></canvas><canvas class="px overlay" aria-hidden="true"></canvas></div>
    <div class="transport">
      <button class="btn icon" type="button" data-act="play" aria-label="Play (Space)" title="Play / pause (Space)"></button>
      <span class="timecode" data-testid="timecode" aria-live="off"></span>
      <span class="sep"></span>
      <button class="btn quiet" type="button" data-act="undo" title="Undo (Ctrl+Z)">Undo</button>
      <button class="btn quiet" type="button" data-act="redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
      <span class="grow"></span>
      <button class="btn quiet" type="button" data-act="shot" aria-haspopup="menu" title="Add a shot or a transition at the playhead">+ Shot ▾</button>
      <span class="status" data-testid="status"></span>
      <button class="btn primary" type="button" data-act="next">Next: Export</button>
    </div>
    <div class="tracks" data-testid="tracks"></div>
    <aside class="side"><section class="inspector"></section><section class="frame-box" data-testid="framing" hidden></section><section class="needs-box"></section></aside>
  </div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const canvas = $<HTMLCanvasElement>(".preview");
  const stage = $(".stage");
  const over = $<HTMLCanvasElement>(".overlay");
  const tracks = $(".tracks");
  const playBtn = $<HTMLButtonElement>("[data-act=play]");
  canvas.width = W;
  canvas.height = H;
  over.width = W;
  over.height = H;
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
    try { localStorage.setItem("pc.drawer", String(w)); } catch { /* private window */ }
  };
  try { setDrawer(Number(localStorage.getItem("pc.drawer")) || 220); } catch { setDrawer(220); }
  grip.onpointerdown = (e) => {
    grip.setPointerCapture(e.pointerId);
    const left = $(".drawer").getBoundingClientRect().left;
    grip.onpointermove = (m) => setDrawer(m.clientX - left);
    grip.onpointerup = () => (grip.onpointermove = null);
  };
  grip.onkeydown = (e) => {
    const step = e.key === "ArrowLeft" ? -20 : e.key === "ArrowRight" ? 20 : 0;
    if (step) { e.preventDefault(); e.stopPropagation(); setDrawer($(".drawer").getBoundingClientRect().width + step); }
  };

  const zoomed = new Uint8ClampedArray(W * H * 4); // preview zoom is nearest-neighbour at canvas size (approximate); the export zooms in whole output pixels
  function paint() {
    const T = tl();
    t = Math.min(Math.max(t, 0), T.duration);
    if (T.shots.length) renderFrame({ tl: T, kit: p.kit, img: (k) => imgs.get(k) ?? null, draft: false, W, H }, t, frame);
    else frame.px.fill(0);
    const z = T.shots.length ? frameZoom(T, t) : null;
    if (z) zoomFrame(frame, z.z, z.x, z.y, 1, zoomed);
    g.putImageData(new ImageData(z ? zoomed : frame.px, W, H), 0, 0);
    $("[data-testid=timecode]").innerHTML = `<b>${t.toFixed(2)}</b> / ${T.duration.toFixed(2)} s <span class="muted">· frame ${Math.round(t * FPS)}</span>`;
    tracks.style.setProperty("--p", String(t / T.duration));
    playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute("aria-label", playing ? "Pause (Space)" : "Play (Space)");
    drawOverlay();
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
  // ---- + Shot: cuts, close-ups, pans, zooms and transitions, all at the playhead
  const shotBtn = $<HTMLButtonElement>("[data-act=shot]");
  shotBtn.onclick = () => {
    const T = tl(), at = snap(t), cam = camNow(T, at);
    const frames = charFrames(p.kit, imgOf, false, has);
    const wideOnly = (f: () => EditResult) => () => (cam ? f() : { tl: T, error: "Move the playhead to a wide shot first (close-ups have no camera)." });
    const items: [string, () => EditResult][] = [];
    items.push(["Cut here", () => {
      const s = T.shots.find((x) => at > x.start && at < x.end);
      return s ? splitShot(T, s.id, at) : { tl: T, error: "Move the playhead inside a shot to cut it." };
    }]);
    // a close-up is a zoom on the character, sized so they fill most of the frame's height
    const focusOn = (a: Actor) => {
      const q = pose(a, at, frames);
      if (!q?.img || !cam) return null;
      return { x: q.drawX + q.img.w / 2 - cam.x, y: q.drawY + q.img.h * 0.35 - cam.y, z: Math.max(2, Math.min(4, Math.floor((H * 0.9) / q.img.h))) };
    };
    for (const a of T.actors) {
      const f = focusOn(a);
      if (f) items.push([`Close-up on ${actorName(T, a.id)}`, () => insertShot(T, at, 2, { zoom: { from: f.z, to: f.z, x: Math.round(f.x), y: Math.round(f.y) } })]);
    }
    for (const [face, exprs] of Object.entries(p.kit.faces))
      for (const expr of Object.keys(exprs)) items.push([`Close-up portrait: ${face} · ${expr}`, () => insertShot(T, at, 2, { type: "closeup", face, expr })]);
    const sh = T.shots.length ? shotAt(T, at) : null;
    const bg = sh?.bg ? imgs.get(p.kit.assets[sh.bg]?.path ?? "") : undefined;
    const k = sh?.type === "wide" ? (sh.bg_scale ?? 1) : 1;
    const extra = { x: bg ? bg.w * k - W : 0, y: bg ? bg.h * k - H : 0 };
    for (const d of ["left", "right", "up", "down"] as const) items.push([`Pan ${d}`, wideOnly(() => panShot(T, at, d, extra))]);
    const sel = T.actors.find((a) => a.id === selected);
    const zf = (sel && focusOn(sel)) || { x: W / 2, y: H / 2 };
    const on = sel ? ` on ${actorName(T, sel.id)}` : "";
    items.push([`Zoom in${on}`, wideOnly(() => insertShot(T, at, undefined, { zoom: { from: 1, to: 2, x: Math.round(zf.x), y: Math.round(zf.y) } }))]);
    items.push([`Zoom out${on}`, wideOnly(() => insertShot(T, at, undefined, { zoom: { from: 2, to: 1, x: Math.round(zf.x), y: Math.round(zf.y) } }))]);
    items.push(["Fade in from black", () => transition(T, at, "fade_in")]);
    items.push(["Fade out to black", () => transition(T, at, "fade_out")]);
    items.push(["White flash", () => transition(T, at, "flash")]);
    items.push(["Shake", wideOnly(() => transition(T, at, "shake"))]);
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
      const r = addEntry(tl(), "actors", { char: it.char, x: at.x ?? Math.round(W / 2), y: at.y ?? Math.round(H * 0.8), actions: [], ...(when > 0 ? { appear: when } : {}) }, "actor");
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
  // pointer -> canvas pixels (not rounded); the drop and the stage editing share it
  const canvasPt = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
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
    o.clearRect(0, 0, W, H);
    const T = tl();
    const cam = camNow(T, t);
    const found = selected ? find(T, selected) : null;
    if (!cam || !found || playing) return;
    o.fillStyle = o.strokeStyle = "#f5b94a";
    o.lineWidth = 1;
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
      o.fillRect(h.x - 2, h.y - 2, 4, 4);
    }
  }

  // Pointer down picks (or grabs the aim handle / a walk's ghost). A drag shows live without touching the undo
  // stack or saving; pointer up commits once. An aim drag re-bakes the effect once, at the end.
  canvas.onpointerdown = (e) => {
    const T0 = tl();
    const cam = camNow(T0, t);
    if (e.button !== 0 || !cam || playing) return;
    canvas.focus();
    const c = canvasPt(e);
    const f = selectedFx();
    let target: Target | null = null;
    let aim = false;
    const hd = f ? aimHandle(f, cam, f.angle ?? 0) : null;
    if (f && hd && Math.abs(c.x - hd.x) <= 4 && Math.abs(c.y - hd.y) <= 4) aim = true;
    else {
      const sel = selected ? find(T0, selected) : null;
      const actor = sel?.kind === "actor" ? (sel.e as Actor) : sel?.kind === "action" ? (sel.actor as Actor) : null;
      const ghost = actor ? ghostAt(walks(T0, p.kit, imgOf, actor), cam, c.x, c.y) : null;
      if (ghost) {
        target = { id: ghost, key: "to" };
        commit({ tl: T0 }, ghost);
      } else {
        const hit = hitTest(T0, p.kit, imgOf, t, c.x, c.y);
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
      const q = canvasPt(m);
      if (aim) aimLive = { id: f!.id, deg: aimAngle(f!, cam, q.x, q.y) };
      else p.tl = moveBy(T0, target!, q.x - c.x, q.y - c.y).tl; // live only: no history, no save
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
      const q = canvasPt(u);
      p.tl = T0;
      aimLive = null;
      if (aim) {
        const id = f!.id, deg = aimAngle(f!, cam, q.x, q.y);
        if (deg === (f!.angle ?? 0)) return paint();
        queue = queue
          .then(async () => {
            toast("Aiming…");
            await new Promise((r) => setTimeout(r, 30)); // let the toast paint before the bake blocks the page
            commit(await rebakeFx(p, tl(), id, deg), id);
            await loadImgs();
          })
          .catch((err: Error) => void toast(`Could not aim that: ${err.message}`, "error"));
        return;
      }
      const r = moveBy(T0, target!, q.x - c.x, q.y - c.y);
      if (r.error) return void (toast(r.error, "error"), draw());
      if (JSON.stringify(r.tl) === JSON.stringify(T0)) return paint(); // a click: it only selected
      commit(r);
    };
  };

  // ---- keys (dropped once this page is gone)
  const keys = new AbortController();
  document.addEventListener(
    "keydown",
    (e) => {
      if (!canvas.isConnected) return keys.abort();
      if (dragging) return;
      const tgt = e.target as HTMLElement;
      if (tgt.closest("input, select, textarea, dialog") || document.querySelector("dialog[open]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const nudge = !mod && document.activeElement === canvas ? nudgeTarget(tl(), selected, t) : null; // preview focused + something movable selected
      if (mod && e.key.toLowerCase() === "z") travel(e.shiftKey ? hist.redo(tl()) : hist.undo(tl()));
      else if (mod && e.key.toLowerCase() === "y") travel(hist.redo(tl()));
      else if (e.key === " ") {
        tgt.blur?.(); // keep a focused button from also taking the press
        playing ? pause() : play();
      } else if (e.key === "Escape" && selected) {
        selected = null;
        draw();
      } else if (nudge && ARROWS[e.key]) {
        const [dx, dy] = ARROWS[e.key];
        const k = e.shiftKey ? 8 : 1;
        commit(moveBy(tl(), nudge, dx * k, dy * k));
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
    return `<div class="${cls}" data-id="${esc(id)}" style="left:${pct(start / D)};${w}" title="${esc(labelOf(tl(), p.kit, id))}">
      <span>${esc(label)}</span>${opts.grip ? `<i class="grip" aria-hidden="true"></i>` : ""}</div>`;
  }
  function drawTracks() {
    const T = tl();
    const D = T.duration;
    const warn = new Set(missingReport(T, p.kit, false, has).map((m) => m.used_by));
    const ticks = Array.from({ length: Math.ceil(D) }, (_, s) => `<span class="tick" style="left:${pct(s / D)}">${s}</span>`).join("");
    const shots = T.shots.map((s) => bar(s.id, shotName(T, s.id), s.start, s.end - s.start, { cls: "shot", warn: warn.has(s.id), locked: s.locked })).join("")
      + T.shots.slice(0, -1).map((s, i) => `<i class="edge" data-a="${esc(s.id)}" data-b="${esc(T.shots[i + 1].id)}" style="left:${pct(s.end / D)}" title="Drag to move the cut"></i>`).join("");
    const row = (label: string, lane: string, attrs = "", sel = false, cls = "") =>
      `<div class="track ${cls}"><div class="track-label${sel ? " sel" : ""}" ${attrs}>${label}</div><div class="lane" ${attrs}>${lane}</div></div>`;
    const actors = T.actors.map((a) =>
      row(
        `<span class="who">${esc(actorName(T, a.id))}</span><button class="row-add" type="button" data-add="${esc(a.id)}" aria-haspopup="menu" aria-label="Add a move for ${esc(actorName(T, a.id))}" title="Add a move at the playhead">+</button>`,
        a.actions.map((x) => bar(x.id, moveLabel(x.do), x.t, x.dur, { grip: x.dur !== undefined, warn: warn.has(x.id), locked: x.locked })).join(""),
        `data-actor="${esc(a.id)}" title="Double-click the lane to add an action"`,
        a.id === selected,
      )).join("");
    const fx = T.fx.map((f) => {
      const meta = p.kit.assets[f.fx]?.fx;
      const len = meta ? fxEnd(f, meta, D) - f.t : f.dur; // the bar covers exactly what plays
      return bar(f.id, fxName(p.kit, f.fx), f.t, len, { grip: true, warn: warn.has(f.id), locked: f.locked, cls: "fx" });
    }).join("");
    const audio = T.audio.map((s) => bar(s.id, s.line ? `${s.clip} “${s.line}”` : s.clip, s.t, bufs.get(s.clip)?.duration, { warn: warn.has(s.id), locked: s.locked, cls: s.kind })).join("");
    tracks.innerHTML = `
      ${row("", ticks, `data-ruler="1" title="Click or drag to move the playhead"`, false, "ruler")}
      ${row("Shots", shots)}
      ${actors || row(`<span class="small">No actors</span>`, `<span class="lane-hint">Drag a character in from Cast on the left</span>`)}
      ${row("Effects", fx)}
      ${row("Audio", audio)}
      <div class="playhead" aria-hidden="true"></div>`;
    tracks.style.setProperty("--p", String(t / D));
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
    if (el.closest("[data-add]")) return; // the + opens its menu on click; a redraw now would eat the click
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
  // ---- the + on an actor's row: a small menu of moves, each added at the playhead
  tracks.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-add]");
    if (b) openMoveMenu(b, b.dataset.add!);
  };
  function openMoveMenu(anchor: HTMLElement, actorId: string) {
    document.querySelector(".move-menu")?.remove();
    const a = tl().actors.find((x) => x.id === actorId);
    if (!a) return;
    const own = Object.keys(p.kit.chars[a.char]?.anims ?? {}).filter((n) => n !== "idle" && n !== "walk" && n !== "hurt" && animStatus(p.kit, a.char, n, false, has) === "ok");
    // Attack and Breathe fire are always offered (the kit has no creature flag); picking one before it exists lands it in Needs approval
    const items = [...ACTIONS_MENU, "anim:attack", "anim:breathe", ...own.filter((n) => n !== "attack" && n !== "breathe").map((n) => `anim:${n}`)];
    const menu = Object.assign(document.createElement("div"), { className: "move-menu", role: "menu" });
    menu.setAttribute("aria-label", `Moves for ${actorName(tl(), actorId)}`);
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${r.right + 4}px`;
    menu.style.top = `${Math.max(4, Math.min(r.top, innerHeight - 24 * items.length - 12))}px`;
    const close = () => (menu.remove(), document.removeEventListener("pointerdown", away, true), refocus());
    const refocus = () => tracks.querySelector<HTMLElement>(`[data-add="${CSS.escape(actorId)}"]`)?.focus();
    const away = (e: Event) => menu.contains(e.target as Node) || (menu.remove(), document.removeEventListener("pointerdown", away, true));
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
    document.addEventListener("pointerdown", away, true);
    menu.querySelector("button")!.focus();
  }
  /** A small menu under anchor; Escape, Tab or a click outside closes it and focus goes back to anchor. */
  function popMenu(anchor: HTMLElement, label: string, items: [string, () => void][]) {
    const menu = Object.assign(document.createElement("div"), { className: "move-menu", role: "menu" });
    menu.setAttribute("aria-label", label);
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(r.left, innerWidth - 240)}px`;
    menu.style.bottom = `${innerHeight - r.top + 4}px`; // opens upwards: the timeline is below the button
    menu.style.maxHeight = `${r.top - 12}px`;
    menu.style.overflowY = "auto";
    const close = () => (menu.remove(), document.removeEventListener("pointerdown", away, true), anchor.focus());
    const away = (e: Event) => menu.contains(e.target as Node) || (menu.remove(), document.removeEventListener("pointerdown", away, true));
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
  function draw() {
    const T = tl();
    drawTracks();
    drawDrawer();
    const errs = validateTimeline(T);
    const kitChanged = () => (changed(), loadImgs().then(draw));
    renderInspector($(".inspector"), T, selected, { kit: p.kit, project: p, now: () => t, errors: errs, kitChanged, move: moveTo }, (r, sel) => commit(r, sel), (id) => commit(deleteEntry(tl(), id), null));
    renderApprovals($(".needs-box"), p, (r) => commit(r), kitChanged, moveTo);
    drawFraming();
    drawStatus();
    $<HTMLButtonElement>("[data-act=undo]").disabled = !hist.canUndo;
    $<HTMLButtonElement>("[data-act=redo]").disabled = !hist.canRedo;
    paint();
  }

  // Black gaps around a background, actors cut by an edge: worth a look, never a block on export.
  function drawFraming() {
    const box = $(".frame-box");
    const issues = framingIssues(tl(), p.kit, (k) => imgs.get(k) ?? null, W, H);
    box.hidden = !issues.length;
    box.innerHTML = `<h2>Check the framing</h2><ul class="needs"></ul>`;
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
