import { baseName, freePath, sortFrames } from "../core/cast";
import { animStatus, type Kit } from "../core/kit";
import { NEEDS, missingReport } from "../core/missing";
import type { Project } from "../core/project";
import { labelOf } from "../core/labels";
import { moveLabel } from "../core/moves";
import { ACTIONS } from "../core/timeline";
import type { AudioKind, Timeline } from "../core/types";
import { decode, playing } from "./cast";
import { toast } from "./dialogs";
import { find, setMove, type EditResult } from "./timelineEditor";
import { pickTrack } from "./music";
import { pickFx } from "./fxPicker";
import { useLibraryFx } from "../core/fxLibrary";
import { audioPlan, elevenKey, generateAudio } from "./eleven";
import { busy, generate, genAction, genPlan, pixellabKey, words, NO_KEY } from "./pixellab";
import { isRunning } from "./inflight";
import { generateAll, planAll } from "./genAll";

// moves the user can add before they exist: they land here to be generated
const GENERATABLE = ["anim:attack", "anim:breathe"];
const GEN_AUDIO = ["voice", "sfx", "music"];

type Row = ReturnType<typeof missingReport>[number];
type Target =
  | { kind: "anim"; char: string; anim: string }
  | { kind: "face"; face: string; expr: string }
  | { kind: "asset"; id: string; asset: Kit["assets"][string]["kind"] };

// What a Needs-approval row asks for, read from the entry that uses it (names may contain spaces).
export function targetOf(tl: Timeline, r: Row): Target | null {
  const at = find(tl, r.used_by);
  if (!at) return null;
  switch (at.kind) {
    case "actor":
      return { kind: "anim", char: at.e.char, anim: "idle" };
    case "action": {
      const d: string = at.e.do;
      return { kind: "anim", char: at.actor.char, anim: d.startsWith("anim:") ? d.slice(5) : NEEDS[d] };
    }
    case "shot":
      return at.e.type === "closeup" && r.what === `face ${at.e.face} ${at.e.expr}`
        ? { kind: "face", face: at.e.face, expr: at.e.expr }
        : { kind: "asset", id: r.what, asset: "bg" };
    case "fx":
      return { kind: "asset", id: r.what, asset: "fx" };
    case "audio":
      return { kind: "asset", id: r.what, asset: at.e.kind as AudioKind };
    default:
      return null;
  }
}

const ext = (name: string) => name.match(/\.[A-Za-z0-9]+$/)?.[0].toLowerCase() ?? "";
const isAudio = (t: Target) => t.kind === "asset" && GEN_AUDIO.includes(t.asset);
export const isAudioTarget = (t: Target): boolean => isAudio(t);

// Stores the user's own files for a target: approved, source "user".
export async function useOwnFiles(p: Project, t: Target, files: File[]): Promise<void> {
  if (t.kind === "anim") {
    const dir = `chars/${t.char}/${t.anim}/`;
    const frames = sortFrames(files.map((f) => f.name)).map((n) => {
      const path = freePath(p, dir, baseName(n));
      p.files.set(path, files.find((f) => f.name === n)!);
      return path;
    });
    (p.kit.chars[t.char] ??= { view: "side", anims: {} }).anims[t.anim] = { approved: true, source: "user", frames };
  } else if (t.kind === "face") {
    const old = p.kit.faces[t.face]?.[t.expr];
    if (old) [old.path, ...(old.mouths ?? [])].forEach((f) => p.files.delete(f)); // the mouths were drawn on the old face
    const path = freePath(p, `faces/${t.face}/`, `${t.expr}${ext(files[0].name)}`);
    p.files.set(path, files[0]);
    (p.kit.faces[t.face] ??= {})[t.expr] = { approved: true, source: "user", path };
  } else {
    const f = files[0];
    const path = freePath(p, isAudio(t) ? "audio/" : `${t.asset}/`, `${t.id}${ext(f.name)}`);
    p.files.set(path, f);
    const a: Kit["assets"][string] = { approved: true, source: "user", kind: t.asset, path };
    if (t.asset === "fx") {
      // ponytail: one still frame centred on (x, y); sprite-sheet effects arrive with the effect library
      const img = await decode(f);
      a.fx = { cols: 1, frames: 1, fps: 12, loop: false, dx: Math.floor(img.w / 2), dy: Math.floor(img.h / 2) };
    }
    p.kit.assets[t.id] = a;
  }
}

