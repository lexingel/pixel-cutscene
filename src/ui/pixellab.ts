// PixelLab in the UI: the character door (candidates → pick → approve → idle → approve) and the
// Generate buttons of the Needs-approval list. Every paid call is minted here through confirmPaid.
import { confirmPaid, type PaidTicket } from "../ai/confirm";
import { getKeys } from "../ai/keys";
import type { Img, SizeName } from "../core/kit";
import type { Project } from "../core/project";
import { SIZE_NAMES, mediumHeight, sizePlan } from "../core/sizes";
import { confirmDialog } from "./dialogs";
import {
  COST, MOTION, SIZES, approvePiece, approveRef, balance, genAnimInto, genBackgroundInto, genCharacter, genFaceInto, refPath, type At,
} from "../gen/pixellab";
import { decode, encode } from "./cast";
import { toast } from "./dialogs";

export const NO_KEY = "Add a PixelLab key in Settings to generate.";
export const pixellabKey = () => getKeys().pixellab;

// The ordinary confirm plus a labelled text box above its buttons.
const askWithMotion = (motion: { text: string }): typeof confirmDialog => (...a) => {
  const res = confirmDialog(...a);
  const d = document.body.lastElementChild!;
  const box = Object.assign(document.createElement("textarea"), { rows: 3, value: motion.text });
  box.setAttribute("aria-label", "Motion prompt");
  box.oninput = () => (motion.text = box.value);
  d.querySelector("p")!.after(box);
  return res;
};

// Confirm (with the live balance in the note), then run. False when cancelled or failed; a failure changes nothing.
// `motion`: a text box in the confirm holds the animation prompt; the user's edit lands in motion.text before `run`.
export async function paid(
  action: string, cost: string, calls: number, run: (key: string, t: PaidTicket) => Promise<void>, motion?: { text: string },
): Promise<boolean> {
  const key = pixellabKey();
  if (!key) return toast(NO_KEY, "error"), false;
  const bal = await balance(key).then((b) => b.text, () => "could not be read");
  const t = await confirmPaid("pixellab", action, `${cost} Your balance: ${bal}.`, calls, motion ? askWithMotion(motion) : confirmDialog);
  if (!t) return false;
  try {
    await run(key, t);
    return true;
  } catch (e) {
    toast((e as Error).message, "error");
    return false;
  }
}

