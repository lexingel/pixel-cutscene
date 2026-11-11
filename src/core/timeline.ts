import type { ParseResult, Timeline } from "./types";

export const ACTIONS = ["idle", "walk", "look_around", "startle", "move", "hurt", "dust", "say"]; // plus "anim:<name>"
export const KINDS = ["music", "sfx", "voice"];
const LISTS = ["shots", "actors", "fx", "audio"] as const;

type Obj = Record<string, any>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const num = (x: unknown, dflt = 0) => (isNum(x) ? x : dflt);
const hasNum = (x: Obj, k: string) => isNum(x[k]);
const whole = (x: unknown) => isNum(x) && Number.isInteger(x) && x >= 1;
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-5;
const str = (x: unknown) => (x === undefined || x === null ? "" : String(x));
const fmt = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n)); // Godot prints 5.0

export function parseTimeline(text: string): ParseResult {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`(root): JSON error: ${(e as Error).message}`], data: null };
  }
  if (!isObj(j)) return { ok: false, errors: ["(root): top level must be an object"], data: null };
  const errors = validateTimeline(j);
  return { ok: errors.length === 0, errors, data: j as unknown as Timeline };
}

export function validateTimeline(d: unknown): string[] {
  if (!isObj(d)) return ["(root): top level must be an object"];
  const e: string[] = [];
  const dur = num(d.duration);
  if (dur <= 0) e.push("(root).duration: must be above 0");
  if (!/^[A-Za-z0-9_-]+$/.test(str(d.name))) {
    e.push("(root).name: use only letters, digits, - and _ (it names the output folder)");
  }
  if ("kit" in d && (typeof d.kit !== "string" || d.kit === "")) e.push("(root).kit: must be a non-empty string");
  if (!whole(d.closeup_scale ?? 1)) e.push("(root).closeup_scale: must be a whole number of 1 or more");
  if ("shadows" in d && typeof d.shadows !== "boolean") e.push("(root).shadows: must be true or false");

  const list = (k: string): any[] => (Array.isArray(d[k]) ? d[k] : []);
  const all: any[] = [];
  for (const key of LISTS) {
    if (d[key] !== undefined && !Array.isArray(d[key])) e.push(`(root).${key}: must be a list`);
    else all.push(...list(key));
  }
  for (const a of list("actors")) if (isObj(a) && Array.isArray(a.actions)) all.push(...a.actions);
  const seen = new Set<string>();
  for (const x of all) {
    if (!isObj(x) || str(x.id) === "") {
      e.push("(root): an entry has no id");
      continue;
    }
    if (seen.has(x.id)) e.push(`${x.id}.id: duplicate id`);
    seen.add(x.id);
  }

  // shots tile [0, duration] in order
  let prevEnd = 0;
  for (const s of list("shots")) {
    if (!isObj(s)) continue;
    const id = str(s.id ?? "?");
    if (!approx(num(s.start, -1), prevEnd)) e.push(`${id}.start: must equal the previous shot's end (${fmt(prevEnd)})`);
    if (num(s.end) <= num(s.start)) e.push(`${id}.end: must be after start`);
    prevEnd = num(s.end);
    for (const k of ["flash", "shake"]) if (s[k] !== undefined && !(isNum(s[k]) && s[k] >= 0)) e.push(`${id}.${k}: must be 0 or more seconds`);
    if (s.zoom !== undefined) {
      const z = s.zoom;
      if (!isObj(z) || !(isNum(z.from) && z.from >= 1 && isNum(z.to) && z.to >= 1 && hasNum(z, "x") && hasNum(z, "y")))
        e.push(`${id}.zoom: needs from and to of 1 or more, and x and y numbers`);
      else if (z.actor !== undefined && !list("actors").some((a) => isObj(a) && a.id === z.actor)) e.push(`${id}.zoom.actor: no actor ${str(z.actor)}`);
    }
    switch (str(s.type)) {
      case "wide":
        if (!whole(s.bg_scale ?? 1)) e.push(`${id}.bg_scale: must be a whole number of 1 or more`);
        if (!Array.isArray(s.camera) || s.camera.length === 0) e.push(`${id}.camera: a wide shot needs camera keys`);
        else if (!s.camera.every((k: unknown) => isObj(k) && hasNum(k, "t") && hasNum(k, "x") && hasNum(k, "y"))) {
          e.push(`${id}.camera: every key needs t, x and y numbers`);
        }
        break;
      case "closeup":
        if (str(s.face) === "" || str(s.expr) === "") e.push(`${id}.face: a close-up needs face and expr`);
        break;
      default:
        e.push(`${id}.type: must be wide or closeup`);
    }
  }
  if (list("shots").length > 0 && !approx(prevEnd, dur)) e.push(`(root).shots: the last shot must end at duration (${fmt(dur)})`);

  const checkT = (id: string, x: Obj) => {
    if (!isNum(x.t) || x.t < 0 || x.t > dur) e.push(`${id}.t: must be between 0 and ${fmt(dur)}`);
  };

  for (const a of list("actors")) {
    if (!isObj(a)) continue;
    const aid = str(a.id ?? "?");
    if (str(a.char) === "") e.push(`${aid}.char: missing`);
    if (!(hasNum(a, "x") && hasNum(a, "y"))) e.push(`${aid}.x: an actor needs x and y numbers`);
    if ("appear" in a && !hasNum(a, "appear")) e.push(`${aid}.appear: must be a number of seconds`);
    if ("flip" in a && typeof a.flip !== "boolean") e.push(`${aid}.flip: must be true or false`);
    if ("layer" in a && a.layer !== "front" && a.layer !== "back") e.push(`${aid}.layer: must be front or back`);
    if (a.actions !== undefined && !Array.isArray(a.actions)) {
      e.push(`${aid}.actions: must be a list`);
      continue;
    }
    for (const act of a.actions ?? []) {
      if (!isObj(act)) continue;
      const id = str(act.id ?? "?");
      const what = str(act.do);
      if (!(ACTIONS.includes(what) || (what.startsWith("anim:") && what.length > 5))) e.push(`${id}.do: unknown action '${what}'`);
      checkT(id, act);
      if ((what === "walk" || what === "move") && !(Array.isArray(act.to) && act.to.length === 2)) {
        e.push(`${id}.to: ${what} needs to: [x, y]`);
      }
      if (["walk", "move", "look_around", "startle", "dust"].includes(what) && num(act.dur) <= 0) {
        e.push(`${id}.dur: ${what} needs a duration`);
      }
      if (what === "say" && (typeof act.text !== "string" || !act.text.trim())) e.push(`${id}.text: say needs the words to show`);
      if (what === "say" && act.style !== undefined && !["bubble", "box"].includes(String(act.style))) e.push(`${id}.style: must be bubble or box`);
    }
  }
  for (const f of list("fx")) {
    if (!isObj(f)) continue;
    const id = str(f.id ?? "?");
    checkT(id, f);
    if (str(f.fx) === "") e.push(`${id}.fx: missing`);
    for (const k of ["x", "y"]) if (!hasNum(f, k)) e.push(`${id}.${k}: must be a number`);
    if (f.flip !== undefined && typeof f.flip !== "boolean") e.push(`${id}.flip: must be true or false`);
    if (f.angle !== undefined && !hasNum(f, "angle")) e.push(`${id}.angle: must be a number`);
    if (f.reach !== undefined && !(hasNum(f, "reach") && (f.reach as number) >= 1 && (f.reach as number) <= 4)) e.push(`${id}.reach: must be 1 to 4`);
  }
  for (const s of list("audio")) {
    if (!isObj(s)) continue;
    const id = str(s.id ?? "?");
    checkT(id, s);
    if (str(s.clip) === "") e.push(`${id}.clip: missing`);
    if (!KINDS.includes(str(s.kind))) e.push(`${id}.kind: must be music, sfx or voice`);
    if (s.dur !== undefined && !(isNum(s.dur) && s.dur >= 0.5 && s.dur <= 30)) e.push(`${id}.dur: must be 0.5 to 30 seconds`);
  }
  return e;
}

