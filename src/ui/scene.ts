import { sceneWidth } from "./pixelfit";
import { confirmPaid } from "../ai/confirm";
import { getKeys } from "../ai/keys";
import { draftScene } from "../ai/sceneDraft";
import { beatsToText, draftBeats, withBeats } from "../ai/beats";
import { mergeCast, pendingChars } from "../core/cast";
import { readyChars } from "../core/kit";
import { bakeDraftFx } from "../core/fxLibrary";
import { decode } from "./cast";
import type { SceneScale } from "../ai/scenePrompt";
import { CANVAS_SIZES, fromZip, setCanvas, type Project } from "../core/project";
import { addStarter, coverScale, startingBg } from "../core/starter";
import { toast } from "./dialogs";
import type { Step } from "./steps";

export const emptyTimeline = (): NonNullable<Project["tl"]> => ({
  name: "cutscene", duration: 10, shots: [{ id: "s1", type: "wide", start: 0, end: 10, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }], actors: [], fx: [], audio: [],
});

// Sizes the AI should place characters by: each ready character's idle frame, and the feet line already in use.
async function sceneScale(p: Project): Promise<SceneScale> {
  const sizes: NonNullable<SceneScale["sizes"]> = {};
  for (const c of readyChars(p.kit, (f) => p.files.has(f))) {
    const f = p.kit.chars[c].anims.idle?.frames[0], blob = f && p.files.get(f);
    if (blob) await decode(blob).then((i) => (sizes[c] = { w: i.w, h: i.h }), () => {});
  }
  const ground = p.tl?.shots.find((s) => s.type === "wide" && s.ground !== undefined);
  // ponytail: with no ground set yet, assume a backdrop whose floor is the bottom tenth of the frame
  return { sizes, feetY: ground?.type === "wide" ? ground.ground : Math.round(p.canvas.H * 0.9) };
}

// The scene at its own pixel size, shown at one fixed width: a smaller scene makes the same character bigger.
// It draws the background and one character the project already has, standing on the floor line.
async function peek(c: HTMLCanvasElement, p: Project): Promise<void> {
  const { W, H } = p.canvas;
  c.width = W; c.height = H;
  c.style.width = `${sceneWidth(W, c.parentElement!.clientWidth)}px`; // whole-number scale of the scene pixels (a reduction when wider than the box)
  c.parentElement!.querySelector("figcaption")!.textContent = `${W}×${H}, exported at ${W * p.canvas.exportScale}×${H * p.canvas.exportScale}`;
  const g = c.getContext("2d")!;
  g.fillStyle = "#16171b"; g.fillRect(0, 0, W, H);
  const shot = p.tl?.shots[0], bgId = (shot?.type === "wide" && shot.bg) || startingBg(p);
  const bgPath = bgId ? p.kit.assets[bgId]?.path : undefined;
  let floor = Math.round(H * 0.9);
  if (bgPath && p.files.has(bgPath)) {
    const bmp = await createImageBitmap(p.files.get(bgPath)!);
    const k = coverScale(p.canvas, { w: bmp.width, h: bmp.height }), g0 = p.kit.assets[bgId!].ground;
    g.imageSmoothingEnabled = false;
    g.drawImage(bmp, 0, 0, bmp.width * k, bmp.height * k);
    if (g0 !== undefined) floor = Math.round(g0 * k);
  } else {
    g.fillStyle = "#2a2c33"; g.fillRect(0, floor, W, H - floor);
  }
  const ch = readyChars(p.kit, (f) => p.files.has(f))[0], f = ch && p.kit.chars[ch].anims.idle?.frames[0];
  if (f && p.files.has(f)) {
    const bmp = await createImageBitmap(p.files.get(f)!);
    g.drawImage(bmp, Math.round(W * 0.3 - bmp.width / 2), floor - bmp.height);
  }
}

