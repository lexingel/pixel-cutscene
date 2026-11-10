// Plain names for the `do` ids, shown wherever a move is picked or labelled.
export const DUST_DUR = 1.5;

const LABELS: Record<string, string> = {
  idle: "Stand",
  walk: "Walk to…",
  move: "Move to…",
  look_around: "Look around",
  startle: "Startle",
  hurt: "Hurt",
  dust: "Turn to dust",
  "anim:attack": "Attack",
  "anim:breathe": "Breathe fire",
};

export function moveLabel(doId: string): string {
  return LABELS[doId] ?? (doId.startsWith("anim:") ? `Play: ${doId.slice(5)}` : doId);
}
