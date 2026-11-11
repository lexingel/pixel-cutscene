// The asset kit: pieces the user supplied or generated. Generated pieces count only once approved.
export type Img = { w: number; h: number; px: Uint8ClampedArray }; // RGBA
export type Piece = { approved: boolean; source: "user" | "pixellab" | "elevenlabs" | "library" | "pixelfx"; ref?: string };
export type SizeName = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
export type Kit = {
  // voice: an ElevenLabs voice id; scale 2: frames were made at half size and are drawn doubled (Scale2x)
  chars: Record<string, { view: "side"; anims: Record<string, Piece & { frames: string[] }>; voice?: string; scale?: 2; size?: SizeName; /** a PixelLab character id: moves are posed from it */ pl?: string }>;
  faces: Record<string, Record<string, Piece & { path: string; /** mouth shapes for lip-sync, closed first */ mouths?: string[] }>>;
  assets: Record<
    string,
    Piece & {
      kind: "bg" | "backdrop" | "fx" | "music" | "sfx" | "voice";
      path: string;
      len?: number; // seconds, for audio: learnt when the clip is first decoded
      ground?: number; // a background's feet line, in its own pixels: a new shot on it starts with this ground
      fx?: { cols: number; frames: number; fps: number; loop: boolean; dx: number; dy: number };
    }
  >;
};
export type Status = "ok" | "missing" | "unapproved";
type Has = (path: string) => boolean;

// Draft renders accept unapproved pieces; absent pieces or files are never ok.
function status(p: Piece | undefined, paths: string[], draft: boolean, has: Has): Status {
  if (!p || !paths.length || !paths.every(has)) return "missing";
  return p.approved || draft ? "ok" : "unapproved";
}

export const animStatus = (kit: Kit, char: string, anim: string, draft = false, has: Has = () => true): Status => {
  const a = kit.chars[char]?.anims[anim];
  return status(a, a?.frames ?? [], draft, has);
};

export const faceStatus = (kit: Kit, face: string, expr: string, draft = false, has: Has = () => true): Status => {
  const f = kit.faces[face]?.[expr];
  return status(f, f ? [f.path] : [], draft, has);
};

export const assetStatus = (kit: Kit, id: string, draft = false, has: Has = () => true): Status => {
  const a = kit.assets[id];
  return status(a, a ? [a.path] : [], draft, has);
};

// Characters the scene may use: their idle is in and approved.
export const readyChars = (kit: Kit, has: Has = () => true): string[] =>
  Object.keys(kit.chars).filter((c) => animStatus(kit, c, "idle", false, has) === "ok");
