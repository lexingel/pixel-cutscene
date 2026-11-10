import type { Img } from "../core/kit";
import type { Project } from "../core/project";
import { KNOWN_ANIMS, checkSprite, downscale, guessAnims } from "../core/spriteImport";
import { assignFrame, baseName as base, charDir, dropChar, freePath, pendingChars, unassigned } from "../core/cast";
import { confirmDialog, toast } from "./dialogs";
import { refPath } from "../gen/pixellab";
import { NO_KEY, pixellabKey, renderGenChar } from "./pixellab";

type Picked = { rel: string; file: File }; // rel = path inside the character folder

const UNASSIGNED = "_unassigned";

export async function decode(b: Blob): Promise<Img> {
  const bmp = await createImageBitmap(b);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return { w: c.width, h: c.height, px: g.getImageData(0, 0, c.width, c.height).data };
}

export function encode(img: Img): Promise<Blob> {
  const c = new OffscreenCanvas(img.w, img.h);
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.px), img.w, img.h), 0, 0);
  return c.convertToBlob({ type: "image/png" });
}

// One dropped folder = one character. Returns the name when added.
export async function importFolder(p: Project, name: string, picked: Picked[]): Promise<string | null> {
  const pngs = picked.filter((f) => /\.png$/i.test(f.rel));
  if (!pngs.length) return toast(`No PNG frames found in “${name}”.`, "error"), null;
  if (p.kit.chars[name] && !(await confirmDialog(`Replace ${name}?`, `${name} is already in the cast. Its frames will be replaced by this folder.`, "Replace")))
    return null;
  const side = await confirmDialog(
    "Is this a side-view sprite?",
    `The character faces left or right, seen from the side (not from above, and not drawn in 8 directions).`,
    "Yes",
    "No",
  );
  if (!side) return toast("v1 supports side-view sprites only", "error"), null;

  let imgs: Img[];
  try {
    imgs = await Promise.all(pngs.map((f) => decode(f.file)));
  } catch {
    return toast(`Some files in “${name}” are not readable PNG images.`, "error"), null;
  }
  const check = checkSprite(imgs);
  if (!check.ok) return toast(`${name} was not added: ${check.reason}.`, "error"), null;
  const blobs = check.scale > 1 ? await Promise.all(imgs.map((i) => encode(downscale(i, check.scale)))) : pngs.map((f) => f.file as Blob);
  const byRel = new Map(pngs.map((f, i) => [f.rel, blobs[i]]));

  dropChar(p, name);
  const anims: Project["kit"]["chars"][string]["anims"] = {};
  for (const [anim, rels] of Object.entries(guessAnims(pngs.map((f) => f.rel)))) {
    const dir = charDir(name) + (anim === "?" ? UNASSIGNED : anim) + "/";
    const paths = rels.map((r) => {
      const path = freePath(p, dir, base(r)); // same name in two subfolders: idle_0.png, idle_0_2.png
      p.files.set(path, byRel.get(r)!);
      return path;
    });
    if (anim !== "?") anims[anim] = { approved: true, source: "user", frames: paths };
  }
  p.kit.chars[name] = { view: "side", anims };
  if (check.scale > 1) toast(`${name} was drawn at ×${check.scale}; stored at 1 pixel per pixel.`);
  return name;
}

// Folder entries from a drag-and-drop (DataTransfer gives no webkitRelativePath).
async function readDir(dir: FileSystemDirectoryEntry, prefix = ""): Promise<Picked[]> {
  const reader = dir.createReader();
  const entries: FileSystemEntry[] = [];
  for (let batch: FileSystemEntry[]; (batch = await new Promise((r, j) => reader.readEntries(r, j))).length; ) entries.push(...batch);
  const out: Picked[] = [];
  for (const e of entries) {
    if (e.isDirectory) out.push(...(await readDir(e as FileSystemDirectoryEntry, prefix + e.name + "/")));
    else out.push({ rel: prefix + e.name, file: await new Promise<File>((r, j) => (e as FileSystemFileEntry).file(r, j)) });
  }
  return out;
}

const summary = (anims: Record<string, { frames: string[] }>) =>
  Object.entries(anims).map(([a, v]) => `${a} ${v.frames.length} frame${v.frames.length === 1 ? "" : "s"}`).join(" · ");

