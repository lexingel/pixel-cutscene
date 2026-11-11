import { coverScale } from "../core/starter";
import { readyChars, type Kit } from "../core/kit";
import { ACTIONS, KINDS } from "../core/timeline";
import { audioPlan, elevenKey, generateAudio, voicesFor } from "./eleven";
import type { CamKey, Timeline } from "../core/types";
import type { Project } from "../core/project";
import { pickTrack } from "./music";
import { actorName, fxName, labelOf } from "../core/labels";
import { moveLabel } from "../core/moves";
import { find, moveEntry, resizeEntry, setCamera, setField, setMove, snap, type EditResult } from "./timelineEditor";
import { catOfTrack } from "./category";
import { freePath } from "../core/cast";
import { decode } from "./cast";
import { toast } from "./dialogs";
import { generateShotBg, NO_KEY, paid, pixellabKey } from "./pixellab";
import { COST, bgScale, genMouthsInto } from "../gen/pixellab";
import { loadFx, REACH_MAX, takesReach } from "../core/fxLibrary";

type Kind = "num" | "text" | "bool" | "select";
type Field = { key: string; label: string; kind: Kind; options?: string[]; optional?: boolean; text?: (o: string) => string };
type Ctx = { kit: Kit; now: () => number; errors: string[]; kitChanged?: () => void; project?: Project; move?: (actionId: string, doId: string) => void; reach?: (fxId: string, reach: number) => void; aim?: (fxId: string, deg: number) => void };
type Obj = Record<string, any>;

const STYLE_TEXT = (o: string) => (o === "box" ? "dialogue box" : o === "none" ? "nothing" : "speech bubble");
const NUM = (key: string, label = key, optional = false): Field => ({ key, label, kind: "num", optional });
const show = (v: unknown) => (typeof v === "number" ? String(Math.round(v * 1000) / 1000) : v === undefined ? "" : String(v));
const LAYER_TEXT: Record<string, string> = { "": "by where they stand", front: "always in front", back: "always behind" };
const MOODS = ["neutral", "happy", "angry", "sad", "surprised"]; // PixelLab's lip-sync moods
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
const assetIds = (kit: Kit, kinds: string[]) => Object.keys(kit.assets).filter((k) => kinds.includes(kit.assets[k].kind));