/** A generated piece waiting for the user's verdict; Redo is off when the piece cannot be regenerated here. */
export function pieceRow(label: string, preview: HTMLElement, onApprove: () => void, onRedo: (() => void) | null): HTMLElement {
  const el = document.createElement("div");
  el.className = "piece";
  el.innerHTML = `<div class="piece-preview"></div><div class="row"><span class="small grow"></span>
    <button class="btn quiet" type="button" data-act="redo">Redo</button><button class="btn primary" type="button" data-act="approve">Approve</button></div>`;
  el.querySelector(".piece-preview")!.append(preview);
  el.querySelector(".small")!.textContent = label;
  el.querySelector<HTMLButtonElement>("[data-act=approve]")!.onclick = onApprove;
  const redo = el.querySelector<HTMLButtonElement>("[data-act=redo]")!;
  redo.disabled = !onRedo;
  if (onRedo) redo.onclick = onRedo;
  return el;
}

// Actions this one can turn into without needing anything new.
export function swaps(p: Project, tl: Timeline, id: string): string[] {
  const at = find(tl, id);
  if (at?.kind !== "action") return [];
  const char = at.actor.char;
  const anims = Object.keys(p.kit.chars[char]?.anims ?? {});
  return [...new Set([...ACTIONS, ...GENERATABLE, ...anims.map((a) => `anim:${a}`)])].filter((d) => {
    if (d === at.e.do || d === "say") return false; // a line of speech is no stand-in for a move
    const need = d.startsWith("anim:") ? d.slice(5) : NEEDS[d];
    if (need && !GENERATABLE.includes(d) && animStatus(p.kit, char, need, false, (k) => p.files.has(k)) !== "ok") return false;
    return !setMove(tl, id, d, false).error;
  });
}

let urls: string[] = [];

