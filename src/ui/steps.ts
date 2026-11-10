import type { Project } from "../core/project";

export type Step = Project["step"];
// Shown Scene first; the stored numbers stay 1 Cast, 2 Scene so saved projects reopen where they were.
export const STEPS: { n: Step; label: string }[] = [
  { n: 2, label: "① Scene" },
  { n: 1, label: "② Cast" },
  { n: 3, label: "③ Tweak" },
  { n: 4, label: "④ Export" },
];

// Every step stays clickable; the current one is marked aria-current.
export function stepBar(current: Step, pick: (n: Step) => void): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "steps";
  nav.setAttribute("aria-label", "Steps");
  STEPS.forEach(({ n, label }, i) => {
    if (i) nav.append(Object.assign(document.createElement("span"), { className: "arrow", textContent: "→", ariaHidden: "true" }));
    const b = Object.assign(document.createElement("button"), { className: "step", textContent: label, type: "button" });
    if (n === current) b.setAttribute("aria-current", "step");
    b.onclick = () => pick(n);
    nav.append(b);
  });
  return nav;
}