function fields(tl: Timeline, id: string, kit: Kit): Field[] {
  const at = find(tl, id)!;
  const e = at.e;
  switch (at.kind) {
    case "root":
      return [{ key: "name", label: "Name", kind: "text" }, NUM("duration", "Length (s)"), NUM("closeup_scale", "Close-up scale", true), { key: "shadows", label: "Ground shadows", kind: "bool", optional: true }];
    case "shot":
      return [
        { key: "bg", label: "Background", kind: "select", options: ["", ...assetIds(kit, ["bg", "backdrop"])], optional: true },
        ...(e.type === "wide" ? [NUM("bg_scale", "Background scale"), NUM("ground", "Ground line (y)", true)] : [
          { key: "face", label: "Face", kind: "select" as Kind, options: uniq([e.face, ...Object.keys(kit.faces), ...tl.actors.map((a) => a.char)]) },
          { key: "expr", label: "Expression", kind: "select" as Kind, options: uniq([e.expr, ...MOODS, ...Object.keys(kit.faces[e.face] ?? {})]) },
        ]),
        NUM("fade_in", "Fade in (s)", true),
        NUM("fade_out", "Fade out (s)", true),
        NUM("flash", "White flash (s)", true),
        ...(e.type === "wide" ? [NUM("shake", "Shake (s)", true)] : []),
        ...(e.type === "wide" && e.zoom ? [ // a zoom made from + Shot; clear "zoom from" or "zoom to" to remove it
          NUM("zoom.from", "Zoom from (×)", true), NUM("zoom.to", "Zoom to (×)", true),
          { key: "zoom.actor", label: "Zoom follows", kind: "select" as Kind, options: ["", ...tl.actors.map((a) => a.id)], optional: true, text: (o: string) => (o ? actorName(tl, o) : "a fixed point") },
          ...(e.zoom.actor ? [] : [NUM("zoom.x", "Zoom on x"), NUM("zoom.y", "Zoom on y")]),
        ] : []),
      ];
    case "actor":
      return [
        { key: "char", label: "Character", kind: "select", options: readyChars(kit) },
        NUM("x", "X"), NUM("y", "Y"),
        { key: "flip", label: "Faces left", kind: "bool", optional: true },
        { key: "layer", label: "Layer", kind: "select", options: ["", "front", "back"], optional: true, text: (o: string) => LAYER_TEXT[o] },
        NUM("appear", "Appears at (s)", true),
      ];
    case "action": {
      const anims = Object.keys(kit.chars[at.actor.char]?.anims ?? {}).map((a) => `anim:${a}`);
      const walks = e.do === "walk" || e.do === "move";
      return [
        { key: "do", label: "Move", kind: "select", options: [...new Set([...ACTIONS, "anim:attack", "anim:breathe", ...anims])], text: moveLabel },
        NUM("t", "Start (s)"),
        NUM("dur", "Length (s)", true),
        ...(walks ? [NUM("to.0", "Go to x"), NUM("to.1", "Go to y")] : []),
        ...(e.do === "say" ? [
          { key: "text", label: "Words", kind: "text" as Kind },
          { key: "style", label: "Shown as", kind: "select" as Kind, options: ["", "box"], optional: true, text: STYLE_TEXT },
        ] : []),
      ];
    }
    case "fx":
      return [NUM("t", "Start (s)"), NUM("dur", "Length (s)", true), NUM("x", "X"), NUM("y", "Y"), { key: "flip", label: "Faces left", kind: "bool", optional: true }];
    case "audio":
      return [
        { key: "clip", label: "Clip", kind: "text" },
        { key: "kind", label: "Kind", kind: "select", options: KINDS },
        NUM("t", "Start (s)"),
        { key: "line", label: "Line", kind: "text", optional: true },
        ...(e.kind === "voice" ? [
          { key: "speaker", label: "Speaker", kind: "select" as Kind, options: ["", ...Object.keys(kit.chars)], optional: true },
          { key: "bubble", label: "On screen", kind: "select" as Kind, options: ["", "box", "none"], optional: true, text: STYLE_TEXT },
        ] : []),
        ...(e.kind === "sfx" ? [NUM("dur", "Length to make (s)", true)] : []),
        NUM("vol_db", "Volume (dB)", true),
      ];
  }
}

// One edit per field change; t and dur go through the snapping ops, `to.0`/`to.1` edit one half of to.
function change(tl: Timeline, id: string, f: Field, raw: string | boolean): EditResult {
  if (f.kind === "bool") return setField(tl, id, f.key, raw ? true : f.optional ? undefined : false);
  const text = String(raw).trim();
  if (f.key.startsWith("zoom.")) {
    const k = f.key.slice(5), z: Obj = { ...find(tl, id)!.e.zoom };
    if (text === "") {
      if (k === "from" || k === "to") return setField(tl, id, "zoom", undefined);
      delete z[k];
    } else if (k === "actor") z.actor = text;
    else if (!Number.isFinite(Number(text))) return { tl, error: `${f.label} needs a number.` };
    else z[k] = Number(text);
    return setField(tl, id, "zoom", z);
  }
  if (text === "" && f.optional) return setField(tl, id, f.key, undefined);
  if (f.key === "do") {
    const found = find(tl, id)!;
    const flip = found.kind === "action" ? !!(found.actor as Obj).flip : false;
    return setMove(tl, id, text, flip);
  }
  if (f.kind !== "num") return setField(tl, id, f.key, text);
  const n = Number(text);
  if (text === "" || !Number.isFinite(n)) return { tl, error: `${f.label} needs a number.` };
  if (f.key === "t") return moveEntry(tl, id, n);
  if (f.key === "dur") return resizeEntry(tl, id, n);
  if (f.key.startsWith("to.")) {
    const to = [...((find(tl, id)!.e.to as number[]) ?? [0, 0])];
    to[Number(f.key[3])] = n;
    return setField(tl, id, "to", to);
  }
  return setField(tl, id, f.key, n);
}

