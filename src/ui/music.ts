import type { Kit } from "../core/kit";
import type { Project } from "../core/project";
import type { Timeline } from "../core/types";
import { freePath } from "../core/cast";
import { toast } from "./dialogs";

export type Track = { id: string; title: string; artist: string; license: string; source_url: string; file: string; seconds: number; mood: string[] };

const base = () => import.meta.env.BASE_URL;
let cache: Promise<Track[]> | null = null;
export const loadTracks = (): Promise<Track[]> =>
  (cache ??= fetch(`${base()}music/manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`manifest ${r.status}`);
    return r.json();
  }).catch((e) => ((cache = null), Promise.reject(e))));

export const attribution = (t: Track) => `${t.title} by ${t.artist}, ${t.license}, ${t.source_url}`;
export const needsCredit = (t: Track) => t.license !== "CC0-1.0";
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** credits.txt text for the library tracks the timeline plays that need attribution; "" when none. */
export function creditsText(tl: Timeline, kit: Kit, tracks: Track[]): string {
  const used = new Set(tl.audio.filter((a) => a.kind === "music").map((a) => kit.assets[a.clip]).filter((a) => a?.source === "library").map((a) => a.ref));
  return tracks.filter((t) => used.has(t.id) && needsCredit(t)).map(attribution).join("\n");
}

/** Fetches the track into the project and (re)points the kit asset `id` at it: approved, source "library". */
export async function useTrack(p: Project, id: string, t: Track): Promise<void> {
  const r = await fetch(`${base()}music/${t.file}`);
  if (!r.ok) throw new Error(`${t.file} ${r.status}`);
  const old = p.kit.assets[id];
  if (old?.source === "library" && old.ref === t.id && p.files.has(old.path)) return void (old.approved = true);
  const path = freePath(p, "audio/", `${id}.ogg`);
  p.files.set(path, await r.blob());
  p.kit.assets[id] = { approved: true, source: "library", ref: t.id, kind: "music", path };
}

/** Modal track list with mood filter, one-at-a-time preview and a Use button. Resolves true when a track was used. */
export async function pickTrack(p: Project, id: string, tracksIn?: Track[]): Promise<boolean> {
  let tracks: Track[];
  try {
    tracks = tracksIn ?? (await loadTracks());
  } catch {
    toast("Could not load the music library. Check your connection and try again.", "error");
    return false;
  }
  const d = document.createElement("dialog");
  d.className = "dialog music-picker";
  d.setAttribute("aria-label", "Music library");
  d.innerHTML = `<form method="dialog"><h2>Music library</h2><label>Mood <select data-act="mood"></select></label>
    <ul class="music-list" data-testid="tracks"></ul><div class="row end"><button value="cancel" class="btn">Close</button></div></form>`;
  const moods = [...new Set(tracks.flatMap((t) => t.mood))].sort();
  const sel = d.querySelector<HTMLSelectElement>("select")!;
  sel.append(...["", ...moods].map((m) => Object.assign(document.createElement("option"), { value: m, textContent: m || "all" })));
  const list = d.querySelector("ul")!;
  const audio = new Audio();
  let playing: HTMLButtonElement | null = null;
  const stop = () => {
    audio.pause();
    if (playing) playing.textContent = "Play";
    playing = null;
  };
  audio.onended = stop;
  let used = false;
  // One Use at a time; while it runs, Close, Escape and every Use wait, so the kit change is always
  // followed by the caller's save. If the dialog closes anyway (a repeated Escape), the result waits for it.
  let inflight: Promise<void> | null = null;
  const close = d.querySelector<HTMLButtonElement>("button[value=cancel]")!;
  const lock = (on: boolean) => [close, ...list.querySelectorAll<HTMLButtonElement>("[data-act=use]")].forEach((b) => (b.disabled = on));
  d.addEventListener("cancel", (e) => inflight && e.preventDefault());
  const draw = () => {
    stop();
    list.replaceChildren(...tracks.filter((t) => !sel.value || t.mood.includes(sel.value)).map((t) => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="grow"><strong></strong><div class="small meta"></div><div class="small credit"></div></div>
        <button class="btn quiet" type="button" data-act="play">Play</button><button class="btn primary" type="button" data-act="use">Use</button>`;
      li.querySelector("strong")!.textContent = t.title;
      li.querySelector(".meta")!.textContent = `${t.artist} · ${mmss(t.seconds)} · ${t.mood.join(", ")}`;
      if (needsCredit(t)) {
        const c = li.querySelector(".credit")!;
        c.textContent = attribution(t);
        const copy = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: "Copy" });
        copy.onclick = () => void navigator.clipboard?.writeText(attribution(t)).then(() => toast("Credit copied."));
        c.append(" ", copy);
      }
      const play = li.querySelector<HTMLButtonElement>("[data-act=play]")!;
      play.onclick = () => {
        const was = playing;
        stop();
        if (was === play) return;
        audio.src = `${base()}music/${t.file}`;
        void audio.play().catch((e: Error) => {
          if (e.name === "AbortError") return; // Stop or another Play before it loaded
          if (playing === play) stop();
          toast(`Could not play ${t.title}.`, "error");
        });
        playing = play;
        play.textContent = "Stop";
      };
      const use = li.querySelector<HTMLButtonElement>("[data-act=use]")!;
      use.disabled = !!inflight;
      use.onclick = () => {
        if (inflight) return;
        lock(true);
        inflight = (async () => {
          try {
            await useTrack(p, id, t);
            used = true;
            toast(`${t.title} added.`);
            d.close();
          } catch {
            toast(`Could not load ${t.title}.`, "error");
          } finally {
            inflight = null;
            lock(false);
          }
        })();
      };
      return li;
    }));
  };
  sel.onchange = draw;
  draw();
  document.body.append(d);
  d.showModal();
  return new Promise((res) =>
    d.addEventListener("close", () => {
      stop();
      audio.removeAttribute("src");
      d.remove();
      void (inflight ?? Promise.resolve()).then(() => res(used));
    }),
  );
}