// Disables every control in `el` while `run` is in flight, so nothing can be approved or re-run meanwhile.
export async function busy<T>(el: HTMLElement, run: () => Promise<T>): Promise<T> {
  const ctl = [...el.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select")];
  const was = ctl.map((c) => c.disabled);
  ctl.forEach((c) => (c.disabled = true));
  try {
    return await run();
  } finally {
    ctl.forEach((c, i) => (c.disabled = was[i]));
  }
}

const words = (id: string) => id.replace(/[_-]+/g, " ").trim();

// What a Needs-approval Generate button would make, or why it cannot.
export function genPlan(p: Project, t: At & { asset?: string }): { label: string; why?: string } {
  if (!pixellabKey()) return { label: "Generate", why: NO_KEY };
  const char = t.kind === "anim" ? t.char : t.kind === "face" ? t.face : "";
  const hasRef = p.files.has(refPath(char)) || !!p.kit.chars[char]?.anims.idle?.frames.length;
  if (t.kind === "anim" && !hasRef) return { label: "Generate", why: `${char} needs a reference first: generate it in ② Cast or upload its idle frames` };
  if (t.kind === "face" && !hasRef) return { label: "Generate", why: `${char} needs idle frames before it can get a face` };
  if (t.kind === "asset" && t.asset !== "bg") return { label: "Generate", why: "Effects and sounds are generated in a later update" };
  return { label: "Generate" };
}

export function generate(p: Project, t: At & { asset?: string }, done: () => void): Promise<boolean> {
  const note = p.description.trim();
  // attack and breathe are written out in a prompt the user may edit before paying
  const motion = t.kind === "anim" && (t.anim === "attack" || t.anim === "breathe") ? { text: MOTION[t.anim] } : undefined;
  const ok =
    t.kind === "anim" ? paid(`Generate ${t.char} ${t.anim}`, COST.anim, 1, (k, tk) => genAnimInto(p, k, t.char, t.anim, "", tk, undefined, motion?.text.trim() || undefined), motion)
    : t.kind === "face" ? paid(`Generate ${t.face}'s ${t.expr} face`, COST.face, 1, (k, tk) => genFaceInto(p, k, t.face, t.expr, tk))
    : paid(`Generate background ${t.id}`, COST.background, 1, (k, tk) =>
        genBackgroundInto(p, k, t.id, `side-view game background, ${words(t.id)}${note ? `. Scene: ${note.slice(0, 600)}` : ""}`, tk));
  return ok.then((r) => (r && (toast("Generated. Look it over, then Approve or Redo."), done()), r));
}

const imgEl = async (img: Img, urls: string[], cls = "px frame") => {
  const src = URL.createObjectURL(await encode(img));
  urls.push(src);
  return Object.assign(document.createElement("img"), { src, alt: "", className: cls });
};

/** The "Generate with PixelLab" panel. `resume` reopens a character whose idle is not approved yet;
 * `preset` fixes the name and prefills the description (a character the scene asked for). */
export function renderGenChar(
  main: HTMLElement, p: Project, changed: () => void, done: (name: string) => void, resume?: string, preset?: { name: string; desc: string },
): void {
  let urls: string[] = [];
  const clear = () => (urls.forEach(URL.revokeObjectURL), (urls = []));
  let name = resume ?? "";
  let desc = "";
  let size = 64;
  let sugg: { size: SizeName; scale: 1 | 2 } | null = null; // a size picked from the suggestions
  let cands: Img[] = [];
  let pick = -1;

  main.innerHTML = `<header><h1>Generate with PixelLab</h1><p class="hint">Describe a side-view character, pick one of four, approve it, then approve its idle animation.</p></header>
    <div class="fields gen-form"></div><div class="gen-body"></div>`;
  const form = main.querySelector<HTMLElement>(".gen-form")!;
  const body = main.querySelector<HTMLElement>(".gen-body")!;

  if (!resume) {
    form.innerHTML = `<label class="field">Character name <input name="name" autocomplete="off" placeholder="knight" /></label>
      <label class="field">Description <input name="desc" autocomplete="off" placeholder="a knight in dented armour with a red cape" /></label>
      <label class="field">Size <select name="size">${SIZES.map((s) => `<option value="${s}">${s} px</option>`).join("")}</select></label>
      <p class="small size-note"></p>
      <details class="size-sugg"><summary>Suggest a size…</summary><div class="row wrap"></div></details>
      <div class="row end foot"><button class="btn primary" type="button" data-act="cands">Generate 4 candidates</button></div>`;
    const f = (n: string) => form.querySelector<HTMLInputElement>(`[name=${n}]`)!;
    const sel = form.querySelector<HTMLSelectElement>("[name=size]")!;
    const note = form.querySelector<HTMLElement>(".size-note")!;
    const menu = form.querySelector<HTMLElement>(".size-sugg .row")!;
    sel.value = String(size);
    const showNote = () => (note.textContent = sugg?.scale === 2 ? `Will be drawn about ${size * 2} px tall, shown at 2×` : "");
    // heights are measured against the heroes: the Medium characters already in the cast
    let mediumPx = 48;
    const drawMenu = () =>
      menu.replaceChildren(
        ...SIZE_NAMES.map((n) => {
          const plan = sizePlan(n, mediumPx);
          const b = Object.assign(document.createElement("button"), {
            type: "button", className: "btn quiet", textContent: `${n[0].toUpperCase()}${n.slice(1)} · about ${plan.genPx * plan.scale} px`,
          });
          b.onclick = () => {
            const { genPx, scale } = sizePlan(n, mediumPx);
            if (![...sel.options].some((o) => o.value === String(genPx))) {
              const o = Object.assign(document.createElement("option"), { value: String(genPx), textContent: `${genPx} px` });
              sel.insertBefore(o, [...sel.options].find((x) => Number(x.value) > genPx) ?? null);
            }
            sel.value = String(genPx);
            size = genPx;
            sugg = { size: n, scale };
            showNote();
          };
          return b;
        }),
      );
    drawMenu();
    sel.onchange = () => ((sugg = null), (size = Number(sel.value)), showNote()); // by hand: the suggestion is dropped
    (async () => {
      const imgs = new Map<string, Img>();
      for (const c of Object.values(p.kit.chars)) {
        const path = c.anims.idle?.frames[0];
        const blob = path && p.files.get(path);
        if (path && blob) imgs.set(path, await decode(blob));
      }
      if (!form.isConnected) return; // the form was closed while the cast was measured
      mediumPx = mediumHeight(p, (path) => imgs.get(path) ?? null);
      drawMenu();
    })().catch(() => {});
    if (preset) {
      f("name").value = preset.name;
      f("name").readOnly = true;
      f("desc").value = preset.desc;
    }
    form.querySelector<HTMLButtonElement>("[data-act=cands]")!.onclick = () => candidates();
    const candidates = async () => {
      name = f("name").value.trim();
      desc = f("desc").value.trim();
      size = Number(f("size").value);
      if (!name || /[/\\]/.test(name)) return toast("Give the character a name without slashes.", "error");
      if (p.kit.chars[name]) return toast(`${name} is already in the cast. Pick another name.`, "error");
      if (!desc) return toast("Describe the character first.", "error");
      const ok = await busy(main, () => paid(`Generate 4 candidates for ${name}`, COST.character, 4, async (k, t) => {
        cands = await genCharacter(k, desc, size, t);
      }));
      if (ok) (pick = -1), drawCands();
    };
  } else form.remove();

  async function drawCands() {
    clear();
    body.innerHTML = `<h2>Pick one</h2><div class="candidates" role="group" aria-label="Candidates"></div>
      <div class="row end"><button class="btn quiet" type="button" data-act="redo">Redo</button>
      <button class="btn primary" type="button" data-act="approve" disabled>Approve this one</button></div>`;
    const grid = body.querySelector<HTMLElement>(".candidates")!;
    const approve = body.querySelector<HTMLButtonElement>("[data-act=approve]")!;
    for (const [i, c] of cands.entries()) {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "cand" });
      b.setAttribute("aria-label", `Candidate ${i + 1}`);
      b.setAttribute("aria-pressed", String(i === pick));
      b.append(await imgEl(c, urls));
      b.onclick = () => {
        pick = i;
        grid.querySelectorAll(".cand").forEach((x, j) => x.setAttribute("aria-pressed", String(j === i)));
        approve.disabled = false;
      };
      grid.append(b);
    }
    body.querySelector<HTMLButtonElement>("[data-act=redo]")!.onclick = () => form.querySelector<HTMLButtonElement>("[data-act=cands]")!.click();
    approve.onclick = async () => {
      try {
        await approveRef(p, name, cands[pick], undefined, sugg ? { size: sugg.size, scale: sugg.scale === 2 ? 2 : undefined } : {});
      } catch (e) {
        return toast((e as Error).message, "error");
      }
      form.remove();
      changed();
      drawIdle();
    };
  }

  function drawIdle() {
    clear();
    const idle = p.kit.chars[name]?.anims.idle;
    body.innerHTML = `<h2></h2><div class="strip"></div><p class="hint"></p><div class="row end acts"></div>`;
    body.querySelector("h2")!.textContent = idle ? `${name}: idle` : name;
    body.querySelector(".hint")!.textContent = idle
      ? "Approve the idle to use this character in scenes, or Redo it."
      : "Approved. Next, its idle animation. The character can be used once its idle is approved.";
    const strip = body.querySelector<HTMLElement>(".strip")!;
    for (const path of idle?.frames ?? [refPath(name)]) {
      const blob = p.files.get(path);
      if (!blob) continue;
      const src = URL.createObjectURL(blob);
      urls.push(src);
      strip.append(Object.assign(document.createElement("img"), { src, alt: "", className: "px frame" }));
    }
    const acts = body.querySelector<HTMLElement>(".acts")!;
    const btn = (text: string, cls: string, on: () => void) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: `btn ${cls}`, textContent: text });
      b.onclick = on;
      acts.append(b);
    };
    const gen = async () => {
      if (await busy(main, () => paid(`Generate ${name}'s idle`, COST.anim, 1, (k, t) => genAnimInto(p, k, name, "idle", desc, t)))) changed(), drawIdle();
    };
    if (!idle) return btn("Generate idle", "primary", gen);
    btn("Redo", "quiet", gen);
    btn("Approve", "primary", () => {
      approvePiece(p.kit, { kind: "anim", char: name, anim: "idle" });
      changed();
      clear();
      done(name);
    });
  }

  if (resume) drawIdle();
}
