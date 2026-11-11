import type { Timeline } from "./types";
import { animStatus, assetStatus, faceStatus, type Kit, type Status } from "./kit";

export const NEEDS: Record<string, string> = { walk: "walk", look_around: "idle", startle: "hurt", idle: "idle" };

// What a timeline needs that the kit cannot give yet.
export function missingReport(tl: Timeline, kit: Kit, draft = false, has?: (path: string) => boolean) {
  const out: { what: string; why: Status; used_by: string }[] = [];
  const add = (what: string, why: Status, used_by: string) => {
    if (why !== "ok") out.push({ what, why, used_by });
  };
  for (const s of tl.shots) {
    for (const id of [s.bg, s.type === "wide" ? s.far : "", s.type === "wide" ? s.near : ""]) if (id) add(id, assetStatus(kit, id, draft, has), s.id);
    if (s.type === "closeup") add(`face ${s.face} ${s.expr}`, faceStatus(kit, s.face, s.expr, draft, has), s.id);
  }
  for (const a of tl.actors) {
    add(`${a.char} idle`, animStatus(kit, a.char, "idle", draft, has), a.id);
    for (const act of a.actions) {
      const anim = act.do.startsWith("anim:") ? act.do.slice(5) : NEEDS[act.do] ?? "";
      if (anim && anim !== "idle") add(`${a.char} ${anim}`, animStatus(kit, a.char, anim, draft, has), act.id);
    }
  }
  for (const f of tl.fx) add(f.fx, assetStatus(kit, f.fx, draft, has), f.id);
  for (const s of tl.audio) add(s.clip, assetStatus(kit, s.clip, draft, has), s.id);
  return out;
}
