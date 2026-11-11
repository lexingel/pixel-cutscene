// Backup to a folder the user picks once (File System Access API, Chromium only). Each autosave version also
// writes <name>-<id>.zip there, over the last one; another browser or a cleared cache cannot lose that copy.
import { toZip, type Project } from "./project";
import { getMeta, setMeta } from "./store";

type Perm = "granted" | "prompt" | "denied";
type Dir = {
  name: string;
  queryPermission(o: { mode: "readwrite" }): Promise<Perm>;
  requestPermission(o: { mode: "readwrite" }): Promise<Perm>;
  getFileHandle(n: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;
};
const picker = () => (window as unknown as { showDirectoryPicker?: (o: object) => Promise<Dir> }).showDirectoryPicker;
const KEY = "backupDir";
let mem: Dir | null | undefined; // undefined = not read yet
const dir = async () => (mem === undefined ? (mem = (await getMeta<Dir>(KEY)) ?? null) : mem);

export const canBackUp = () => typeof window !== "undefined" && !!picker();

/** The zip's name: the project name made safe for a file system, plus the start of its id so two "Untitled" never collide. */
export const backupName = (p: Pick<Project, "id" | "name">) => `${p.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 60) || "cutscene"}-${p.id.slice(0, 8)}.zip`;

/** null when no folder is set; state "prompt" after a reload (the browser asks again, on a click). */
export async function backupFolder(): Promise<{ name: string; state: Perm } | null> {
  const d = await dir();
  return d ? { name: d.name, state: await d.queryPermission({ mode: "readwrite" }) } : null;
}

/** Opens the folder picker (needs a click). Returns the folder's name, or null when cancelled. */
export async function chooseBackupFolder(): Promise<string | null> {
  try {
    const d = await picker()!({ id: "pixel-cutscene-backup", mode: "readwrite" });
    mem = d;
    await setMeta(KEY, d).catch(() => {}); // kept for the next visit; this visit works from memory either way
    return d.name;
  } catch {
    return null; // cancelled
  }
}

export async function allowBackupAgain(): Promise<boolean> {
  const d = await dir();
  return !!d && (await d.requestPermission({ mode: "readwrite" })) === "granted";
}

export const stopBackup = () => ((mem = null), setMeta(KEY, undefined));

/** Writes the zip when a folder is set and allowed; false otherwise (never asks: that needs a click). */
export async function backUp(p: Project): Promise<boolean> {
  const d = await dir();
  if (!d || (await d.queryPermission({ mode: "readwrite" })) !== "granted") return false;
  const w = await (await d.getFileHandle(backupName(p), { create: true })).createWritable();
  await w.write(await toZip(p));
  await w.close();
  return true;
}
