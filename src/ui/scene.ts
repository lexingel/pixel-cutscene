import { confirmPaid } from "../ai/confirm";
import { getKeys } from "../ai/keys";
import { draftScene } from "../ai/sceneDraft";
import { mergeCast, pendingChars } from "../core/cast";
import type { Project } from "../core/project";
import { toast } from "./dialogs";
import type { Step } from "./steps";

export const emptyTimeline = (): NonNullable<Project["tl"]> => ({
  name: "cutscene", duration: 10, shots: [{ id: "s1", type: "wide", start: 0, end: 10, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }], actors: [], fx: [], audio: [],
});

export function renderScene(root: HTMLElement, p: Project, changed: () => void, go: (n: Step) => void): void {
  root.innerHTML = `<section class="empty-page"><h1>Scene</h1>
    <label class="scene-text">What happens in your cutscene? <textarea rows="8" data-testid="scene-text" placeholder="Three heroes walk into a cave. A ghost appears and they freeze..."></textarea></label>
    <div class="row"><button class="btn primary" type="button" data-act="draft">Draft it</button>
    <button class="btn" type="button" data-act="own">Write it myself</button></div>
    <p class="hint" data-testid="scene-hint"></p></section>`;
  const text = root.querySelector<HTMLTextAreaElement>("textarea")!;
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
    const r = await draftScene(keys, p.kit, p.canvas, p.description, p.tl, ticket);
    draft.disabled = own.disabled = text.disabled = false;
    sync();
    if (!r.ok) {
      hint.textContent = `The draft failed: ${r.error}. Your current timeline is unchanged.`;
      return toast("The scene draft failed.", "error");
    }
    p.tl = r.tl;
    mergeCast(p, r.cast);
    changed();
    go(pendingChars(p).length ? 1 : 3);
  };
}
