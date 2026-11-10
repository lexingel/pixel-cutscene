import { chat } from "./providers";
import { buildScenePrompt } from "./scenePrompt";
import type { PaidTicket } from "./confirm";
import type { Keys } from "./keys";
import type { Kit } from "../core/kit";
import type { Timeline } from "../core/types";
import { keepLocked, validateTimeline } from "../core/timeline";

// Strips code fences and prose: takes the outermost {...}.
export function extractJson(text: string): unknown | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b < a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

export type CastEntry = { id: string; look: string; anims: string[] };

const BAD_IDS = new Set(["__proto__", "constructor", "prototype"]); // would hit Object.prototype as record keys

// Malformed entries are dropped, never fatal; idle is implied, so it is not listed.
export function parseCast(raw: unknown): CastEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CastEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const { id, look, anims } = e as Record<string, unknown>;
    if (typeof id !== "string" || !/^[a-z0-9_]+$/.test(id) || BAD_IDS.has(id) || out.some((c) => c.id === id)) continue;
    out.push({
      id,
      look: typeof look === "string" ? look.trim() : "",
      anims: Array.isArray(anims) ? [...new Set(anims.filter((a): a is string => typeof a === "string" && !!a && a !== "idle"))] : [],
    });
  }
  return out;
}

// Accepts {timeline, cast} and a bare timeline (older models, repair replies).
const check = (text: string): { tl: Timeline; cast: CastEntry[] } | { errors: string[]; cast: CastEntry[] } => {
  const j = extractJson(text);
  if (j === null) return { errors: ["(root): the reply was not a JSON object"], cast: [] };
  const wrapped = "timeline" in (j as object);
  const tl = wrapped ? (j as { timeline: unknown }).timeline : j;
  const cast = wrapped ? parseCast((j as { cast?: unknown }).cast) : [];
  const errors = validateTimeline(tl);
  return errors.length ? { errors, cast } : { tl: tl as Timeline, cast };
};

// Up to 2 chat calls (draft + one repair): the caller's ticket must cover both. Never mutates `current`.
export async function draftScene(
  keys: Keys,
  kit: Kit,
  canvas: { W: number; H: number },
  description: string,
  current: Timeline | null,
  ticket: PaidTicket,
  chatFn: typeof chat = chat,
): Promise<{ ok: true; tl: Timeline; cast: CastEntry[] } | { ok: false; error: string }> {
  if (!keys.ai) return { ok: false, error: "No AI key is set. Add one in Settings." };
  const { system, user } = buildScenePrompt(kit, canvas, description, current);
  try {
    let reply = await chatFn(keys.ai, system, user, ticket);
    let r = check(reply);
    const first = r.cast;
    if ("errors" in r) {
      const fix = `${user}\n\nYour previous reply had these problems:\n${r.errors.slice(0, 10).join("\n")}\n\nPrevious reply:\n${reply}\n\nFix them and return only the corrected JSON.`;
      reply = await chatFn(keys.ai, system, fix, ticket);
      r = check(reply);
    }
    if ("errors" in r) return { ok: false, error: r.errors.slice(0, 5).join("; ") };
    // a bare repair reply keeps the cast the first reply named
    return { ok: true, tl: current ? keepLocked(current, r.tl) : r.tl, cast: r.cast.length ? r.cast : first };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