const valueOf = (e: Obj, key: string) => (key.startsWith("to.") ? e.to?.[Number(key[3])] : key.startsWith("zoom.") ? e.zoom?.[key.slice(5)] : e[key]);

export function renderInspector(
  host: HTMLElement, tl: Timeline, selected: string | null, ctx: Ctx,
  apply: (r: EditResult, select?: string) => void, remove: (id: string) => void,
): void {
  const id = selected && find(tl, selected) ? selected : "(root)";
  const at = find(tl, id)!;
  const e = at.e;
  const title = at.kind === "root" ? "Scene" : at.kind === "fx" ? "Effect" : at.kind[0].toUpperCase() + at.kind.slice(1);
  host.innerHTML = `<header class="row between insp-head"><h2></h2><span class="small id"></span></header><div class="fields"></div>`;
  const head = host.querySelector<HTMLElement>("header")!; // banded by what is selected; the scene itself stays neutral
  if (at.kind !== "root") head.dataset.cat = catOfTrack(at.kind === "shot" ? "shots" : at.kind === "fx" ? "fx" : at.kind === "audio" ? "sfx" : "actor");
  host.querySelector("h2")!.textContent = title;
  host.querySelector(".id")!.textContent = at.kind === "root" ? "" : labelOf(tl, ctx.kit, id);
  const box = host.querySelector<HTMLElement>(".fields")!;

  for (const f of fields(tl, id, ctx.kit)) {
    const lab = document.createElement("label");
    lab.className = f.kind === "bool" ? "field check" : "field";
    const name = Object.assign(document.createElement("span"), { textContent: f.label });
    let input: HTMLInputElement | HTMLSelectElement;
    const v = valueOf(e, f.key);
    if (f.kind === "select") {
      input = document.createElement("select");
      const opts = f.options!.includes(show(v)) ? f.options! : [show(v), ...f.options!];
      // a speaker no longer in the cast stays selectable as "(missing)" so the user can change it
      const gone = (o: string) => f.key === "speaker" && o !== "" && !f.options!.includes(o);
      input.append(...opts.map((o) => Object.assign(document.createElement("option"), { value: o, textContent: gone(o) ? `${o} (missing)` : f.text ? f.text(o) : o || "none" })));
      input.value = show(v);
    } else {
      input = Object.assign(document.createElement("input"), { type: f.kind === "bool" ? "checkbox" : f.kind === "num" ? "number" : "text" });
      if (f.kind === "bool") input.checked = !!v;
      else input.value = show(v);
      if (f.kind === "num") input.step = f.key === "t" || f.key === "dur" || f.key.startsWith("fade") || f.key === "flash" || f.key === "shake" ? String(1 / 30) : f.key === "zoom.from" || f.key === "zoom.to" ? "0.5" : "1";
      if (f.optional && f.kind !== "bool") input.placeholder = "none";
    }
    input.setAttribute("aria-label", f.label);
    input.onchange = () => {
      if (f.key === "do" && ctx.move && input.value.trim() !== "") return ctx.move(id, input.value.trim()); // Breathe fire also adds its flame
      apply(change(tl, id, f, input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value));
    };
    if (f.kind === "bool") lab.append(input, name);
    else lab.append(name, input);
    box.append(lab);
  }

  if (at.kind === "fx") {
    // the effect is chosen in the drawer; its asset id is not editable here (an aimed copy has its own sheet)
    const lab = document.createElement("label");
    lab.className = "field";
    const out = Object.assign(document.createElement("output"), { textContent: fxName(ctx.kit, e.fx) });
    out.dataset.asset = e.fx;
    out.setAttribute("aria-label", "Effect");
    lab.append(Object.assign(document.createElement("span"), { textContent: "Effect" }), out);
    box.prepend(lab);
    const a = ctx.kit.assets[e.fx];
    if (a?.source === "pixelfx" && ctx.aim) box.insertBefore(aimField(e.angle ?? 0, (n) => ctx.aim!(id, n)), box.querySelector(".foot"));
    if (a?.source === "pixelfx" && a.ref && ctx.reach) {
      const reach = ctx.reach, ref = a.ref;
      loadFx(ref).then((m) => {
        if (!takesReach(m) || !box.isConnected) return;
        box.insertBefore(reachField(e.reach ?? 1, (n) => reach(id, n)), box.querySelector(".foot")); // above Locked / Delete
      }).catch(() => {});
    }
  }
  if (at.kind === "audio" && e.kind === "voice" && e.speaker && kitChar(ctx.kit, e.speaker)) box.append(voicePicker(ctx.kit, e.speaker, ctx.kitChanged));
  if (at.kind === "audio" && e.kind === "music" && ctx.project) {
    const p = ctx.project;
    const b = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: "Pick from library" });
    b.onclick = async () => ((await pickTrack(p, e.clip)) ? ctx.kitChanged?.() : undefined);
    box.append(b);
  }
  if (at.kind === "audio" && (e.kind === "voice" || e.kind === "sfx") && ctx.project) {
    const p = ctx.project;
    const plan = audioPlan(p, id, e.kind);
    const made = p.kit.assets[e.clip]?.source === "elevenlabs";
    const b = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: made ? "Redo with ElevenLabs" : "Generate with ElevenLabs" });
    const kept = !!p.kit.assets[e.clip]?.approved; // approved clips are never replaced
    b.disabled = !!plan.why || kept;
    b.title = plan.why ?? (kept ? "This clip is approved" : e.kind === "voice" ? "Speak this line in the speaker's voice" : "Make this sound from its line (or clip name)");
    b.onclick = async () => {
      b.disabled = true;
      await generateAudio(p, e.clip, id, e.kind, () => ctx.kitChanged?.());
      b.disabled = false;
    };
    box.append(b);
  }
  if (at.kind === "shot" && ctx.project) box.append(bgUpload(ctx.project, tl, id, apply, ctx.kitChanged));
  if (at.kind === "shot" && e.type === "wide" && ctx.project) box.append(bgGenerate(ctx.project, id, apply, ctx.kitChanged));
  if (at.kind === "shot" && e.type === "closeup" && ctx.project) box.append(lipSync(ctx.project, e.face, e.expr, ctx.kitChanged));
  if (at.kind === "shot" && e.type === "wide") box.append(cameraKeys(tl, id, e.camera as CamKey[], ctx.now, apply));
  if (at.kind === "root") {
    const todo = nextSteps(tl, ctx.kit);
    if (todo.length) {
      const ol = document.createElement("ol");
      ol.className = "todo";
      ol.append(...todo.map((x) => Object.assign(document.createElement("li"), { textContent: x })));
      box.append(Object.assign(document.createElement("p"), { className: "small todo-head", textContent: "Next steps" }), ol);
    }
    const n = ctx.errors.length;
    const note = Object.assign(document.createElement("p"), { className: n ? "hint err" : "hint" });
    note.textContent = n
      ? `${n} problem${n === 1 ? "" : "s"} in this timeline. First: ${ctx.errors[0]}`
      : "Click a bar to edit it. Space plays, ← → move 1 s, Shift steps one frame, Home / End jump to the ends, [ and ] set a selected bar's start and end, Ctrl+C / Ctrl+V copy a bar to the playhead. Press ? for every key.";
    box.append(note);
    return;
  }
  const foot = document.createElement("div");
  foot.className = "row between foot";
  foot.innerHTML = `<label class="field check"><input type="checkbox" /><span>Locked</span></label><button class="btn quiet danger" type="button">Delete</button>`;
  const lock = foot.querySelector("input")!;
  lock.checked = !!e.locked;
  lock.title = "A locked entry is kept as it is when you redraft the scene";
  lock.onchange = () => apply(setField(tl, id, "locked", lock.checked || undefined));
  foot.querySelector("button")!.onclick = () => remove(id);
  box.append(foot);
}