export function renderScene(root: HTMLElement, p: Project, changed: () => void, go: (n: Step) => void): void {
  root.innerHTML = `<section class="empty-page scene-page"><h1>Scene</h1>
    <figure class="scene-peek" data-cat="place"><span class="card-band" aria-hidden="true">Place · scene size</span><canvas class="px"></canvas><figcaption class="small"></figcaption>
    <label class="scene-size">Scene size <select data-act="size"></select><span class="small"></span></label></figure>
    <label class="scene-text">What happens in your cutscene? <textarea rows="8" data-testid="scene-text" placeholder="Three heroes walk into a cave. A ghost appears and they freeze..."></textarea></label>
    <div class="row"><button class="btn primary" type="button" data-act="draft">Draft it</button>
    <button class="btn" type="button" data-act="own">Write it myself</button>
    <button class="btn quiet" type="button" data-act="beats" title="First a short numbered list of what happens, to read and change; then the timeline from it">Plan the beats first</button></div>
    <p class="hint" data-testid="scene-hint"></p>
    <div class="beats" hidden><label class="scene-text">The beats, in order (change them freely: one per line) <textarea rows="6" data-testid="beats"></textarea></label>
    <div class="row"><button class="btn primary" type="button" data-act="from-beats">Draft the timeline from these beats</button></div></div>
    <p class="starter" hidden>No sprites yet? <button class="btn quiet" type="button" data-act="starter">Use the starter pack</button>
    <span class="small">a knight, a ranger, a dusk background, a campfire and calm music, free to use</span></p></section>`;
  const text = root.querySelector<HTMLTextAreaElement>("textarea")!;
  // the scene's pixel size: all export to 1920x1080, smaller = chunkier pixels and bigger characters
  const size = root.querySelector<HTMLSelectElement>("[data-act=size]")!;
  const NAMES = ["Small, chunky pixels", "Medium", "Large", "HD, fine pixels"];
  size.append(...CANVAS_SIZES.map((c, i) => Object.assign(document.createElement("option"), { value: String(i), textContent: `${NAMES[i]}: ${c.W}×${c.H}, ×${c.exportScale}` })));
  const { W: cw, H: ch, exportScale: ck } = p.canvas;
  const cur = CANVAS_SIZES.findIndex((c) => c.W === cw && c.H === ch && c.exportScale === ck);
  if (cur < 0) size.prepend(Object.assign(document.createElement("option"), { value: "", textContent: `${cw}×${ch}, ×${ck}` }));
  size.value = cur < 0 ? "" : String(cur);
  const locked = !!(p.tl?.actors.length || p.tl?.fx.length);
  size.disabled = locked;
  if (locked) { // the way back: the size frees up once the stage is empty again
    const open = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: "Open Tweak" });
    open.onclick = () => go(3);
    const why = Object.assign(document.createElement("p"), { className: "small unlock", textContent: "To change it, remove everyone and every effect in Tweak. " });
    why.append(open);
    size.closest("label")!.after(why);
  }
  size.nextElementSibling!.textContent = locked ? "Set before anyone is placed: positions are in scene pixels." : `Exports at ${cw * ck}×${ch * ck}. A smaller scene makes characters bigger on screen.`;
  const peekNow = () => void peek(root.querySelector<HTMLCanvasElement>(".scene-peek canvas")!, p);
  peekNow();
  size.onchange = () => {
    if (size.value && setCanvas(p, CANVAS_SIZES[Number(size.value)])) {
      changed();
      peekNow();
      size.nextElementSibling!.textContent = `Exports at ${p.canvas.W * p.canvas.exportScale}×${p.canvas.H * p.canvas.exportScale}. A smaller scene makes characters bigger on screen.`;
    }
  };
  const draft = root.querySelector<HTMLButtonElement>("[data-act=draft]")!;
  const own = root.querySelector<HTMLButtonElement>("[data-act=own]")!;
  const hint = root.querySelector<HTMLElement>(".hint")!;
  text.value = p.description;
  const hasKey = !!getKeys().ai;
  if (!hasKey) { // building by hand is the way in; drafting waits for a key
    draft.classList.remove("primary");
    own.classList.add("primary");
    own.after(draft);
    draft.textContent = "Draft it (needs an AI key)";
  }
  const sync = () => (draft.disabled = !hasKey || !text.value.trim());
  text.oninput = () => {
    p.description = text.value;
    sync();
    changed();
  };
  sync();
  hint.textContent = hasKey
    ? "The draft also names the characters your scene needs; the ones you don't have yet wait for you in Cast."
    : "No AI key? Press Write it myself and build the scene by hand in Tweak. (Draft it needs an AI key in Settings.)";

  const starter = root.querySelector<HTMLElement>(".starter")!;
  starter.hidden = readyChars(p.kit, (f) => p.files.has(f)).length > 0;
  const starterBtn = starter.querySelector<HTMLButtonElement>("button")!;
  starterBtn.onclick = async () => {
    starterBtn.disabled = true;
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}sample/sample.zip`);
      if (!r.ok) throw new Error();
      const pack = await fromZip(await r.blob());
      const added = addStarter(p, pack);
      // the pack is drawn for its own scene size; switched to it while nothing is placed yet
      const at = CANVAS_SIZES.findIndex((c) => c.W === pack.canvas.W && c.H === pack.canvas.H);
      if (added.length && at >= 0 && !size.disabled && setCanvas(p, CANVAS_SIZES[at])) size.value = String(at);
      changed();
      starter.hidden = true;
      toast(added.length ? `Added ${added.join(", ")}. Find them on the left in Tweak.` : "The starter pack is already in this project.");
    } catch {
      toast("Could not load the starter pack. Check your connection and try again.", "error");
      starterBtn.disabled = false;
    }
  };

  own.onclick = async () => {
    if (!p.tl) {
      p.tl = emptyTimeline();
      // the first shot starts on a background from the kit, if there is one, not on a black stage
      const bg = startingBg(p), shot = p.tl.shots[0];
      const img = bg ? await decode(p.files.get(p.kit.assets[bg].path)!).catch(() => null) : null;
      if (bg && img && shot.type === "wide") {
        const k = coverScale(p.canvas, img), g = p.kit.assets[bg].ground;
        Object.assign(shot, { bg, bg_scale: k }, g !== undefined ? { ground: g * k } : {});
      }
    }
    changed();
    go(3);
  };
  // step one of the two-step draft: a beat list to read and change (kept with the project)
  const beatsBtn = root.querySelector<HTMLButtonElement>("[data-act=beats]")!;
  const beatsBox = root.querySelector<HTMLElement>(".beats")!;
  const beatsText = beatsBox.querySelector<HTMLTextAreaElement>("textarea")!;
  const fromBeats = beatsBox.querySelector<HTMLButtonElement>("[data-act=from-beats]")!;
  const busy = (on: boolean) => {
    for (const b of [draft, own, beatsBtn, fromBeats]) b.disabled = on;
    text.disabled = beatsText.disabled = on;
    if (!on) sync();
  };
  beatsBtn.hidden = !hasKey;
  beatsText.value = p.beats ?? "";
  beatsBox.hidden = !hasKey || !p.beats;
  beatsText.oninput = () => ((p.beats = beatsText.value), changed());
  beatsBtn.onclick = async () => {
    const keys = getKeys();
    if (!keys.ai || !text.value.trim()) return void (hint.textContent = "Write what happens first, then plan its beats.");
    const ticket = await confirmPaid(keys.ai.provider, "plan the beats", "1 call: a short numbered list of what happens.", 1);
    if (!ticket) return;
    busy(true);
    hint.textContent = "Planning the beats...";
    const r = await draftBeats(keys, p.kit, p.description, ticket);
    busy(false);
    if (!r.ok) return void ((hint.textContent = `The plan failed: ${r.error}`), toast("The beat plan failed.", "error"));
    p.beats = beatsText.value = beatsToText(r.beats);
    beatsBox.hidden = false;
    hint.textContent = "Read the beats, change what you like, then draft the timeline from them.";
    changed();
    beatsText.focus();
  };
  fromBeats.onclick = () => (beatsText.value.trim() ? runDraft(withBeats(p.description, beatsText.value)) : void (hint.textContent = "The beat list is empty."));
  draft.onclick = () => runDraft(p.description);
  async function runDraft(description: string) {
    const keys = getKeys();
    if (!keys.ai) return;
    const ticket = await confirmPaid(keys.ai.provider, "draft scene", "About 1 call, 2 if it needs a repair.", 2);
    if (!ticket) return;
    busy(true);
    hint.textContent = "Drafting your scene...";
    const r = await draftScene(keys, p.kit, p.canvas, description, p.tl, ticket, undefined, await sceneScale(p));
    busy(false);
    if (!r.ok) {
      hint.textContent = `The draft failed: ${r.error}. Your current timeline is unchanged.`;
      return toast("The scene draft failed.", "error");
    }
    p.tl = r.tl;
    mergeCast(p, r.cast);
    // library effects the draft named ("fire/fire-breath") are baked now, so they play instead of waiting in Needs approval
    await bakeDraftFx(p).catch(() => toast("Some effects could not be prepared; they wait in Needs approval.", "error"));
    changed();
    go(pendingChars(p).length ? 1 : 3);
  }
}
