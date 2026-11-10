// Shared vocabulary for the timeline JSON. Field names match scenes/rift.json exactly.

export interface CamKey { t: number; x: number; y: number }

interface ShotBase {
  id: string;
  start: number;
  end: number;
  bg?: string;
  fade_in?: number;
  fade_out?: number;
  flash?: number; // seconds of white flash at the shot's start
  shake?: number; // seconds of camera shake at the shot's start (wide shots)
  locked?: boolean;
}
/** Zoom eased from `from` to `to` across the shot, centred on (x, y) in frame pixels as far as the frame allows. */
export interface Zoom { from: number; to: number; x: number; y: number; actor?: string } // actor: follow them instead of (x, y)
// ground: the y (scene px) where feet stand on this shot's background; an editing guide, actors snap to it
export interface WideShot extends ShotBase { type: "wide"; camera: CamKey[]; bg_scale: number; zoom?: Zoom; ground?: number }
export interface CloseupShot extends ShotBase { type: "closeup"; face: string; expr: string }
export type Shot = WideShot | CloseupShot;

export interface Action {
  id: string;
  t: number;
  do: string; // idle | walk | look_around | startle | move | anim:<name>
  to?: [number, number];
  dur?: number;
  text?: string; // say: the words in the bubble
  style?: "bubble" | "box"; // say: a bubble over the head (default) or a dialogue box along the bottom
  locked?: boolean;
}

export interface Actor {
  id: string;
  char: string;
  x: number;
  y: number;
  flip?: boolean;
  appear?: number;
  actions: Action[];
  locked?: boolean;
}

export interface FxEntry { id: string; t: number; fx: string; x: number; y: number; flip?: boolean; angle?: number; reach?: number; dur?: number; locked?: boolean }

export type AudioKind = "music" | "sfx" | "voice";
export interface AudioEntry {
  id: string;
  t: number;
  clip: string;
  kind: AudioKind;
  line?: string;
  speaker?: string; // optional: the character whose kit voice speaks this line
  bubble?: "bubble" | "box" | "none"; // voice: how the line shows on screen (default bubble over the speaker)
  vol_db?: number;
  locked?: boolean;
}

export interface Timeline {
  name: string;
  duration: number;
  kit?: string;
  closeup_scale?: number;
  shots: Shot[];
  actors: Actor[];
  fx: FxEntry[];
  audio: AudioEntry[];
}

export interface ParseResult { ok: boolean; errors: string[]; data: Timeline | null }
