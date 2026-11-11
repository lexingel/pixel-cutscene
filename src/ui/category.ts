/** The four asset categories; each gets a colour band in the library and on the timeline. */
export type Cat = "char" | "place" | "fx" | "sound";
export const CAT_LABEL: Record<Cat, string> = { char: "Character", place: "Place", fx: "Effect", sound: "Sound" };
export const catOfItem = (kind: "char" | "fx" | "clip" | "track" | "sound"): Cat => (kind === "char" ? "char" : kind === "fx" ? "fx" : "sound");
export const catOfTrack = (track: "shots" | "actor" | "fx" | "dialogue" | "sfx" | "music"): Cat =>
  track === "shots" ? "place" : track === "actor" ? "char" : track === "fx" ? "fx" : "sound";
