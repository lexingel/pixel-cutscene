import { missingReport } from "../core/missing";
import { toZip, type Project } from "../core/project";
import type { Img } from "../core/kit";
import { frameZoom, renderFrame } from "../core/render";
import { zoomFrame } from "../core/raster";
import { decode } from "./cast";
import { pickCodec, type Quality } from "../export/encode";
import { MissingError, exportVideo, sliceFit, type ExportKind } from "../export/exporter";
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

const mb = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`);

/** The project as a zip: project.json plus every image and sound under files/. */
export async function downloadProject(p: Project): Promise<void> {
  download(await toZip(p), `${p.name}.zip`);
}

/** project.json alone: the timeline, kit and settings, without the image and sound files. */
export function downloadJson(p: Project): void {
  const { files: _files, ...meta } = p;
  download(new Blob([JSON.stringify(meta, null, 1)], { type: "application/json" }), `${p.name}.json`);
}

const OUT: Record<string, [number, number]> = { vertical: [1080, 1920], square: [1080, 1080] };

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
    <figure class="poster"><canvas width="${W}" height="${H}" aria-label="The scene at the loop's start time"></canvas>
      <figcaption class="small" data-testid="poster-note">Loading the scene…</figcaption></figure>
    <p class="ready" data-testid="ready" hidden>Every piece is in and approved. Ready to export.</p>
    <div class="needs-list" hidden><p class="small"></p><ul></ul></div>
    <label class="check" data-testid="draft-row" hidden><input type="checkbox" data-act="draft" /> Draft: allow missing and unapproved pieces, with a DRAFT watermark</label>
    <div class="export-cards">
      <div class="card">
        <h2>Full video</h2>
        <p class="small" data-testid="full-size">${W * k}×${H * k} · 30 fps · with sound</p>
        <div class="row wrap">
          <label>Shape <select data-act="shape"><option value="wide">Wide 16:9</option><option value="vertical">Vertical 9:16 (Shorts, TikTok)</option><option value="square">Square 1:1 (posts)</option></select></label>
          <label data-act="slice" hidden>Slice centre x <input type="number" min="0" max="${W}" step="1" data-act="cx" value="${Math.round(W / 2)}" /></label>
          <label>Quality <select data-act="quality"><option value="share">Share: small file (~9 Mbit/s)</option><option value="best">Best: archive (~37 Mbit/s)</option></select></label>
        </div>
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
      <div class="card">
        <h2>Project files</h2>
        <p class="small">Back up this project or move it to another browser. Open the .zip again from the home page.</p>
        <div class="row wrap">
          <button class="btn" type="button" data-act="proj-zip">Download project (.zip)</button>
          <button class="btn quiet" type="button" data-act="proj-json">project.json only</button>
        </div>
        <p class="small">The .zip has project.json (timeline, cast, settings) and every image and sound. The .json alone is the timeline and settings, without files.</p>
      </div>
    </div>
    <div class="done-row" data-testid="export-done" role="status" hidden><p></p><button class="btn" type="button" data-act="next-loop" hidden>Make a store loop next</button></div>
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

  const shape = $<HTMLSelectElement>("[data-act=shape]");
  shape.onchange = () => {
    const out = OUT[shape.value];
    $("[data-act=slice]").hidden = !out;
    const f = out && sliceFit(W, H, ...out);
    $("[data-testid=full-size]").textContent = f
      ? `${f.outW}×${f.outH} · a ${f.cw} px wide slice of the scene at ×${f.k} · 30 fps · with sound`
      : `${W * k}×${H * k} · 30 fps · with sound`;
  };
  const codecP = pickCodec(W * k, H * k);
  codecP.then((c) => {
    $("[data-testid=format-note]").textContent = c === "mp4"
      ? "Full videos come out as MP4 (H.264 and AAC), pixel-exact at whole-number scale."
      : "Your browser can't make MP4, so this is WebM (VP9 and Opus). Chrome and Edge can make MP4.";
  });

  const done = $("[data-testid=export-done]");
  const nextLoop = $<HTMLButtonElement>("[data-act=next-loop]");
  nextLoop.onclick = () => {
    const from = $<HTMLInputElement>("[data-act=from]");
    from.scrollIntoView({ block: "center" });
    from.focus();
  };

  // a still of the scene at the loop's From time, rendered like the export (at native size)
  const poster = $<HTMLCanvasElement>(".poster canvas");
  poster.style.width = `${W * Math.max(1, Math.floor(760 / W))}px`; // whole-number scale, so the still stays pixel-exact
  let posterAt: ((t: number) => void) | null = null;
  void (async () => {
    const imgs = new Map<string, Img>();
    for (const [path, blob] of p.files) if (/\.png$/i.test(path)) await decode(blob).then((im) => imgs.set(path, im), () => {});
    if (!poster.isConnected) return;
    const input = { tl, kit: p.kit, img: (path: string) => imgs.get(path) ?? null, draft: false, W, H }; // as the Tweak preview shows it
    const native: Img = { w: W, h: H, px: new Uint8ClampedArray(W * H * 4) };
    const zoomed = new Uint8ClampedArray(W * H * 4);
    const g = poster.getContext("2d")!;
    posterAt = (t) => {
      t = Math.min(Math.max(t || 0, 0), tl.duration);
      renderFrame(input, t, native);
      const z = frameZoom(input, t);
      if (z) zoomFrame(native, z.z, z.x, z.y, 1, zoomed, k);
      g.putImageData(new ImageData(z ? zoomed : native.px, W, H), 0, 0);
      $("[data-testid=poster-note]").textContent = `The scene at ${t.toFixed(1)} s, where the store loop starts. Change From to look elsewhere.`;
    };
    posterAt(Number($<HTMLInputElement>("[data-act=from]").value));
  })();
  $<HTMLInputElement>("[data-act=from]").addEventListener("input", (e) => posterAt?.(Number((e.target as HTMLInputElement).value)));

  const missing = missingReport(tl, p.kit, false, (path) => p.files.has(path));
  $("[data-act=proj-zip]").onclick = () => downloadProject(p);
  $("[data-act=proj-json]").onclick = () => downloadJson(p);
  $("[data-testid=ready]").hidden = missing.length > 0;
  $("[data-testid=draft-row]").hidden = !missing.length; // nothing to stand in for: no draft to offer
  if (missing.length) {
    $(".needs-list").hidden = false;
    $(".needs-list p").textContent = `The full export waits for ${missing.length} piece${missing.length > 1 ? "s" : ""} (approve them in ③ Tweak), or tick Draft:`;
    $(".needs-list ul").append(...missing.map((m) => Object.assign(document.createElement("li"), { textContent: `${m.what}: ${m.why}` })));
  }

  async function run(kind: ExportKind) {
    alert.textContent = "";
    done.hidden = true;
    const ctl = new AbortController();
    const range: [number, number] = [Number($<HTMLInputElement>("[data-act=from]").value), Number($<HTMLInputElement>("[data-act=to]").value)];
    buttons.forEach((b) => (b.disabled = true)); // before any await, so a double click starts one export
    draft.disabled = true;
    // a slice is encoded at its own size: the wide size's answer may not hold for 1080x1920
    const codec = kind === "full" && shape.value !== "wide" ? await pickCodec(...OUT[shape.value]) : await codecP;
    const ext = kind === "full" ? codec : kind === "loop-gif" ? "gif" : "webm";
    const tag = kind !== "full" ? "_loop" : shape.value === "wide" ? "" : `_${shape.value}`;
    const name = `${p.name}${tag}${draft.checked ? "_DRAFT" : ""}.${ext}`;
    row.hidden = false;
    bar.value = 0;
    $(".progress-row span").textContent = "Mixing the sound…";
    $<HTMLButtonElement>("[data-act=cancel]").onclick = () => ctl.abort();
    addEventListener("beforeunload", blockWhile);
    try {
      const blob = await exportVideo(p, {
        draft: draft.checked, kind, range, signal: ctl.signal,
        quality: $<HTMLSelectElement>("[data-act=quality]").value as Quality,
        ...(kind === "full" && shape.value !== "wide" ? { slice: { cx: Number($<HTMLInputElement>("[data-act=cx]").value), out: OUT[shape.value] } } : {}),
        onProgress: (f) => {
          if (!bar.isConnected) return ctl.abort(); // the user left this step: stop rendering
          bar.value = f;
          $(".progress-row span").textContent = `${Math.round(f * 100)}%, keep this tab open`;
        },
      }, codec);
      if (!bar.isConnected) return;
      download(blob, name);
      const credits = kind !== "full" ? "" : creditsText(p.tl!, p.kit, await loadTracks().catch(() => []));
      const creditsName = name.replace(/\.[^.]+$/, "_credits.txt");
      if (credits) download(new Blob([`${credits}\n`], { type: "text/plain" }), creditsName);
      done.hidden = false;
      done.querySelector("p")!.textContent = `Saved ${name} (${mb(blob.size)}) to your downloads${credits ? `, with ${creditsName} for the music credits` : ""}.`;
      nextLoop.hidden = kind !== "full";
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
