import { startHomeFx } from "./homeFx";
import { importAs } from "../core/cast";
import { fromZip, newProject, toZip, type Project } from "../core/project";
import { deleteProject, listProjects, loadProject, saveProject } from "../core/store";
import { renderCast } from "./cast";
import { renderScene } from "./scene";
import { renderTweak } from "./tweak";
import { confirmDialog, toast } from "./dialogs";
import { openSettings } from "./settings";
import { renderExport } from "./exportStep";
import { stepBar, type Step } from "./steps";

// Route lives in the hash (#/p/<id>) so a reload reopens the same project.
const projectIdFromHash = () => location.hash.match(/^#\/p\/(.+)$/)?.[1] ?? null;

async function downloadZip(p: Project) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await toZip(p)), download: `${p.name}.zip` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

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
      toast("Could not save to this browser's storage. Download a zip to keep your work.", "error");
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

  // A project zip, from the Open zip box or the sample.
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
    <header class="bar"><span class="brand">Pixel Cutscene</span></header>
    <main class="home">
      <h1>Make a pixel-art cutscene</h1>
      <p class="hint">Describe a scene, add your character sprites, then export a pixel-perfect video. No account or keys needed.</p>
      <div class="row wrap start-row">
        <button class="btn primary" type="button" data-act="new">Start a new cutscene</button>
        <button class="btn" type="button" data-act="sample">Open the sample</button>
        <label class="btn">Open zip<input type="file" accept=".zip,application/zip" hidden /></label>
      </div>
      <h2 class="projects-head">Your projects</h2>
      <ul class="projects"></ul>
    </main>`;
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
    if (!list.length) root.querySelector(".projects")!.innerHTML = `<li class="small muted">Nothing yet. Projects you make are kept in this browser.</li>`;
    root.querySelector(".projects")!.append(
      ...list.map(({ id, name, updated }) => {
        const li = document.createElement("li");
        li.innerHTML = `<a class="proj"><strong></strong><span class="small"></span></a><button class="btn" type="button">Download zip</button><button class="btn quiet" type="button">Duplicate</button><button class="btn quiet danger" type="button">Delete</button>`;
        const a = li.querySelector("a")!;
        a.href = `#/p/${id}`;
        a.querySelector("strong")!.textContent = name;
        a.querySelector(".small")!.textContent = `Edited ${new Date(updated).toLocaleString()}`;
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
          if (p) await downloadZip(p);
        };
        del.onclick = async () => {
          if (!(await confirmDialog("Delete project", `Delete "${name}"? This can't be undone. Download the zip first if you want to keep it.`, "Delete", "Cancel", true))) return;
          await deleteProject(id);
          await showHome();
        };
        return li;
      }),
    );
  }

  function showProject(p: Project) {
    root.innerHTML = `
    <header class="bar">
      <a class="brand" href="#">Pixel Cutscene</a>
      <input class="name" aria-label="Project name" />
      <span class="grow"></span>
      <span class="save small muted" aria-live="polite" data-testid="save-status">Saved</span>
      <button class="btn" type="button" data-act="settings">Settings</button>
      <button class="btn" type="button" data-act="zip">Download zip</button>
    </header>
    <main class="page"></main>`;
    status = root.querySelector(".save");
    const name = root.querySelector<HTMLInputElement>(".name")!;
    name.value = p.name;
    name.oninput = () => {
      p.name = name.value.trim() || "Untitled cutscene";
      changed();
    };
    root.querySelector<HTMLButtonElement>("[data-act=zip]")!.onclick = () => downloadZip(p);
    root.querySelector<HTMLButtonElement>("[data-act=settings]")!.onclick = () => openSettings(() => showStep());
    const page = root.querySelector<HTMLElement>(".page")!;
    const go = (n: Step) => {
      p.step = n;
      save();
      showStep();
    };
    const showStep = () => {
      root.querySelector(".steps")?.remove();
      name.after(stepBar(p.step, go));
      if (p.step === 1) renderCast(page, p, changed, go);
      else if (p.step === 2) renderScene(page, p, changed, go);
      else if (p.step === 3) renderTweak(page, p, changed, go);
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