const kitChar = (kit: Kit, c: string) => kit.chars[c];

// The speaking character's voice id: a pick-list when an ElevenLabs key is set, else a text box.
// How far the effect carries: as drawn, or longer in half steps (each length bakes its own sheet).
// The aim in degrees (0 = as drawn, facing right; 90 = straight down); a new angle re-bakes the effect.
function aimField(now: number, set: (n: number) => void): HTMLElement {
  const lab = Object.assign(document.createElement("label"), { className: "field" });
  const inp = Object.assign(document.createElement("input"), { type: "number", step: "5", min: "-180", max: "180", value: String(Math.round(now)) });
  inp.setAttribute("aria-label", "Angle");
  inp.onchange = () => {
    const n = Math.round(Number(inp.value));
    if (Number.isFinite(n) && n !== now) set(((((n + 180) % 360) + 360) % 360) - 180);
  };
  lab.append(Object.assign(document.createElement("span"), { textContent: "Angle (°)" }), inp);
  return lab;
}

function reachField(now: number, set: (n: number) => void): HTMLElement {
  const lab = Object.assign(document.createElement("label"), { className: "field" });
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", "Reach");
  for (let r = 1; r <= REACH_MAX; r += 0.5) sel.append(new Option(r === 1 ? "as drawn" : `${r}× as far`, String(r), false, r === now));
  sel.onchange = () => set(Number(sel.value));
  lab.append(Object.assign(document.createElement("span"), { textContent: "Reach" }), sel);
  return lab;
}

