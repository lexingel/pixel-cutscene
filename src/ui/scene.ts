import { confirmPaid } from "../ai/confirm";
import { getKeys } from "../ai/keys";
import { draftScene } from "../ai/sceneDraft";
import { mergeCast, pendingChars } from "../core/cast";
import { readyChars } from "../core/kit";
import { bakeDraftFx } from "../core/fxLibrary";
import { decode } from "./cast";
import type { SceneScale } from "../ai/scenePrompt";
import { CANVAS_SIZES, setCanvas, type Project } from "../core/project";
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

export function renderScene(root: HTMLElement, p: Project, changed: () => void, go: (n: Step) => void): void {
  root.innerHTML = `<section class="empty-page"><h1>Scene</h1>
    <label class="scene-text">What happens in your cutscene? <textarea rows="8" data-testid="scene-text" placeholder="Three heroes walk into a cave. A ghost appears and they freeze..."></textarea></label>
    <label class="scene-size">Scene size <select data-act="size"></select><span class="small"></span></label>
    <div class="row"><button class="btn primary" type="button" data-act="draft">Draft it</button>
    <button class="btn" type="button" data-act="own">Write it myself</button></div>
    <p class="hint" data-testid="scene-hint"></p></section>`;
  const text = root.querySelector<HTMLTextAreaElement>("textarea")!;
  // the scene's pixel size: all export to 1920x1080, smaller = chunkier pixels and bigger characters
  const size = root.querySelector<HTMLSelectElement>("[data-act=size]")!;
  const NAMES = ["Small, chunky pixels", "Medium", "Large", "HD, fine pixels"];
  size.append(...CANVAS_SIZES.map((c, i) => Object.assign(document.createElement("option"), { value: String(i), textContent: `${NAMES[i]}: ${c.W}×${c.H}, ×${c.exportScale}` })));
  const cur = CANVAS_SIZES.findIndex((c) => c.W === p.canvas.W && c.H === p.canvas.H);
  if (cur < 0) size.prepend(Object.assign(document.createElement("option"), { value: "", textContent: `${p.canvas.W}×${p.canvas.H}` }));
  size.value = cur < 0 ? "" : String(cur);
  const locked = !!(p.tl?.actors.length || p.tl?.fx.length);
  size.disabled = locked;
  size.nextElementSibling!.textContent = locked ? "Set before anyone is placed: positions are in scene pixels." : "Exports at 1920×1080. A smaller scene makes characters bigger on screen.";
  size.onchange = () => {
    if (size.value && setCanvas(p, CANVAS_SIZES[Number(size.value)])) changed();
  };
  const draft = root.querySelector<HTMLButtonElement>("[data-act=draft]")!;
  const own = root.querySelector<HTMLButtonElement>("[data-act=own]")!;
  const hint = root.querySelector<HTMLElement>(".hint")!;
  text.value = p.description;
  const hasKey = !!getKeys().ai;
  const sync = () => (draft.disabled = !hasKey || !text.value.trim());
  text.oninput = () => {
    p.description = text.value;
    sync();
    changed();
  };
  sync();
  hint.textContent = hasKey
    ? "The draft also names the characters your scene needs; the ones you don't have yet wait for you in ② Cast."
    : "No AI key? Press Write it myself and build the scene by hand in ③ Tweak. (Draft it needs an AI key in Settings.)";

  own.onclick = () => {
    p.tl ??= emptyTimeline();
    changed();
    go(3);
  };
  draft.onclick = async () => {
    const keys = getKeys();
    if (!keys.ai) return;
    const ticket = await confirmPaid(keys.ai.provider, "draft scene", "About 1 call, 2 if it needs a repair.", 2);
    if (!ticket) return;
    draft.disabled = own.disabled = text.disabled = true;
    hint.textContent = "Drafting your scene...";
    const r = await draftScene(keys, p.kit, p.canvas, p.description, p.tl, ticket, undefined, await sceneScale(p));
    draft.disabled = own.disabled = text.disabled = false;
    sync();
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
  };
}
