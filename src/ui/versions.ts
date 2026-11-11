// Versions: named and automatic copies of the project, restore or download one, and the backup folder.
import { allowBackupAgain, backUp, backupFolder, canBackUp, chooseBackupFolder, stopBackup } from "../core/folderBackup";
import { toZip, type Project } from "../core/project";
import { AUTO_EVERY, AUTO_KEEP, deleteSnapshot, listSnapshots, loadSnapshot, snapshot } from "../core/store";
import { confirmDialog, toast } from "./dialogs";

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function download(b: Blob, name: string) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(b), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** `p` is the open project; `restore` swaps in an older copy (the caller saves it and redraws). */
export function openVersions(p: Project, restore: (old: Project) => Promise<void>): void {
  const d = document.createElement("dialog");
  d.className = "dialog versions";
  d.setAttribute("aria-labelledby", "versions-h");
  d.innerHTML = `<form method="dialog"><h2 id="versions-h">Versions</h2>
    <p>Autosave keeps a copy every ${AUTO_EVERY / 60_000} minutes while you work (the newest ${AUTO_KEEP}). Name a version to keep it until you delete it.</p>
    <div class="row ver-new"><input aria-label="Version name" placeholder="Before the big fight" maxlength="60" /><button type="button" class="btn" data-act="save">Save a version</button></div>
    <ul class="ver-list" data-testid="versions"></ul>
    <section class="ver-folder" hidden><h3>Backup folder</h3><p class="small" data-testid="backup-state"></p><div class="row"></div></section>
    <div class="row end"><button value="close" class="btn">Close</button></div></form>`;
  const list = d.querySelector<HTMLElement>(".ver-list")!;
  const label = d.querySelector<HTMLInputElement>("input")!;

  async function draw() {
    const vs = await listSnapshots(p.id);
    list.replaceChildren();
    if (!vs.length) list.innerHTML = `<li class="small muted">No versions yet.</li>`;
    for (const v of vs) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="ver-what"><strong></strong><span class="small muted"></span></span><button type="button" class="btn quiet" data-act="restore">Restore</button><button type="button" class="btn quiet" data-act="zip" title="Download this version as a project .zip">.zip</button><button type="button" class="btn quiet danger" data-act="del">Delete</button>`;
      li.querySelector("strong")!.textContent = v.kind === "manual" ? v.label : "Autosave";
      li.querySelector(".small")!.textContent = `${when(v.at)} · ${v.name}`;
      const [res, zip, del] = li.querySelectorAll("button");
      res.onclick = async () => {
        if (!(await confirmDialog("Restore this version?", `The project goes back to how it was on ${when(v.at)}. What you have now is kept first, as the version “Before restoring”.`, "Restore"))) return;
        const old = await loadSnapshot(v.key);
        if (!old) return toast("That version is gone.", "error");
        await snapshot(p, "manual", "Before restoring");
        d.close();
        await restore(old);
        toast(`Restored the version from ${when(v.at)}.`);
      };
      zip.onclick = async () => {
        const old = await loadSnapshot(v.key);
        if (old) download(await toZip(old), `${old.name} (${v.kind === "manual" ? v.label : "autosave"}).zip`);
      };
      del.onclick = async () => {
        await deleteSnapshot(v.key);
        await draw();
      };
      list.append(li);
    }
  }

  d.querySelector<HTMLButtonElement>("[data-act=save]")!.onclick = async () => {
    await snapshot(p, "manual", label.value.trim() || `Version ${when(Date.now())}`);
    label.value = "";
    backUp(p).catch(() => {});
    await draw();
  };
  label.onkeydown = (e) => e.key === "Enter" && (e.preventDefault(), d.querySelector<HTMLButtonElement>("[data-act=save]")!.click());

  async function drawFolder() {
    const sec = d.querySelector<HTMLElement>(".ver-folder")!;
    if (!canBackUp()) return; // Firefox and Safari: no folder access; Download project is the backup there
    sec.hidden = false;
    const state = sec.querySelector<HTMLElement>("[data-testid=backup-state]")!;
    const row = sec.querySelector<HTMLElement>(".row")!;
    const btn = (text: string, f: () => Promise<unknown>, quiet = false) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: `btn${quiet ? " quiet" : ""}`, textContent: text });
      b.onclick = async () => (await f(), drawFolder());
      return b;
    };
    const f = await backupFolder();
    row.replaceChildren();
    const choose = btn(f ? "Change folder" : "Choose a backup folder", async () => {
      if (await chooseBackupFolder()) await backUp(p).catch(() => toast("Could not write to that folder.", "error"));
    }, !!f);
    if (!f) {
      state.textContent = "Pick a folder on this computer and each autosave also writes this project there as a .zip, safe from a cleared browser.";
      row.append(choose);
    } else if (f.state === "granted") {
      state.textContent = `Backing up to the folder “${f.name}”.`;
      row.append(choose, btn("Stop", stopBackup, true));
    } else {
      state.textContent = `The browser needs your OK again to write to “${f.name}”.`;
      row.append(btn("Allow again", async () => (await allowBackupAgain()) && backUp(p)), choose, btn("Stop", stopBackup, true));
    }
  }

  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  d.showModal();
  draw();
  drawFolder();
}