function voicePicker(kit: Kit, char: string, changed?: () => void): HTMLElement {
  const lab = document.createElement("label");
  lab.className = "field";
  const name = Object.assign(document.createElement("span"), { textContent: `voice for ${char}` });
  const set = (v: string) => {
    kit.chars[char].voice = v.trim() || undefined;
    changed?.();
  };
  const cur = kit.chars[char].voice ?? "";
  const key = elevenKey();
  let input: HTMLInputElement | HTMLSelectElement;
  if (key) {
    const sel = document.createElement("select");
    sel.append(...[["", "none"], ...(cur ? [[cur, cur]] : [])].map(([v, t]) => Object.assign(document.createElement("option"), { value: v, textContent: t })));
    sel.value = cur;
    voicesFor(key).then(
      (vs) => {
        sel.replaceChildren(...[{ id: "", name: "none" }, ...(vs.some((v) => v.id === cur) || !cur ? [] : [{ id: cur, name: cur }]), ...vs].map((v) => Object.assign(document.createElement("option"), { value: v.id, textContent: v.name })));
        sel.value = cur;
      },
      () => {
        const txt = Object.assign(document.createElement("input"), { type: "text", value: cur, placeholder: "ElevenLabs voice id" });
        txt.setAttribute("aria-label", `voice for ${char}`);
        txt.onchange = () => set(txt.value);
        sel.replaceWith(txt);
        lab.append(Object.assign(document.createElement("span"), { className: "small err", textContent: "Could not load voices. Type a voice id." }));
      },
    );
    input = sel;
  } else {
    input = Object.assign(document.createElement("input"), { type: "text", value: cur, placeholder: "ElevenLabs voice id" });
  }
  input.setAttribute("aria-label", `voice for ${char}`);
  input.onchange = () => set(input.value);
  lab.append(name, input);
  return lab;
}

// What an unfinished scene still lacks, in the words of the buttons that add it.
function nextSteps(tl: Timeline, kit: Kit): string[] {
  const out: string[] = [];
  if (!tl.shots.some((s) => s.bg)) out.push("Click the shot bar in the Shots row, then Upload background or Generate background.");
  if (!tl.actors.length) out.push(readyChars(kit).length ? "Drag a character in from Cast on the left." : "Add a character in Cast, then drag it in from the left.");
  else if (!tl.actors.some((a) => a.actions.length)) out.push("Click the + beside an actor's name to give it something to do.");
  if (!tl.audio.length) out.push("Drag a track in from Sound and Music on the left (optional).");
  if (out.length) out.push("When “Ready to export” shows beside Next: Export, press it.");
  return out;
}

