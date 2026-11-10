// Shared vocabulary for the timeline JSON. Field names match scenes/rift.json exactly.

export interface CamKey { t: number; x: number; y: number }

interface ShotBase {
  id: string;
  start: number;
  end: number;
  bg?: string;
  fade_in?: number;
  fade_out?: number;
  locked?: boolean;
}
export interface WideShot extends ShotBase { type: "wide"; camera: CamKey[]; bg_scale: number }
export interface CloseupShot extends ShotBase { type: "closeup"; face: string; expr: string }
export type Shot = WideShot | CloseupShot;

export interface Action {
  id: string;
  t: number;
  do: string; // idle | walk | look_around | startle | move | anim:<name>
  to?: [number, number];
  dur?: number;
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

export interface FxEntry { id: string; t: number; fx: string; x: number; y: number; flip?: boolean; angle?: number; dur?: number; locked?: boolean }

export type AudioKind = "music" | "sfx" | "voice";
export interface AudioEntry {
  id: string;
  t: number;
  clip: string;
  kind: AudioKind;
  line?: string;
  speaker?: string; // optional: the character whose kit voice speaks this line
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
