// Size suggestions for generated characters: a creature's size category, in feet (middle of each range),
// against the heroes, who are Medium.
import type { Img, SizeName } from "./kit";
import type { Project } from "./project";

export const SIZE_FT: Record<SizeName, number> = { tiny: 2.75, small: 3.5, medium: 6, large: 12, huge: 24, gargantuan: 50 };
export const SIZE_NAMES = Object.keys(SIZE_FT) as SizeName[];

const round4 = (n: number) => Math.max(16, Math.round(n / 4) * 4);

// The tallest idle frame-0 among Medium characters that are drawn 1:1; 48 when there are none.
export function mediumHeight(p: Project, img: (path: string) => Img | null): number {
  let h = 0;
  for (const c of Object.values(p.kit.chars)) {
    if (c.scale || (c.size && c.size !== "medium")) continue;
    const f = c.anims.idle?.frames[0];
    h = Math.max(h, (f && img(f)?.h) || 0);
  }
  return h || 48;
}

// What to ask PixelLab for. Past 256 px (its limit) the creature is drawn at half size and shown at 2x.
export function sizePlan(size: SizeName, mediumPx: number): { genPx: number; scale: 1 | 2 } {
  const px = round4((mediumPx * SIZE_FT[size]) / 6);
  return px > 256 ? { genPx: Math.min(256, round4(px / 2)), scale: 2 } : { genPx: px, scale: 1 };
}
