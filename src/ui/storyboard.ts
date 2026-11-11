// The Storyboard window: every shot as a picture of its first frame, in order. Click one to jump there; drag one
// (or use its arrows) to move it, with everything that happens in it.
import type { Img } from "../core/kit";
import { shotName } from "../core/labels";
import type { Timeline } from "../core/types";
import { moveShot, type EditResult } from "./timelineEditor";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const sec = (n: number) => `${n.toFixed(1)}s`;

/** `thumb` draws the scene at time t; `apply` commits a reorder (one undo step each); `seek` moves the playhead. */
export function openStoryboard(get: () => Timeline, thumb: (tl: Timeline, t: number) => Img, apply: (r: EditResult) => void, seek: (t: number) => void): void {
  const d = document.createElement("dialog");
  d.className = "dialog storyboard";
  d.setAttribute("aria-labelledby", "dlg-sb-h");
  d.innerHTML = `<form method="dialog"><h2 id="dlg-sb-h">Storyboard</h2>
    <p class="small">Every shot, in order. Click one to go there; drag it, or use its arrows, to move it with everything in it.</p>
    <ol class="sb-grid"></ol>
    <div class="row end"><button value="close" class="btn primary">Done</button></div></form>`;
  const grid = d.querySelector<HTMLOListElement>(".sb-grid")!;
  let dragFrom = -1;
  const move = (from: number, to: number) => {
    const r = moveShot(get(), from, to);
    if (r.error || r.tl === get()) return;
    apply(r);
    draw();
    grid.querySelector<HTMLElement>(`li[data-i="${to}"] .sb-card`)?.focus();
  };
  function draw() {
    const T = get();
    grid.innerHTML = T.shots.map((s, i) => `<li data-i="${i}" draggable="true">
      <button type="button" class="sb-card" data-go="${i}" aria-label="Go to ${esc(shotName(T, s.id))}, ${sec(s.start)} to ${sec(s.end)}"><canvas class="px" width="1" height="1"></canvas>
        <span class="sb-name">${i + 1}. ${esc(shotName(T, s.id))}</span><span class="small muted">${sec(s.start)}–${sec(s.end)}</span></button>
      <span class="sb-move"><button type="button" class="btn quiet icon" data-mv="-1" aria-label="Move ${esc(shotName(T, s.id))} earlier"${i === 0 ? " disabled" : ""}>◀</button><button type="button" class="btn quiet icon" data-mv="1" aria-label="Move ${esc(shotName(T, s.id))} later"${i === T.shots.length - 1 ? " disabled" : ""}>▶</button></span></li>`).join("");
    grid.querySelectorAll("canvas").forEach((c, i) => {
      const s = T.shots[i];
      const img = thumb(T, Math.min(s.start + (s.transition?.dur ?? 0), s.end - 1e-3)); // past its way in
      [c.width, c.height] = [img.w, img.h];
      c.getContext("2d")!.putImageData(new ImageData(img.px, img.w, img.h), 0, 0);
    });
  }
  grid.onclick = (e) => {
    const el = e.target as HTMLElement, li = el.closest<HTMLElement>("li");
    if (!li) return;
    const i = Number(li.dataset.i), mv = el.closest<HTMLElement>("[data-mv]");
    if (mv) return move(i, i + Number(mv.dataset.mv));
    if (el.closest("[data-go]")) {
      seek(get().shots[i].start);
      d.close();
    }
  };
  grid.ondragstart = (e) => {
    dragFrom = Number((e.target as HTMLElement).closest<HTMLElement>("li")?.dataset.i ?? -1);
    e.dataTransfer?.setData("text/plain", String(dragFrom));
  };
  grid.ondragover = (e) => dragFrom >= 0 && e.preventDefault();
  grid.ondrop = (e) => {
    e.preventDefault();
    const li = (e.target as HTMLElement).closest<HTMLElement>("li");
    if (li && dragFrom >= 0) move(dragFrom, Number(li.dataset.i));
    dragFrom = -1;
  };
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  draw();
  d.showModal();
}
