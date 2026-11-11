import type { Project } from "../core/project";

export type Step = Project["step"];
// Shown Scene first; the stored numbers stay 1 Cast, 2 Scene so saved projects reopen where they were.
export const STEPS: { n: Step; label: string }[] = [
  { n: 2, label: "Scene" },
  { n: 1, label: "Cast" },
  { n: 3, label: "Tweak" },
  { n: 4, label: "Export" },
];

// Every step stays clickable; the current one is marked aria-current.
export function stepBar(current: Step, pick: (n: Step) => void): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "steps";
  nav.setAttribute("aria-label", "Steps");
  STEPS.forEach(({ n, label }, i) => {
    const b = Object.assign(document.createElement("button"), { className: "step", type: "button" });
    b.innerHTML = `<span class="n" aria-hidden="true">${i + 1}</span>`;
    b.append(label);
    if (n === current) b.setAttribute("aria-current", "step");
    b.onclick = () => pick(n);
    nav.append(b);
  });
  return nav;
}
