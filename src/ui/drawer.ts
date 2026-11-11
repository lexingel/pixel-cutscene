import { FX_LIST, fxThumb } from "../core/fxLibrary";
import { charFrames } from "../core/frames";
import { readyChars, type Img, type Kit } from "../core/kit";
import type { Project } from "../core/project";
import { decode } from "./cast";
import { toast } from "./dialogs";
import { loadTracks, mmss } from "./music";

/** `sound` is the blank placeholder clip that waits in Needs approval for a generated or uploaded file. */
export type DrawerItem =
  | { kind: "char"; char: string }
  | { kind: "fx"; id: string }
  | { kind: "clip"; clip: string }
  | { kind: "track"; id: string }
  | { kind: "sound" };
export type DropAt = { x?: number; y?: number; t?: number };
export const ITEM_MIME = "application/x-pcs-item";

const SIZE = 48;

/** An image fitted into a 48x48 pixelated canvas (whole-number scale up, shrunk to fit when larger). */
export function paintThumb(c: HTMLCanvasElement, img: Img): void {
  const src = document.createElement("canvas");
  src.width = img.w;
  src.height = img.h;
  src.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.px), img.w, img.h), 0, 0);
  const k = Math.min(SIZE / img.w, SIZE / img.h);
  const s = k >= 1 ? Math.floor(k) : k;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, SIZE, SIZE);
  const w = Math.max(1, Math.round(img.w * s)), h = Math.max(1, Math.round(img.h * s));
  g.drawImage(src, Math.floor((SIZE - w) / 2), Math.floor((SIZE - h) / 2), w, h);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}

let player: { a: HTMLAudioElement; btn: HTMLButtonElement; url?: string } | null = null;
function stopPlayer(): void {
  if (!player) return;
  player.a.pause();
  player.btn.textContent = "▶";
  if (player.url) URL.revokeObjectURL(player.url);
  player = null;
}

/** ▶ button: plays `src`, a second press (or another ▶) stops it. */
function playButton(label: string, src: () => { src: string; url?: string } | null): HTMLButtonElement {
  const b = el("button", { type: "button", className: "d-play", textContent: "▶" });
  b.setAttribute("aria-label", `Play ${label}`);
  b.onclick = () => {
    const was = player?.btn === b;
    stopPlayer();
    if (was) return;
    const s = src();
    if (!s) return toast(`${label} has no sound file yet.`, "error");
    const a = new Audio(s.src);
    player = { a, btn: b, url: s.url };
    b.textContent = "■";
    a.onended = () => player?.a === a && stopPlayer();
    void a.play().catch((e: Error) => {
      if (player?.a === a) stopPlayer();
      if (e.name !== "AbortError") toast(`Could not play ${label}.`, "error");
    });
  };
  return b;
}

function itemButton(label: string, it: DrawerItem, onAdd: (it: DrawerItem, at: DropAt) => void, thumb?: HTMLCanvasElement, sub?: string): HTMLButtonElement {
  const b = el("button", { type: "button", className: thumb ? "d-item tile" : "d-item row", draggable: true });
  b.setAttribute("aria-label", label);
  b.title = `${label} (drag onto the preview or a track, or press Enter)`;
  if (thumb) thumb.setAttribute("aria-hidden", "true");
  const name = el("span", { className: "d-name", textContent: label });
  b.append(...(thumb ? [thumb, name] : [name]));
  if (sub) b.append(el("span", { className: "d-sub", textContent: sub }));
  b.ondragstart = (e) => {
    e.dataTransfer?.setData(ITEM_MIME, JSON.stringify(it));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
  };
  b.onclick = () => onAdd(it, {});
  return b;
}

export const thumbCanvas = () => el("canvas", { width: SIZE, height: SIZE, className: "px d-thumb" });

