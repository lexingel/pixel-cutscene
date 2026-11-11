import { startHomeFx } from "./homeFx";
import { importAs } from "../core/cast";
import { fromZip, newProject, type Project } from "../core/project";
import { deleteProject, listProjects, loadProject, saveProject } from "../core/store";
import { renderCast } from "./cast";
import { renderScene } from "./scene";
import { renderTweak } from "./tweak";
import { confirmDialog, toast } from "./dialogs";
import { openSettings } from "./settings";
import { downloadProject, renderExport } from "./exportStep";
import { stepBar, type Step } from "./steps";
import { nextBand } from "./nextBand";
import "./pixelfit";
import { getTheme, nextTheme, setTheme } from "./theme";

// Route lives in the hash (#/p/<id>) so a reload reopens the same project.
const projectIdFromHash = () => location.hash.match(/^#\/p\/(.+)$/)?.[1] ?? null;

/** "5 minutes ago", "yesterday", "3 days ago"; older edits show the date. */
function ago(ms: number): string {
  const s = (ms - Date.now()) / 1000, rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (s > -60) return "just now";
  if (s > -3600) return rtf.format(Math.round(s / 60), "minute");
  if (s > -86400) return rtf.format(Math.round(s / 3600), "hour");
  if (s > -7 * 86400) return rtf.format(Math.round(s / 86400), "day");
  return new Date(ms).toLocaleDateString();
}

/** Cycles dark/light from whatever is showing now; the choice is stored by setTheme. */
function themeButton(): HTMLButtonElement {
  const b = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet theme", textContent: "◐", title: "Switch between dark and light" });
  b.setAttribute("aria-label", "Theme");
  const dark = () => (getTheme() === "auto" ? matchMedia("(prefers-color-scheme: dark)").matches : getTheme() === "dark");
  const sync = () => b.setAttribute("aria-pressed", String(dark()));
  sync();
  b.onclick = () => (setTheme(nextTheme(getTheme(), matchMedia("(prefers-color-scheme: dark)").matches)), sync());
  return b;
}

// Object URLs for the Home thumbnails; freed when Home is drawn again or a project opens.
let thumbUrls: string[] = [];
const revokeThumbs = () => (thumbUrls.forEach((u) => URL.revokeObjectURL(u)), (thumbUrls = []));

const ZIP_TIP = "A .zip of this project: project.json (timeline, cast, settings) and every image and sound. Open it again from the home page.";

export function mountApp(root: HTMLElement): void {
  let current: Project | null = null;
  let timer = 0;
  let status: HTMLElement | null = null;

  const save = async () => {
    clearTimeout(timer);
    if (!current) return;
    try {
      await saveProject(current);
      if (status) status.textContent = "Saved";
    } catch {
      toast("Could not save to this browser's storage. Use Download project to keep a copy.", "error");
      if (status) status.textContent = "Not saved";
    }
  };
  // Autosave 1 s after the last change.
  const changed = () => {
    if (status) status.textContent = "Saving…";
    clearTimeout(timer);
    timer = window.setTimeout(save, 1000);
  };

  const route = async () => {
    await save(); // flush a pending change before leaving a project
    const id = projectIdFromHash();
    current = id ? await loadProject(id) : null;
    if (id && !current) {
      toast("That project is not in this browser any more.", "error");
      location.hash = "";
      return;
    }
    current ? showProject(current) : showHome();
  };

  // A project zip, from the Open a project box or the sample.
  async function openZip(blob: Blob, once = false) {
    try {
      const zipped = await fromZip(blob);
      const have = once ? (await listProjects()).find((x) => x.name === zipped.name) : undefined;
      if (have) {
        location.hash = `#/p/${have.id}`;
        return;
      }
      const p = importAs(zipped, (await listProjects()).map((x) => x.id));
      await saveProject(p);
      if (p !== zipped) toast(`This project is already here, so the zip was opened as “${p.name}”.`);
      location.hash = `#/p/${p.id}`;
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function showHome() {
    status = null;
    const list = await listProjects();
    root.innerHTML = `
    <canvas class="home-fx" aria-hidden="true"></canvas>
    <header class="bar"><span class="brand"><span class="mark" aria-hidden="true"></span>Pixel Cutscene</span><span class="grow"></span></header>
    <main class="home">
      <h1>Make a pixel-art cutscene</h1>
      <p class="hint">Describe a scene, add your character sprites, then export a pixel-perfect video. No account needed, and AI drafting is optional.</p>
      <ul class="pgrid start-cards">
        <li><button class="pcard start" type="button" data-act="new" aria-label="Start a new cutscene"><span class="start-plus" aria-hidden="true">+</span><strong>New cutscene</strong><span class="small">Describe a scene and begin</span></button></li>
        <li><button class="pcard start" type="button" data-act="sample" aria-label="Open the sample"><span class="start-plus" aria-hidden="true">★</span><strong>Starter pack</strong><span class="small">A finished sample to learn from</span></button></li>
        <li><label class="pcard start" title="Open a project you downloaded as a .zip"><span class="start-plus" aria-hidden="true">↑</span><strong>Open a .zip</strong><span class="small">A project you downloaded</span><input type="file" accept=".zip,application/zip" class="pick" aria-label="Open a project (.zip)" /></label></li>
      </ul>
      <h2 class="projects-head">Your projects</h2>
      <ul class="pgrid projects"></ul>
    </main>`;
    root.querySelector(".bar")!.append(themeButton());
    startHomeFx(root.querySelector(".home-fx")!, root.querySelector(".home")!);
    root.querySelector<HTMLButtonElement>("[data-act=new]")!.onclick = async () => {
      const p = newProject("Untitled cutscene");
      await saveProject(p);
      location.hash = `#/p/${p.id}`;
    };
    const sample = root.querySelector<HTMLButtonElement>("[data-act=sample]")!;
    sample.onclick = async () => {
      sample.disabled = true;
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}sample/sample.zip`);
        if (!r.ok) throw new Error();
        await openZip(await r.blob(), true);
      } catch {
        toast("Could not load the sample. Check your connection and try again.", "error");
      } finally {
        sample.disabled = false;
      }
    };
    const zipInput = root.querySelector<HTMLInputElement>("input[type=file]")!;
    zipInput.onchange = async () => {
      const f = zipInput.files?.[0];
      zipInput.value = "";
      if (f) await openZip(f);
    };
    revokeThumbs();
    if (!list.length) root.querySelector(".projects")!.innerHTML = `<li class="small muted none">Nothing yet. Projects you make are kept in this browser.</li>`;
    root.querySelector(".projects")!.append(
      ...list.map(({ id, name, updated, thumb }) => {
        const li = document.createElement("li");
        li.className = "pcard";
        li.innerHTML = `<a class="proj"><span class="pthumb"></span><strong></strong><span class="small"></span></a><span class="pcard-acts"><button class="btn" type="button" title="${ZIP_TIP}">Download project</button><button class="btn quiet" type="button">Duplicate</button><button class="btn quiet danger" type="button">Delete</button></span>`;
        const a = li.querySelector("a")!;
        a.href = `#/p/${id}`;
        const box = a.querySelector<HTMLElement>(".pthumb")!;
        if (thumb) {
          const img = Object.assign(new Image(), { alt: "", src: URL.createObjectURL(thumb) });
          thumbUrls.push(img.src);
          box.append(img);
        } else box.classList.add("empty");
        a.querySelector("strong")!.textContent = name;
        const when = a.querySelector<HTMLElement>(".small")!;
        when.textContent = `Edited ${ago(updated)}`;
        when.title = new Date(updated).toLocaleString();
        const [zip, dup, del] = li.querySelectorAll("button");
        dup.onclick = async () => {
          if (dup.disabled) return;
          dup.disabled = true; // a double click makes one copy
          const p = await loadProject(id);
          if (!p) return void (dup.disabled = false);
          const tl = p.tl && { ...p.tl, name: `${p.tl.name}_copy` }; // its own Godot output folder
          await saveProject({ ...p, id: crypto.randomUUID(), name: `${name} copy`, tl, files: new Map(p.files) });
          await showHome();
        };
        zip.onclick = async () => {
          const p = await loadProject(id);
          if (p) await downloadProject(p);
        };
        del.onclick = async () => {
          if (!(await confirmDialog("Delete project", `Delete "${name}"? This can't be undone. Download the project first if you want to keep it.`, "Delete", "Cancel", true))) return;
          await deleteProject(id);
          await showHome();
        };
        return li;
      }),
    );
  }

  function showProject(p: Project) {
    revokeThumbs();
    root.innerHTML = `
    <header class="bar">
      <a class="brand" href="#"><span class="mark" aria-hidden="true"></span>Pixel Cutscene</a>
      <input class="name" aria-label="Project name" />
      <span class="grow"></span>
      <span class="band-slot" aria-live="polite"></span>
      <span class="save small muted" aria-live="polite" data-testid="save-status">Saved</span>
      <span class="theme-slot"></span>
      <button class="btn" type="button" data-act="settings">Settings</button>
      <button class="btn" type="button" data-act="zip" title="${ZIP_TIP}">Download project</button>
    </header>
    <main class="page"></main>`;
    status = root.querySelector(".save");
    root.querySelector(".theme-slot")!.replaceWith(themeButton());
    const name = root.querySelector<HTMLInputElement>(".name")!;
    name.value = p.name;
    name.oninput = () => {
      p.name = name.value.trim() || "Untitled cutscene";
      changed();
    };
    root.querySelector<HTMLButtonElement>("[data-act=zip]")!.onclick = () => downloadProject(p);
    root.querySelector<HTMLButtonElement>("[data-act=settings]")!.onclick = () => openSettings(() => showStep());
    const page = root.querySelector<HTMLElement>(".page")!;
    const go = (n: Step) => {
      p.step = n;
      save();
      showStep();
    };
    // Tweak (step 3) first if needed, then its Approvals dialog opens.
    const openNeeds = () => {
      if (p.step !== 3) go(3);
      page.querySelector(".tweak")?.dispatchEvent(new CustomEvent("pc:approvals"));
    };
    const refreshBand = () => {
      const slot = root.querySelector(".band-slot")!;
      const b = slot.querySelector<HTMLButtonElement>(".next-band") ?? undefined;
      const nb = nextBand(p, openNeeds, () => go(4), b);
      if (!b) slot.append(nb);
    };
    const edited = () => (changed(), refreshBand());
    const showStep = () => {
      root.querySelector(".steps")?.remove();
      name.after(stepBar(p.step, go));
      refreshBand();
      if (p.step === 1) renderCast(page, p, edited, go);
      else if (p.step === 2) renderScene(page, p, edited, go);
      else if (p.step === 3) renderTweak(page, p, edited, go);
      else renderExport(page, p, go);
    };
    showStep();
  }

  // A file dropped outside the drop zone would make the browser open it and leave the app.
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes("application/x-pcs-item")) return; // a library item dropped off target: nothing to say
    if (!(e.target as Element | null)?.closest?.(".drop")) toast("Drop the folder on the Use my sprites box", "error");
  });
  addEventListener("hashchange", route);
  addEventListener("beforeunload", () => void save());
  route();
}
