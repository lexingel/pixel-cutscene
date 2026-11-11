// The Dialogue window: every line of the scene as "speaker: words", spoken or not, timed one after another.
import { dialogueOf, parseScript, setDialogue, spaceOut, toScript, type Line } from "../core/dialogue";
import type { Kit } from "../core/kit";
import { actorName } from "../core/labels";
import type { Timeline } from "../core/types";
import type { EditResult } from "./timelineEditor";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** `apply` gets the new timeline as one edit (one undo step). */
export function openDialogue(tl: Timeline, kit: Kit, now: number, apply: (r: EditResult) => void): void {
  if (!tl.actors.length) return;
  let lines: Line[] = dialogueOf(tl);
  const clipLen = (l: Line) => {
    const e = l.key ? tl.audio.find((x) => x.id === l.key) : undefined;
    return (e && e.line === l.text ? kit.assets[e.clip]?.len : 0) ?? 0;
  };
  const d = document.createElement("dialog");
  d.className = "dialog dialogue";
  d.setAttribute("aria-labelledby", "dlg-dialogue-h");
  d.innerHTML = `<form method="dialog"><h2 id="dlg-dialogue-h">Dialogue</h2>
    <p>Every line in the scene. Tick <b>Voice</b> to have it spoken (it shows in Needs approval, to generate with ElevenLabs); unticked, it is a speech bubble only.</p>
    <div class="dl-body"></div>
    <div class="row dl-tools"><button type="button" class="btn" data-act="add">+ Add a line</button><button type="button" class="btn" data-act="space" title="Each line starts just after the one before ends">Space them out</button><span class="grow"></span><button type="button" class="btn quiet" data-act="text">Write as text</button></div>
    <p class="small dl-err" role="alert" hidden></p>
    <div class="row end"><button value="cancel" class="btn">Cancel</button><button type="button" class="btn primary" data-act="apply">Apply</button></div></form>`;
  const body = d.querySelector<HTMLElement>(".dl-body")!;
  const err = d.querySelector<HTMLElement>(".dl-err")!;
  const textBtn = d.querySelector<HTMLButtonElement>("[data-act=text]")!;
  let textMode = false;
  const who = (sel: string) => tl.actors.map((a) => `<option value="${esc(a.id)}"${a.id === sel ? " selected" : ""}>${esc(actorName(tl, a.id))}</option>`).join("");
  const say = (msg = "") => ((err.textContent = msg), (err.hidden = !msg));

  function drawTable() {
    if (!lines.length) {
      body.innerHTML = `<p class="small muted">No lines yet. Add one, or write the scene as text.</p>`;
      return;
    }
    body.innerHTML = `<table class="dl-table"><thead><tr><th>Who</th><th>Line</th><th>Voice</th><th>Box</th><th>Start (s)</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${lines
      .map((l, i) => `<tr data-i="${i}">
        <td><select aria-label="Speaker of line ${i + 1}" data-k="who">${who(l.who)}</select></td>
        <td><input aria-label="Line ${i + 1}" data-k="text" value="${esc(l.text)}" /></td>
        <td><input type="checkbox" aria-label="Line ${i + 1} is spoken" data-k="voice"${l.voice ? " checked" : ""} /></td>
        <td><input type="checkbox" aria-label="Line ${i + 1} in a box along the bottom" title="A dialogue box along the bottom instead of a bubble over the head" data-k="box"${l.style === "box" ? " checked" : ""} /></td>
        <td><input type="number" min="0" max="${tl.duration}" step="0.1" aria-label="Line ${i + 1} starts at" data-k="t" value="${+l.t.toFixed(2)}" /></td>
        <td><button type="button" class="btn quiet danger" data-del="${i}" aria-label="Remove line ${i + 1}">✕</button></td></tr>`)
      .join("")}</tbody></table>`;
  }
  body.oninput = body.onchange = (e) => {
    const el = e.target as HTMLInputElement;
    const i = Number(el.closest<HTMLElement>("tr")?.dataset.i);
    if (Number.isNaN(i) || !lines[i]) return;
    const l = lines[i];
    if (el.dataset.k === "who") l.who = el.value;
    else if (el.dataset.k === "text") l.text = el.value;
    else if (el.dataset.k === "voice") l.voice = el.checked;
    else if (el.dataset.k === "box") l.style = el.checked ? "box" : "bubble";
    else if (el.dataset.k === "t" && el.value !== "") l.t = Math.min(Math.max(Number(el.value), 0), tl.duration);
  };
  body.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-del]");
    if (!b) return;
    lines.splice(Number(b.dataset.del), 1);
    drawTable();
  };
  const fromText = (): boolean => {
    const r = parseScript(body.querySelector<HTMLTextAreaElement>("textarea")!.value, tl);
    if (r.error) return say(r.error), false;
    const old = [...lines];
    // a line that was already there (same speaker and words) keeps its voice, box and time; new ones follow on
    const start = lines[0]?.t ?? now;
    const next = r.lines.map((x) => {
      const i = old.findIndex((o) => o.who === x.who && o.text.trim() === x.text);
      const o = i >= 0 ? old.splice(i, 1)[0] : undefined;
      return { ...x, voice: o?.voice ?? false, style: o?.style ?? "bubble", key: o?.key, t: o?.t ?? NaN };
    });
    const timed = spaceOut(next, start, clipLen);
    lines = next.map((l, i) => ({ ...l, t: Number.isNaN(l.t) ? timed[i].t : l.t }));
    return true;
  };
  textBtn.onclick = () => {
    say();
    if (textMode && !fromText()) return;
    textMode = !textMode;
    textBtn.textContent = textMode ? "Back to the list" : "Write as text";
    d.querySelector<HTMLElement>(".dl-tools")!.querySelectorAll<HTMLButtonElement>("[data-act=add], [data-act=space]").forEach((b) => (b.hidden = textMode));
    if (textMode) {
      body.innerHTML = `<textarea class="dl-script" aria-label="Dialogue as text" rows="10" spellcheck="true" placeholder="knight: We rest here tonight.&#10;ranger: Something moves in the trees."></textarea><p class="small muted">One line each, as <b>Name: what they say</b>. Names: ${esc(tl.actors.map((a) => actorName(tl, a.id)).join(", "))}. New lines are timed one after another.</p>`;
      const ta = body.querySelector<HTMLTextAreaElement>("textarea")!;
      ta.value = toScript(lines, tl);
      ta.focus();
    } else drawTable();
  };
  d.querySelector<HTMLButtonElement>("[data-act=add]")!.onclick = () => {
    const last = lines[lines.length - 1];
    const other = tl.actors.find((a) => a.id !== last?.who) ?? tl.actors[0];
    const t = last ? spaceOut([last, { ...last, text: "" }], last.t, clipLen)[1].t : now;
    lines.push({ who: last ? other.id : tl.actors[0].id, text: "", voice: last?.voice ?? false, style: last?.style ?? "bubble", t: Math.min(t, tl.duration) });
    drawTable();
    body.querySelector<HTMLInputElement>(`tr[data-i="${lines.length - 1}"] [data-k=text]`)?.focus();
  };
  d.querySelector<HTMLButtonElement>("[data-act=space]")!.onclick = () => {
    lines = spaceOut([...lines].sort((a, b) => a.t - b.t), lines.length ? Math.min(...lines.map((l) => l.t)) : now, clipLen);
    drawTable();
  };
  d.querySelector<HTMLButtonElement>("[data-act=apply]")!.onclick = () => {
    say();
    if (textMode && !fromText()) return;
    const late = lines.find((l) => l.text.trim() && l.t >= tl.duration);
    if (late) return say(`“${late.text}” starts at the very end of the scene. Make the scene longer, or move the line earlier.`);
    const r = setDialogue(tl, lines);
    if (r.error) return say(r.error);
    d.close();
    apply(r);
  };
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  drawTable();
  d.showModal();
}