const clone = <T>(x: T): T => structuredClone(x);

// Locked old entries replace (by id) or join the fresh list.
function merge(olds: Obj[], news: Obj[]): void {
  for (const o of olds) {
    if (!o.locked) continue;
    let i = -1;
    news.forEach((n, k) => {
      if (n.id === o.id) i = k;
    });
    if (i >= 0) news[i] = clone(o);
    else news.push(clone(o));
  }
}

/** A redraft keeps every entry the user marked "locked": true in the old timeline. */
export function keepLocked(old: Timeline, fresh: Timeline): Timeline {
  const out = clone(fresh) as unknown as Obj;
  const o = old as unknown as Obj;
  for (const key of LISTS) {
    out[key] ??= [];
    merge(o[key] ?? [], out[key]);
  }
  const byT = (a: Obj, b: Obj) => num(a.t) - num(b.t);
  for (const oa of (o.actors ?? []) as Obj[]) {
    if (oa.locked) continue;
    const lockedActs = ((oa.actions ?? []) as Obj[]).filter((x) => x.locked);
    if (lockedActs.length > 0 && !out.actors.some((na: Obj) => na.id === oa.id)) {
      const keep = clone(oa);
      keep.actions = clone(lockedActs);
      out.actors.push(keep);
      continue;
    }
    for (const na of out.actors as Obj[]) {
      if (na.id === oa.id) {
        na.actions ??= [];
        merge(oa.actions ?? [], na.actions);
        na.actions.sort(byT);
      }
    }
  }
  // a locked shot keeps its time span: unlocked shots it overlaps are trimmed (or dropped)
  for (const ls of (out.shots as Obj[]).filter((s) => s.locked)) {
    const s0 = Number(ls.start);
    const s1 = Number(ls.end);
    for (const s of out.shots as Obj[]) {
      if (s.locked) continue;
      if (s.start < s0 && s.end > s0) s.end = s0;
      else if (s.start >= s0 && s.start < s1) s.start = s1;
    }
    out.shots = (out.shots as Obj[]).filter((s) => s.end > s.start);
  }
  (out.shots as Obj[]).sort((a, b) => num(a.start) - num(b.start));
  return out as unknown as Timeline;
}
