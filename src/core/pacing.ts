import { sayDur } from "./bubbles";
import { shotNumber } from "./labels";
import type { Timeline } from "./types";

// A scene critic: places where a cutscene usually feels static. Notes only, never a block on export.
export type SceneNote = { kind: "still" | "long" | "talk"; id: string; at: number; msg: string };

const STILL = 4; // seconds with nothing moving
const LONG = 20; // seconds in one wide shot

export function sceneNotes(tl: Timeline): SceneNote[] {
  if (!tl.actors.length) return [];
  const out: SceneNote[] = [];
  const busy: [number, number][] = [];
  // ponytail: a move with no dur (hurt, anim:*) counts as 1 s; its real length needs the frames
  const span = (t: number, d = 1) => busy.push([t, t + d]);
  for (const s of tl.shots) {
    span(s.start); // a cut
    if (s.type === "closeup" || (s.type === "wide" && s.zoom && s.zoom.from !== s.zoom.to)) span(s.start, s.end - s.start);
    if (s.flash) span(s.start, s.flash);
    if (s.type === "wide") {
      if (s.shake) span(s.start, s.shake);
      for (let i = 1; i < s.camera.length; i++) {
        const [a, b] = [s.camera[i - 1], s.camera[i]];
        if (a.x !== b.x || a.y !== b.y) busy.push([a.t, b.t]);
      }
    }
  }
  for (const a of tl.actors) {
    if (a.appear) span(a.appear);
    for (const x of a.actions) if (x.do !== "idle") span(x.t, x.dur ?? (x.do === "say" ? sayDur(x.text ?? "") : undefined));
  }
  for (const f of tl.fx) span(f.t, f.dur);
  for (const e of tl.audio) if (e.kind === "voice") span(e.t, sayDur(e.line ?? ""));

  busy.sort((a, b) => a[0] - b[0]);
  let reach = 0;
  for (const [s, e] of [...busy, [tl.duration, tl.duration] as [number, number]]) {
    if (s - reach >= STILL - 1e-9) {
      const who = tl.actors.find((a) => (a.appear ?? 0) <= reach) ?? tl.actors[0];
      out.push({ kind: "still", id: who.id, at: reach, msg: `Nothing moves from ${reach.toFixed(1)} s to ${s.toFixed(1)} s.` });
    }
    reach = Math.max(reach, e);
  }

  for (const s of tl.shots)
    if (s.type === "wide" && s.end - s.start > LONG)
      out.push({ kind: "long", id: s.id, at: (s.start + s.end) / 2, msg: `${shotNumber(tl, s.id)} runs ${Math.round(s.end - s.start)} s without a cut.` });

  const lines = [
    ...tl.actors.flatMap((a) => a.actions.filter((x) => x.do === "say").map((x) => ({ t: x.t, id: a.id }))),
    ...tl.audio.filter((e) => e.kind === "voice").map((e) => ({ t: e.t, id: tl.actors.find((a) => a.char === e.speaker)?.id ?? tl.actors[0].id })),
  ].sort((a, b) => a.t - b.t);
  const closeup = tl.shots.some((s) => s.type === "closeup" || (s.zoom && Math.max(s.zoom.from, s.zoom.to) >= 2));
  if (lines.length && !closeup) out.push({ kind: "talk", id: lines[0].id, at: lines[0].t, msg: "There is dialogue but no close-up." });
  return out;
}