/** Left drawer: Cast, Effects and Sound and Music, each item draggable and addable with Enter. */
export function renderDrawer(host: HTMLElement, p: Project, onAdd: (it: DrawerItem, at: DropAt) => void): void {
  stopPlayer();
  const keepSearch = host.querySelector<HTMLInputElement>("input[type=search]")?.value ?? "";
  const keepScroll = host.scrollTop;
  const has = (path: string) => p.files.has(path);

  // ---- Cast
  const cast = el("div", { className: "d-grid" });
  const chars = readyChars(p.kit, has);
  if (!chars.length) cast.append(el("p", { className: "small muted", textContent: "No characters yet. Add one in ② Cast." }));
  for (const c of chars) {
    const cv = thumbCanvas();
    cast.append(itemButton(c, { kind: "char", char: c }, onAdd, cv));
    const paths = p.kit.chars[c].anims.idle.frames;
    void Promise.all(paths.map(async (f) => [f, await decode(p.files.get(f)!)] as const)).then((got) => {
      const m = new Map(got);
      const first = charFrames(p.kit, (f) => m.get(f) ?? null, false, has)(c, "idle")[0];
      if (first) paintThumb(cv, first);
    }).catch(() => {});
  }

  // ---- Effects
  const q = el("input", { type: "search", placeholder: "Search effects", value: keepSearch });
  q.setAttribute("aria-label", "Search effects");
  let cat = "all";
  const sel = el("select", {}, el("option", { value: "all", textContent: "All effects" }), ...[...new Set(FX_LIST.map((f) => f.category))].map((c) => el("option", { value: c, textContent: c })));
  sel.setAttribute("aria-label", "Effect category");
  const fxGrid = el("div", { className: "d-grid" });
  const seen = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      const cv = e.target.querySelector("canvas")!;
      void fxThumb((e.target as HTMLElement).dataset.fx!).then((img) => paintThumb(cv, img)).catch(() => {});
    }
  });
  const fxButtons = FX_LIST.map((f) => {
    const b = itemButton(f.name, { kind: "fx", id: f.id }, onAdd, thumbCanvas());
    b.dataset.fx = f.id;
    b.title = `${f.name}, ${f.category} (drag onto the preview or a track, or press Enter)`;
    seen.observe(b);
    return b;
  });
  fxGrid.append(...fxButtons);
  const refilter = () => {
    const s = q.value.trim().toLowerCase();
    FX_LIST.forEach((f, i) => (fxButtons[i].hidden = (cat !== "all" && f.category !== cat) || (!!s && !f.name.includes(s) && !f.category.includes(s))));
  };
  sel.onchange = () => ((cat = sel.value), refilter());
  q.oninput = refilter;
  refilter();

  // ---- Sound and Music
  const sounds = el("div", { className: "d-list" });
  sounds.append(itemButton("New sound…", { kind: "sound" }, onAdd, undefined, "a blank clip to fill in later"));
  for (const [id, a] of Object.entries(p.kit.assets)) {
    if (a.kind !== "sfx" && a.kind !== "voice") continue;
    const blob = p.files.get(a.path);
    const row = el("div", { className: "d-row" }, itemButton(id, { kind: "clip", clip: id }, onAdd, undefined, a.kind));
    if (blob) row.append(playButton(id, () => { const url = URL.createObjectURL(blob); return { src: url, url }; }));
    sounds.append(row);
  }
  const trackBox = el("div", { className: "d-list" }, el("p", { className: "small muted", textContent: "Loading the music library…" }));
  loadTracks().then((ts) => {
    trackBox.replaceChildren(...ts.map((t) =>
      el("div", { className: "d-row" }, itemButton(t.title, { kind: "track", id: t.id }, onAdd, undefined, mmss(t.seconds)),
        playButton(t.title, () => ({ src: `${import.meta.env.BASE_URL}music/${t.file}` })))));
  }).catch(() => trackBox.replaceChildren(el("p", { className: "small muted", textContent: "The music library could not load. Check your connection." })));

  const section = (title: string, ...kids: HTMLElement[]) => el("section", { className: "d-sec" }, el("h2", { textContent: title }), ...kids);
  const secs = [section("Cast", cast), section("Effects", q, sel, fxGrid), section("Sound and Music", sounds, trackBox)];
  secs.forEach((x, i) => x.classList.add(["d-cast", "d-fx", "d-snd"][i]));
  host.replaceChildren(...secs);
  host.scrollTop = keepScroll;
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
/** Parses dragged text into an item; null unless it is one of our kinds with non-empty string ids. */
export function parseItem(text: string): DrawerItem | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  switch (o.kind) {
    case "char": return str(o.char) ? { kind: "char", char: o.char } : null;
    case "fx": return str(o.id) ? { kind: "fx", id: o.id } : null;
    case "clip": return str(o.clip) ? { kind: "clip", clip: o.clip } : null;
    case "track": return str(o.id) ? { kind: "track", id: o.id } : null;
    case "sound": return { kind: "sound" };
    default: return null;
  }
}
/** The item must exist in this project (own keys only, so "constructor" is refused). Tracks are checked against the library later. */
export const knownItem = (kit: Kit, it: DrawerItem): boolean =>
  it.kind === "char" ? Object.hasOwn(kit.chars, it.char)
  : it.kind === "clip" ? Object.hasOwn(kit.assets, it.clip)
  : it.kind === "fx" ? FX_LIST.some((f) => f.id === it.id)
  : true;
/** The dragged item from a drop event, or null when it is not one of ours. */
export const droppedItem = (e: DragEvent): DrawerItem | null => parseItem(e.dataTransfer?.getData(ITEM_MIME) ?? "");
export const isItemDrag = (e: DragEvent) => !!e.dataTransfer?.types.includes(ITEM_MIME);
