import type { Kit } from "./kit";
import { moveLabel } from "./moves";
import type { Timeline } from "./types";

// Plain names for timeline entries. Ids (a1, f1, s1, actor1) stay in the saved JSON and never reach the screen.

/** An actor's character name; "hero 1", "hero 2" (by timeline order) when several actors share a character. */
export function actorName(tl: Timeline, id: string): string {
  const a = tl.actors.find((x) => x.id === id);
  if (!a) return id;
  const same = tl.actors.filter((x) => x.char === a.char);
  return same.length > 1 ? `${a.char} ${same.indexOf(a) + 1}` : a.char;
}

/** "Shot 2". */
export const shotNumber = (tl: Timeline, id: string): string => `Shot ${tl.shots.findIndex((s) => s.id === id) + 1}`;

/** "Shot 2 · wide" or "Shot 2 · close-up ann". */
export function shotName(tl: Timeline, id: string): string {
  const s = tl.shots.find((x) => x.id === id);
  if (!s) return id;
  const moves = s.type === "wide" && s.camera.some((k) => k.x !== s.camera[0].x || k.y !== s.camera[0].y);
  const zoom = s.type === "wide" && s.zoom ? (s.zoom.from === s.zoom.to ? "close-up" : s.zoom.to > s.zoom.from ? "zoom in" : "zoom out") : "";
  const kind = s.type === "closeup" ? `close-up ${s.face}` : [zoom, moves ? "pan" : ""].filter(Boolean).join(" · ") || "wide";
  return `${shotNumber(tl, id)} · ${kind}`;
}

/** "fire breath" for a library effect (aimed copies included), else the asset's own name. */
export function fxName(kit: Kit, assetId: string): string {
  const a = kit.assets[assetId];
  return a?.source === "pixelfx" && a.ref ? a.ref.split("/").pop()!.replace(/-/g, " ") : assetId;
}

/** What to show for any entry id. */
export function labelOf(tl: Timeline, kit: Kit, id: string): string {
  const shot = tl.shots.find((s) => s.id === id);
  if (shot) return shotName(tl, id);
  for (const a of tl.actors) {
    if (a.id === id) return actorName(tl, id);
    const act = a.actions.find((x) => x.id === id);
    if (act) return `${actorName(tl, a.id)} · ${act.do === "say" ? `“${act.text ?? ""}”` : moveLabel(act.do)}`;
  }
  const f = tl.fx.find((x) => x.id === id);
  if (f) return fxName(kit, f.fx);
  const s = tl.audio.find((x) => x.id === id);
  return s ? (s.line ? `${s.clip} “${s.line}”` : s.clip) : id;
}
