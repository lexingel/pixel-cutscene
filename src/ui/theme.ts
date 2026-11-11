export type Theme = "dark" | "light" | "auto";
const KEY = "pc.theme";

/** Saved choice; "auto" (follow the OS) when nothing valid is stored or storage is blocked. */
export function getTheme(store?: Pick<Storage, "getItem">): Theme {
  try {
    const v = (store ?? localStorage).getItem(KEY);
    return v === "dark" || v === "light" ? v : "auto";
  } catch { return "auto"; }
}

/** Apply and remember a theme; "auto" clears both so prefers-color-scheme decides. */
export function setTheme(
  t: Theme,
  root: HTMLElement = document.documentElement,
  store?: Pick<Storage, "setItem" | "removeItem">,
): void {
  if (t === "auto") delete root.dataset.theme; else root.dataset.theme = t;
  try {
    const s = store ?? localStorage;
    if (t === "auto") s.removeItem(KEY); else s.setItem(KEY, t);
  } catch { /* storage blocked: the attribute still applies for this visit */ }
}

/** What a toggle click should switch to, given what is currently showing. */
export function nextTheme(t: Theme, prefersDark: boolean): "dark" | "light" {
  const showing = t === "auto" ? (prefersDark ? "dark" : "light") : t;
  return showing === "dark" ? "light" : "dark";
}
