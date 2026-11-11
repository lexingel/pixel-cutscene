import { missingReport } from "../core/missing";
import type { Project } from "../core/project";
import { words } from "./pixellab";

/** What the band says: null when there is no timeline or nothing in the scene, "Ready to export" at zero rows, else how many wait. */
export function bandState(rows: string[] | null, empty = false): { text: string; ready: boolean } | null {
  if (!rows || (empty && !rows.length)) return null;
  rows = rows.map(words);
  if (!rows.length) return { text: "Ready to export", ready: true };
  return { text: rows.length === 1 ? `1 piece waits for you: ${rows[0]}` : `${rows.length} pieces wait for you`, ready: false };
}

/** The next-step band in the top bar. Ready goes to Export (`onReady`); otherwise `onOpen`. Pass the existing button to update it in place (focus stays). */
export function nextBand(p: Project, onOpen: () => void, onReady: () => void = () => {}, b?: HTMLButtonElement): HTMLButtonElement {
  if (!b) {
    b = Object.assign(document.createElement("button"), { type: "button", className: "next-band" });
    b.setAttribute("data-testid", "next-band");
  }
  const empty = !!p.tl && !p.tl.actors.length && !p.tl.shots.some((x) => x.bg); // same test as Tweak's "Nothing in the scene yet"
  const s = bandState(p.tl ? missingReport(p.tl, p.kit, false, (k) => p.files.has(k)).map((r) => r.what) : null, empty);
  b.hidden = !s;
  b.classList.toggle("ready", !!s?.ready);
  const key = s ? `${s.ready}|${s.text}` : "";
  if (b.dataset.key !== key) { // rewrite only on a change: this sits in an aria-live region
    b.dataset.key = key;
    b.textContent = "";
    if (s) {
      if (!s.ready) b.append(Object.assign(document.createElement("span"), { textContent: "● " }), s.text);
      else b.append(s.text);
      b.firstElementChild?.setAttribute("aria-hidden", "true");
    }
  }
  b.title = s?.text ?? ""; // the whole line when the bar is too narrow and the band ends in an ellipsis
  if (s) b.onclick = s.ready ? onReady : onOpen;
  return b;
}
