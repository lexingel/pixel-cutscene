import { animStatus, type Img, type Kit } from "./kit";
import { scale2x } from "./scale2x";

const doubled = new WeakMap<Img, Img>(); // Scale2x once per loaded frame, so preview and export draw the same pixels

/** The frames pose() takes: [] when missing or not usable; a `scale: 2` character's frames come Scale2x-doubled. */
export function charFrames(
  kit: Kit, img: (path: string) => Img | null, draft: boolean, has: (path: string) => boolean,
): (char: string, anim: string) => Img[] {
  return (char, anim) => {
    if (animStatus(kit, char, anim, draft, has) !== "ok") return [];
    const c = kit.chars[char];
    return c.anims[anim].frames.map((f) => {
      const i = img(f)!;
      if (c.scale !== 2) return i;
      let d = doubled.get(i);
      if (!d) doubled.set(i, (d = scale2x(i)));
      return d;
    });
  };
}
