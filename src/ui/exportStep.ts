import { missingReport } from "../core/missing";
import type { Project } from "../core/project";
import { pickCodec } from "../export/encode";
import { MissingError, exportVideo, type ExportKind } from "../export/exporter";
import { creditsText, loadTracks } from "./music";
import type { Step } from "./steps";

const blockWhile = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = ""; // older browsers need a value to show the "leave site?" warning
};

function download(blob: Blob, name: string) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function renderExport(root: HTMLElement, p: Project, go: (n: Step) => void): void {
  const tl = p.tl;
  if (!tl || !tl.shots.length) {
    root.innerHTML = `<section class="empty-page"><h1>Export</h1>
      <p class="hint">There is no scene to export yet. Draft one in ① Scene or build it in ③ Tweak.</p>
      <button class="btn primary" type="button">Go to Tweak</button></section>`;
    root.querySelector("button")!.onclick = () => go(3);
    return;
  }
  const { W, H, exportScale: k } = p.canvas;
  const loopTo = Math.min(4, tl.duration);
  root.innerHTML = `
  <section class="export">
    <div><h1>Export</h1><p class="hint" data-testid="format-note">Checking what this browser can make…</p></div>
    <div class="needs-list" hidden><p class="small"></p><ul></ul></div>
    <label class="check"><input type="checkbox" data-act="draft" /> Draft: allow missing and unapproved pieces, with a DRAFT watermark</label>
    <div class="export-cards">
      <div class="card">
        <h2>Full video</h2>
        <p class="small">${W * k}×${H * k} · 30 fps · with sound</p>
        <button class="btn primary" type="button" data-act="full">Export video</button>
      </div>
      <div class="card">
        <h2>Store loop</h2>
        <p class="small">${W}×${H}, silent, a range you pick</p>
        <div class="row wrap">
          <label>From (s) <input type="number" min="0" step="0.1" data-act="from" value="0" /></label>
          <label>To (s) <input type="number" min="0" step="0.1" data-act="to" value="${loopTo}" /></label>
          <label>Loop format <select data-act="fmt"><option value="webm">WebM, 30 fps</option><option value="gif">GIF, 15 fps</option></select></label>
        </div>
        <button class="btn" type="button" data-act="loop">Export loop</button>
      </div>
    </div>
    <div class="progress-row" data-testid="export-progress" hidden>
      <progress max="1" value="0"></progress><span class="small" aria-live="polite"></span>
      <button class="btn" type="button" data-act="cancel">Cancel</button>
    </div>
    <p class="error" role="alert"></p>
  </section>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const draft = $<HTMLInputElement>("[data-act=draft]");
  const alert = $(".error");
  const bar = $<HTMLProgressElement>("progress");
  const row = $(".progress-row");
  const buttons = [$<HTMLButtonElement>("[data-act=full]"), $<HTMLButtonElement>("[data-act=loop]")];

  const codecP = pickCodec(W * k, H * k);
  codecP.then((c) => {
    $("[data-testid=format-note]").textContent = c === "mp4"
      ? "Full videos come out as MP4 (H.264 and AAC), pixel-exact at whole-number scale."
      : "Your browser can't make MP4, so this is WebM (VP9 and Opus). Chrome and Edge can make MP4.";
  });

  const missing = missingReport(tl, p.kit, false, (path) => p.files.has(path));
  if (missing.length) {
    $(".needs-list").hidden = false;
    $(".needs-list p").textContent = `The full export waits for ${missing.length} piece${missing.length > 1 ? "s" : ""} (approve them in ③ Tweak), or tick Draft:`;
    $(".needs-list ul").append(...missing.map((m) => Object.assign(document.createElement("li"), { textContent: `${m.what}: ${m.why}` })));
  }

  async function run(kind: ExportKind) {
    alert.textContent = "";
    const ctl = new AbortController();
    const range: [number, number] = [Number($<HTMLInputElement>("[data-act=from]").value), Number($<HTMLInputElement>("[data-act=to]").value)];
    buttons.forEach((b) => (b.disabled = true)); // before any await, so a double click starts one export
    draft.disabled = true;
    const codec = await codecP;
    const ext = kind === "full" ? codec : kind === "loop-gif" ? "gif" : "webm";
    const name = `${p.name}${kind === "full" ? "" : "_loop"}${draft.checked ? "_DRAFT" : ""}.${ext}`;
    row.hidden = false;
    bar.value = 0;
    $(".progress-row span").textContent = "Mixing the sound…";
    $<HTMLButtonElement>("[data-act=cancel]").onclick = () => ctl.abort();
    addEventListener("beforeunload", blockWhile);
    try {
      const blob = await exportVideo(p, {
        draft: draft.checked, kind, range, signal: ctl.signal,
        onProgress: (f) => {
          if (!bar.isConnected) return ctl.abort(); // the user left this step: stop rendering
          bar.value = f;
          $(".progress-row span").textContent = `${Math.round(f * 100)}%, keep this tab open`;
        },
      }, codec);
      if (!bar.isConnected) return;
      download(blob, name);
      const credits = kind !== "full" ? "" : creditsText(p.tl!, p.kit, await loadTracks().catch(() => []));
      if (credits) download(new Blob([`${credits}\n`], { type: "text/plain" }), name.replace(/\.[^.]+$/, "_credits.txt"));
      alert.textContent = "";
      $(".progress-row span").textContent = "";
    } catch (e) {
      const err = e as Error;
      alert.textContent = err.name === "AbortError" ? "Export cancelled. Nothing was downloaded."
        : e instanceof MissingError ? `${err.message} Approve them in ③ Tweak, or tick Draft.`
        : `The export failed: ${err.message}`;
    } finally {
      removeEventListener("beforeunload", blockWhile);
      row.hidden = true;
      buttons.forEach((b) => (b.disabled = false));
      draft.disabled = false;
    }
  }
  buttons[0].onclick = () => run("full");
  buttons[1].onclick = () => run($<HTMLSelectElement>("[data-act=fmt]").value === "gif" ? "loop-gif" : "loop-webm");
}
