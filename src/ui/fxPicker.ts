import { FX_LIST, fxThumb } from "../core/fxLibrary";
import { paintThumb, thumbCanvas } from "./drawer";

/** A dialog listing the effect library (search + category); resolves to the chosen effect id, or null. */
export function pickFx(title = "Effect library"): Promise<string | null> {
  const d = document.createElement("dialog");
  d.className = "dialog music-picker";
  d.setAttribute("aria-label", title);
  d.innerHTML = `<form method="dialog"><h2></h2><div class="row"><input type="search" placeholder="Search effects" aria-label="Search effects" class="grow" />
    <select aria-label="Effect category"></select></div><ul class="music-list fx-pick"></ul>
    <div class="row end"><button value="cancel" class="btn">Close</button></div></form>`;
  d.querySelector("h2")!.textContent = title;
  const q = d.querySelector("input")!, sel = d.querySelector("select")!, list = d.querySelector("ul")!;
  sel.append(...["", ...new Set(FX_LIST.map((f) => f.category))].map((c) => Object.assign(document.createElement("option"), { value: c, textContent: c || "All effects" })));
  let chosen: string | null = null;
  const seen = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      void fxThumb((e.target as HTMLElement).dataset.fx!).then((img) => paintThumb(e.target.querySelector("canvas")!, img)).catch(() => {});
    }
  });
  const rows = FX_LIST.map((f) => {
    const li = document.createElement("li");
    li.dataset.fx = f.id;
    const name = Object.assign(document.createElement("div"), { className: "grow" });
    name.innerHTML = `<strong></strong><div class="small"></div>`;
    name.querySelector("strong")!.textContent = f.name;
    name.querySelector(".small")!.textContent = f.category;
    const use = Object.assign(document.createElement("button"), { type: "button", className: "btn primary", textContent: "Use" });
    use.setAttribute("aria-label", `Use ${f.name}`);
    use.onclick = () => ((chosen = f.id), d.close());
    li.append(thumbCanvas(), name, use);
    seen.observe(li);
    return li;
  });
  list.append(...rows);
  const filter = () => {
    const s = q.value.trim().toLowerCase();
    FX_LIST.forEach((f, i) => (rows[i].hidden = (!!sel.value && f.category !== sel.value) || (!!s && !f.name.includes(s) && !f.category.includes(s))));
  };
  q.oninput = sel.onchange = filter;
  document.body.append(d);
  d.showModal();
  return new Promise((res) => d.addEventListener("close", () => (seen.disconnect(), d.remove(), res(chosen))));
}
