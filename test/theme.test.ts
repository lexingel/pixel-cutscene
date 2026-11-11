import { describe, expect, it } from "vitest";
import { getTheme, nextTheme, setTheme } from "../src/ui/theme";

const el = () => ({ dataset: {} as Record<string, string> }) as unknown as HTMLElement;
const store = (init: Record<string, string> = {}) => ({
  m: { ...init } as Record<string, string>,
  getItem(k: string) { return this.m[k] ?? null; },
  setItem(k: string, v: string) { this.m[k] = v; },
  removeItem(k: string) { delete this.m[k]; },
});

describe("theme", () => {
  it("getTheme reads the store, falls back to auto", () => {
    expect(getTheme(store())).toBe("auto");
    expect(getTheme(store({ "pc.theme": "light" }))).toBe("light");
    expect(getTheme(store({ "pc.theme": "junk" }))).toBe("auto");
    expect(getTheme({ getItem() { throw new Error("blocked"); } })).toBe("auto");
  });
  it("nextTheme flips what is showing", () => {
    expect(nextTheme("auto", true)).toBe("light");
    expect(nextTheme("auto", false)).toBe("dark");
    expect(nextTheme("light", true)).toBe("dark");
    expect(nextTheme("dark", false)).toBe("light");
  });
  it("setTheme sets and clears attribute + store", () => {
    const e = el(), s = store();
    setTheme("light", e, s);
    expect(e.dataset.theme).toBe("light");
    expect(s.m["pc.theme"]).toBe("light");
    setTheme("auto", e, s);
    expect(e.dataset.theme).toBeUndefined();
    expect(s.m["pc.theme"]).toBeUndefined();
  });
});