export function renderApprovals(host: HTMLElement, p: Project, apply: (r: EditResult) => void, kitChanged: () => void, move?: (actionId: string, doId: string) => void): void {
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  const tl = p.tl!;
  const rows = missingReport(tl, p.kit, false, (k) => p.files.has(k));
  host.innerHTML = `<header class="row between"><h2>Needs approval</h2><span class="count small"></span></header><ul class="needs" data-testid="needs"></ul>`;
  host.querySelector(".count")!.textContent = rows.length ? String(rows.length) : "";
  const list = host.querySelector("ul")!;
  const hint = pixellabKey() || elevenKey() ? "Generate a piece, upload your own files, or change the action." : `${NO_KEY} Or upload your own files, or change the action.`;
  if (rows.length) list.before(Object.assign(document.createElement("p"), { className: "hint", textContent: hint }));
  const all = planAll(p);
  const n = all.pixellab.length + all.eleven.length;
  if (n > 1) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: `Generate all (${n})` });
    const cost = [
      all.pixellab.length && `PixelLab ${all.gens.min === all.gens.max ? `about ${all.gens.min}` : `${all.gens.min}-${all.gens.max}`} generations`,
      all.eleven.length && `ElevenLabs about ${all.credits} credits`,
    ].filter(Boolean).join(", ");
    b.title = `${cost}${all.skipped ? `; ${all.skipped} more need something first` : ""}`;
    b.setAttribute("data-testid", "gen-all");
    b.onclick = () => void busy(host, () => generateAll(p, kitChanged));
    list.before(Object.assign(document.createElement("p"), { className: "small row wrap gen-all", textContent: `${cost}. ` }));
    host.querySelector(".gen-all")!.append(b);
  }
  if (!rows.length) {
    list.innerHTML = `<li class="done small">Nothing missing. Every piece is in and approved, so this is ready to export.</li>`;
    return;
  }
  for (const r of rows) {
    const t = targetOf(tl, r);
    const li = document.createElement("li");
    li.tabIndex = -1; // the Tweak status links here
    li.innerHTML = `<div class="need-head"><strong></strong><span class="tag"></span></div><span class="small used"></span><div class="row wrap acts"></div>`;
    li.querySelector("strong")!.textContent = words(r.what);
    const tag = li.querySelector<HTMLElement>(".tag")!;
    tag.textContent = r.why === "missing" ? "missing" : "to approve";
    tag.classList.add(r.why);
    li.querySelector(".used")!.textContent = `used by ${labelOf(tl, p.kit, r.used_by)}`;
    const acts = li.querySelector<HTMLElement>(".acts")!;
    // one run per row: while it is in flight every control on the row is off
    const aud = t?.kind === "asset" && isAudio(t) ? t : null;
    const regen = () => void (t && busy(li, () => (aud ? generateAudio(p, aud.id, r.used_by, aud.asset, kitChanged) : generate(p, t, kitChanged))));
    if (r.why === "unapproved" && t) li.insertBefore(review(p, t, r.used_by, kitChanged, regen), acts);

    const plan = aud ? audioPlan(p, r.used_by, aud.asset) : t ? genPlan(p, t) : { label: "Generate", why: "Nothing to generate for this row" };
    // still running from before a re-render: stays off until it lands (the list re-renders then)
    const running = !!t && !aud && isRunning(genAction(t));
    const gen = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: running ? "Generating…" : plan.label, disabled: !!plan.why || running });
    gen.title = plan.why ?? `Generate ${words(r.what)} with ${aud ? "ElevenLabs" : "PixelLab"}`;
    if (t && !plan.why) gen.onclick = regen;
    acts.append(gen);
    if (t) {
      const up = document.createElement("label");
      up.className = "btn quiet";
      up.textContent = "Upload my own";
      const inp = Object.assign(document.createElement("input"), { type: "file", hidden: true, multiple: t.kind === "anim" });
      inp.accept = isAudio(t) ? "audio/*" : "image/png";
      inp.onchange = async () => {
        const files = [...(inp.files ?? [])];
        inp.value = "";
        if (!files.length) return;
        try {
          await useOwnFiles(p, t, files);
          toast(`${words(r.what)} added from your files.`);
          kitChanged();
        } catch {
          toast(`Could not read ${files[0].name}. Use PNG images${isAudio(t) ? " or audio files" : ""}.`, "error");
        }
      };
      up.append(inp);
      acts.append(up);
    }
    if (t?.kind === "asset" && t.asset === "fx") {
      const lib = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: "Pick from library" });
      lib.onclick = async () => {
        const id = await pickFx(`An effect for ${words(r.what)}`);
        if (!id) return;
        lib.disabled = true;
        try {
          apply(await useLibraryFx(p, tl, r.used_by, id)); // bakes it into the kit too
          kitChanged();
        } catch {
          lib.disabled = false;
          toast("Could not prepare that effect. Try another one.", "error");
        }
      };
      acts.append(lib);
    }
    if (t?.kind === "asset" && t.asset === "music") {
      const lib = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: "Pick from library" });
      lib.onclick = async () => ((await pickTrack(p, t.id)) ? kitChanged() : undefined);
      acts.append(lib);
    }
    const opts = swaps(p, tl, r.used_by);
    if (opts.length) {
      const sel = document.createElement("select");
      sel.className = "swap";
      sel.setAttribute("aria-label", `Change action ${labelOf(tl, p.kit, r.used_by)}`);
      // option text via textContent: anim names come from the project zip and may hold markup
      sel.append(...["", ...opts].map((o) => Object.assign(document.createElement("option"), { value: o, textContent: o ? moveLabel(o) : "Change action…" })));
      sel.onchange = () => sel.value && (move ? move(r.used_by, sel.value) : apply(setMove(tl, r.used_by, sel.value, !!(find(tl, r.used_by) as any)?.actor?.flip)));
      acts.append(sel);
    }
    list.append(li);
  }
}

// Preview + Approve for an unapproved piece already in the kit.
function review(p: Project, t: Target, usedBy: string, kitChanged: () => void, regen: () => void): HTMLElement {
  const piece = t.kind === "anim" ? p.kit.chars[t.char]?.anims[t.anim] : t.kind === "face" ? p.kit.faces[t.face]?.[t.expr] : p.kit.assets[t.id];
  // an animation plays, so its motion can be judged before approving
  const paths = piece ? ("frames" in piece ? piece.frames : [piece.path]) : [];
  const srcs = paths.flatMap((f) => {
    const blob = p.files.get(f);
    if (!blob) return [];
    const src = URL.createObjectURL(blob);
    urls.push(src);
    return [src];
  });
  let preview: HTMLElement = document.createElement("span");
  if (srcs.length) preview = isAudio(t) ? Object.assign(document.createElement("audio"), { src: srcs[0], controls: true }) : playing(srcs);
  const canRedo =
    piece?.source === "pixellab" ? !genPlan(p, t).why
    : piece?.source === "elevenlabs" && t.kind === "asset" ? !audioPlan(p, usedBy, t.asset).why
    : false;
  return pieceRow(piece ? `from ${piece.source}` : "", preview, () => {
    if (!piece) return;
    piece.approved = true;
    kitChanged();
  }, canRedo ? regen : null);
}
