import { pose, shotAt } from "./acting";
import { camAt } from "./cam";
import { charFrames } from "./frames";
import { actorName, shotNumber } from "./labels";
import type { Img, Kit } from "./kit";
import type { Timeline } from "./types";

export type FrameIssue = { id: string; msg: string; at: number; fill?: number };

const list = (s: string[]) => (s.length > 1 ? `${s.slice(0, -1).join(", ")} and ${s[s.length - 1]}` : s[0]);

/** Black gaps around wide-shot backgrounds, and actors left cut by a frame edge for a second or more. */
export function framingIssues(tl: Timeline, kit: Kit, img: (path: string) => Img | null, W: number, H: number): FrameIssue[] {
  const out: FrameIssue[] = [];
  for (const s of tl.shots) {
    if (s.type !== "wide" || !s.bg) continue;
    const bg = kit.assets[s.bg] ? img(kit.assets[s.bg].path) : null;
    if (!bg) continue;
    const k = s.bg_scale ?? 1;
    // smoothstep between keys never overshoots, so the keys hold the extremes
    const cams = (s.camera.length ? s.camera : [{ t: s.start, x: 0, y: 0 }]).map((c) => camAt([c], 0));
    const xs = cams.map((c) => c.x), ys = cams.map((c) => c.y);
    const maxX = Math.max(...xs), maxY = Math.max(...ys);
    const sides = [
      ...(Math.min(...xs) < 0 ? ["left"] : []), ...(Math.min(...ys) < 0 ? ["top"] : []),
      ...(bg.w * k - maxX < W ? ["right"] : []), ...(bg.h * k - maxY < H ? ["bottom"] : []),
    ];
    if (!sides.length) continue;
    const scalable = sides.some((x) => x === "right" || x === "bottom");
    const camFix = sides.some((x) => x === "left" || x === "top");
    out.push({
      id: s.id, at: s.start,
      msg: `${shotNumber(tl, s.id)}: the background leaves black at the ${list(sides)}${camFix ? ". Move the camera keys to x and y 0 or more" : ""}.`,
      ...(scalable ? { fill: Math.max(k, Math.ceil((W + Math.max(maxX, 0)) / bg.w), Math.ceil((H + Math.max(maxY, 0)) / bg.h)) } : {}),
    });
  }

  const frames = charFrames(kit, img, true, (path) => img(path) !== null); // framing ignores approval
  const STEP = 0.1, LONG = 1; // seconds
  for (const a of tl.actors) {
    let run = 0, runShot = "", side = "", start = 0;
    const seen = new Set<string>();
    for (let t = 0; t <= tl.duration + 1e-9; t += STEP) {
      const shot = shotAt(tl, t);
      const q = shot.type === "wide" ? pose(a, t, frames) : null;
      let cut = "";
      if (q?.img && shot.type === "wide") {
        const cam = camAt(shot.camera, t);
        const l = q.drawX - cam.x, r = l + q.img.w, top = q.drawY - cam.y, b = top + q.img.h;
        cut = l < 0 && r > 0 ? "left" : l < W && r > W ? "right" : b > H && top < H ? "bottom" : top < 0 && b > 0 ? "top" : "";
      }
      if (cut && cut === side && shot.id === runShot) run += STEP;
      else [run, side, runShot, start] = [cut ? STEP : 0, cut, shot.id, t];
      const key = `${shot.id}/${side}`;
      if (cut && run >= LONG - 1e-9 && !seen.has(key)) {
        seen.add(key);
        out.push({ id: a.id, at: start, msg: `${actorName(tl, a.id)} is cut off by the ${side} edge in ${shotNumber(tl, shot.id)}.` });
      }
    }
  }
  return out;
}