export function renderCast(root: HTMLElement, p: Project, changed: () => void, go: (n: 3) => void): void {
  let selected = Object.keys(p.kit.chars)[0] ?? "";
  let urls: string[] = [];
  const url = (path: string) => {
    const u = URL.createObjectURL(p.files.get(path)!);
    urls.push(u);
    return u;
  };

  root.innerHTML = `
  <section class="needed" data-testid="needed" hidden>
    <h2>Needed by your scene</h2>
    <ul class="needed-cards"></ul>
  </section>
  <div class="cast">
    <aside class="cast-side">
      <h2>Add a character</h2>
      <label class="door drop" tabindex="0">
        <strong>Use my sprites</strong>
        <span>Drop a character folder here, or click to pick one.</span>
        <span class="small">PNG frames named like idle_0.png, walk1.png, or in folders like idle/ and walk/.</span>
        <input type="file" webkitdirectory multiple hidden />
      </label>
      <div class="door off">
        <button class="btn" type="button" data-act="gen">Generate with PixelLab</button>
        <span class="small"></span>
      </div>
      <h2>Cast</h2>
      <ul class="cast-list" data-testid="cast-list"></ul>
    </aside>
    <section class="cast-main"></section>
  </div>`;
  const list = root.querySelector<HTMLUListElement>(".cast-list")!;
  const needed = root.querySelector<HTMLElement>(".needed")!;
  const main = root.querySelector<HTMLElement>(".cast-main")!;
  const drop = root.querySelector<HTMLLabelElement>(".drop")!;
  const input = drop.querySelector("input")!;
  const genBtn = root.querySelector<HTMLButtonElement>("[data-act=gen]")!;
  genBtn.disabled = !pixellabKey();
  genBtn.nextElementSibling!.textContent = pixellabKey() ? "Describe a character and pick one of four." : NO_KEY;
  const finished = (n: string) => ((selected = n), draw());
  const saved = () => (changed(), drawList());
  genBtn.onclick = () => {
    selected = "";
    drawList();
    renderGenChar(main, p, saved, finished);
  };

  const add = async (name: string, picked: Picked[]) => {
    const added = await importFolder(p, name, picked);
    if (added) {
      selected = added;
      changed();
      draw();
    }
  };
  // A picked folder; `fixed` names the character (a card's id) instead of the folder name.
  const picked = (inp: HTMLInputElement, fixed?: string) => async () => {
    const files = [...(inp.files ?? [])];
    inp.value = "";
    if (!files.length) return;
    const name = fixed ?? files[0].webkitRelativePath.split("/")[0];
    await add(name, files.map((file) => ({ file, rel: file.webkitRelativePath.split("/").slice(1).join("/") })));
  };
  input.onchange = picked(input);
  drop.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.click());
  drop.ondragover = (e) => (e.preventDefault(), drop.classList.add("over"));
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = async (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const dirs = [...(e.dataTransfer?.items ?? [])].map((i) => i.webkitGetAsEntry()).filter((x): x is FileSystemDirectoryEntry => !!x?.isDirectory);
    if (!dirs.length) return toast("Drop a folder (one per character), not single files.", "error");
    for (const d of dirs) await add(d.name, await readDir(d));
  };

  function draw() {
    drawList();
    const names = Object.keys(p.kit.chars);
    if (!names.length) {
      main.innerHTML = `<div class="empty-page"><p class="hint"></p></div>`;
      main.querySelector(".hint")!.textContent = pendingChars(p).length
        ? "Generate or add sprites for each character your scene needs, above."
        : "Drop a folder of PNG frames into “Use my sprites” on the left to start your cast. Each folder is one character.";
      return;
    }
    if (!selected) return;
    // a generated character goes back to its idle step until the idle is approved
    if (p.files.has(refPath(selected)) && !p.kit.chars[selected].anims.idle?.approved) return renderGenChar(main, p, saved, finished, selected);
    drawMapping(selected);
  }

  function drawList() {
    urls.forEach(URL.revokeObjectURL);
    urls = [];
    const names = Object.keys(p.kit.chars);
    list.replaceChildren(
      ...names.map((n) => {
        const li = document.createElement("li");
        const b = Object.assign(document.createElement("button"), { type: "button", className: "cast-item" });
        if (n === selected) b.setAttribute("aria-current", "true");
        const first =
          p.kit.chars[n].anims.idle?.frames[0] ?? Object.values(p.kit.chars[n].anims)[0]?.frames[0] ?? (p.files.has(refPath(n)) ? refPath(n) : undefined);
        const thumb = first ? Object.assign(document.createElement("img"), { src: url(first), alt: "", className: "px thumb" }) : document.createElement("span");
        thumb.classList.add("thumb");
        const loose = unassigned(p, n).length;
        const text = document.createElement("span");
        text.innerHTML = `<strong></strong><span class="small"></span>`;
        text.querySelector("strong")!.textContent = n;
        const idle = p.kit.chars[n].anims.idle;
        const waiting = !idle ? "no idle yet" : idle.approved ? "" : "idle not approved yet";
        text.querySelector(".small")!.textContent = [summary(p.kit.chars[n].anims), loose ? `${loose} unassigned` : "", waiting].filter(Boolean).join(" · ");
        b.append(thumb, text);
        b.onclick = () => ((selected = n), draw());
        li.append(b);
        return li;
      }),
    );
    if (!names.length) list.innerHTML = `<li class="small muted">No characters yet.</li>`;
    drawNeeded();
  }

  // One card per character the scene asked for that is not usable yet.
  function drawNeeded() {
    const pending = pendingChars(p);
    needed.hidden = !pending.length;
    needed.querySelector("ul")!.replaceChildren(
      ...pending.map((id) => {
        const need = p.cast[id];
        const li = document.createElement("li");
        li.className = "need-card";
        li.innerHTML = `<div class="row between"><strong></strong><span class="small"></span></div>
          <label class="need-look"><span class="small">Look</span><textarea rows="3"></textarea></label>
          <div class="row"><button class="btn primary" type="button" data-act="gen-need">Generate with PixelLab</button>
          <button class="btn" type="button" data-act="own-need">Use my sprites</button>
          <input type="file" webkitdirectory multiple hidden /></div>
          <span class="small no-key"></span>`;
        li.querySelector("strong")!.textContent = id;
        li.querySelector(".between .small")!.textContent = `needs ${["idle", ...need.anims].join(", ")}`;
        const look = li.querySelector("textarea")!;
        look.setAttribute("aria-label", `Look of ${id}`);
        look.value = need.look;
        look.oninput = () => ((need.look = look.value), changed());
        const gen = li.querySelector<HTMLButtonElement>("[data-act=gen-need]")!;
        gen.disabled = !pixellabKey();
        li.querySelector(".no-key")!.textContent = pixellabKey() ? "" : NO_KEY;
        gen.onclick = () => {
          selected = "";
          drawList();
          // a generated character whose idle is not approved yet picks up where it stopped
          if (p.kit.chars[id] && p.files.has(refPath(id))) renderGenChar(main, p, saved, finished, id);
          else renderGenChar(main, p, saved, finished, undefined, { name: id, desc: need.look.trim() });
        };
        const own = li.querySelector<HTMLInputElement>("input[type=file]")!;
        own.onchange = picked(own, id);
        li.querySelector<HTMLButtonElement>("[data-act=own-need]")!.onclick = () => own.click();
        return li;
      }),
    );
  }

  function drawMapping(name: string) {
    const c = p.kit.chars[name];
    const loose = unassigned(p, name);
    main.innerHTML = `<header class="row between"><div><h1></h1><p class="hint"></p></div>
      <div class="row"><button class="btn" type="button" data-act="remove">Remove</button>
      <button class="btn primary" type="button" data-act="next">Next: Tweak</button></div></header><div class="anims"></div>`;
    main.querySelector("h1")!.textContent = name;
    main.querySelector(".hint")!.textContent = loose.length
      ? `Pick an animation for each unassigned frame below, then add another character or go to ③ Tweak.`
      : !c.anims.idle
        ? `Every character needs idle frames: drop a folder with idle_0.png and up, or assign frames to idle.`
        : `Add another character, or go to ③ Tweak when your cast is complete.`;
    main.querySelector<HTMLButtonElement>("[data-act=next]")!.onclick = () => go(3);
    main.querySelector<HTMLButtonElement>("[data-act=remove]")!.onclick = async () => {
      if (!(await confirmDialog(`Remove ${name}?`, `${name} and its frames leave this project. Your files on disk stay as they are.`, "Remove"))) return;
      dropChar(p, name);
      selected = Object.keys(p.kit.chars)[0] ?? "";
      changed();
      draw();
    };
    const box = main.querySelector<HTMLElement>(".anims")!;
    for (const [anim, a] of Object.entries(c.anims)) {
      const row = document.createElement("div");
      row.className = "anim";
      row.innerHTML = `<div class="anim-label"><strong></strong><span class="small"></span></div><div class="strip"></div>`;
      row.querySelector("strong")!.textContent = anim;
      row.querySelector(".small")!.textContent = `${a.frames.length} frame${a.frames.length === 1 ? "" : "s"}`;
      row.querySelector(".strip")!.append(...a.frames.map((f) => Object.assign(document.createElement("img"), { src: url(f), alt: `${anim} ${base(f)}`, className: "px frame", title: base(f) })));
      box.append(row);
    }
    if (loose.length) {
      const row = document.createElement("div");
      row.className = "anim loose";
      row.innerHTML = `<div class="anim-label"><strong>Unassigned</strong><span class="small">names not recognised</span></div><div class="strip"></div>`;
      for (const f of loose) {
        const fig = document.createElement("figure");
        const sel = document.createElement("select");
        sel.setAttribute("aria-label", `Animation for ${base(f)}`);
        sel.innerHTML = `<option value="">Assign to…</option>` + KNOWN_ANIMS.map((k) => `<option>${k}</option>`).join("");
        sel.onchange = () => {
          assignFrame(p, name, f, sel.value);
          changed();
          draw();
        };
        const cap = document.createElement("figcaption");
        cap.textContent = base(f);
        fig.append(Object.assign(document.createElement("img"), { src: url(f), alt: base(f), className: "px frame" }), cap, sel);
        row.querySelector(".strip")!.append(fig);
      }
      box.append(row);
    }
  }

  draw();
}