// The user's own PNG as this shot's background; a wide shot scales it up to cover the canvas.
function bgUpload(p: Project, tl: Timeline, id: string, apply: (r: EditResult) => void, kitChanged?: () => void): HTMLElement {
  const lab = Object.assign(document.createElement("label"), { className: "btn quiet", textContent: "Upload background" });
  const inp = Object.assign(document.createElement("input"), { type: "file", accept: "image/png", className: "pick" });
  inp.onchange = async () => {
    const f = inp.files?.[0];
    inp.value = "";
    if (!f) return;
    let img;
    try {
      img = await decode(f);
    } catch {
      return toast(`Could not read ${f.name}. Use a PNG image.`, "error");
    }
    const name = f.name.replace(/\.[^.]*$/, "").trim() || "background";
    let aid = name;
    for (let n = 2; p.kit.assets[aid]; n++) aid = `${name}_${n}`;
    const wide = find(tl, id)?.e.type === "wide";
    const path = freePath(p, "bg/", `${aid}.png`);
    p.files.set(path, f);
    p.kit.assets[aid] = { approved: true, source: "user", kind: wide ? "bg" : "backdrop", path };
    let r = setField(tl, id, "bg", aid);
    if (wide && !r.error) r = setField(r.tl, id, "bg_scale", coverScale(p.canvas, img));
    apply(r);
    kitChanged?.();
  };
  lab.append(inp);
  return lab;
}

// A PixelLab background for this wide shot, from a short description typed in the confirm.
function bgGenerate(p: Project, id: string, apply: (r: EditResult) => void, kitChanged?: () => void): HTMLElement {
  const b = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: "Generate background" });
  b.disabled = !pixellabKey();
  b.title = pixellabKey() ? "Describe the place; PixelLab paints it empty, seen from the side" : NO_KEY;
  b.onclick = async () => {
    b.disabled = true;
    await generateShotBg(p, id, (bg) => {
      let r = setField(p.tl!, id, "bg", bg);
      if (!r.error) r = setField(r.tl, id, "bg_scale", bgScale(p.canvas));
      apply(r);
      kitChanged?.();
    });
    b.disabled = false;
  };
  return b;
}

// Mouth shapes for this close-up's face: once made, every line its character speaks moves the mouth.
function lipSync(p: Project, face: string, expr: string, kitChanged?: () => void): HTMLElement {
  const piece = p.kit.faces[face]?.[expr];
  const b = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: piece?.mouths?.length ? "Redo lip-sync" : "Lip-sync this face" });
  const why = !pixellabKey() ? NO_KEY : !piece?.approved ? "Approve this face first" : "";
  b.disabled = !!why;
  b.title = why || "PixelLab draws 7 mouth shapes; the mouth then moves with every voice line or speech bubble of this character";
  b.onclick = async () => {
    b.disabled = true;
    if (await paid(`Lip-sync ${face}'s ${expr} face`, COST.mouths, 1, (k, t) => genMouthsInto(p, k, face, expr, t))) {
      toast("Mouth shapes made. Play the close-up to see it speak.");
      kitChanged?.();
    }
    b.disabled = false;
  };
  return b;
}

function cameraKeys(tl: Timeline, id: string, keys: CamKey[], now: () => number, apply: (r: EditResult) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "cam";
  wrap.innerHTML = `<div class="row between"><span class="small">Camera keys (t, x, y)</span><button class="btn quiet" type="button">+ Key at playhead</button></div>`;
  const set = (next: CamKey[]) => apply(setCamera(tl, id, next));
  keys.forEach((k, i) => {
    const row = document.createElement("div");
    row.className = "cam-key";
    for (const c of ["t", "x", "y"] as const) {
      const inp = Object.assign(document.createElement("input"), { type: "number", value: show(k[c]), step: c === "t" ? String(1 / 30) : "1" });
      inp.setAttribute("aria-label", `camera key ${i + 1} ${c}`);
      inp.onchange = () => {
        const n = Number(inp.value);
        if (inp.value.trim() === "" || !Number.isFinite(n)) return apply({ tl, error: "Camera keys need numbers." });
        set(keys.map((x, j) => (j === i ? { ...x, [c]: n } : x)));
      };
      row.append(inp);
    }
    const del = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: "Remove" });
    del.disabled = keys.length === 1;
    del.onclick = () => set(keys.filter((_, j) => j !== i));
    row.append(del);
    wrap.append(row);
  });
  wrap.querySelector<HTMLButtonElement>(".row button")!.onclick = () => {
    const last = keys[keys.length - 1] ?? { x: 0, y: 0 };
    const at = snap(now());
    set([...keys.filter((k) => Math.abs(k.t - at) > 1e-6), { t: at, x: last.x, y: last.y }]);
  };
  return wrap;
}
