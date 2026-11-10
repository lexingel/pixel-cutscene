// Keys live only in this browser's localStorage and are sent only to their own provider (see http.ts).
export type AiProvider = "anthropic" | "openai" | "google";
export type Keys = { ai?: { provider: AiProvider; model: string; key: string }; pixellab?: string; elevenlabs?: string };

const KEY = "pcs.keys";

export function getKeys(): Keys {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Keys;
  } catch {
    return {};
  }
}

export function setKeys(k: Keys): void {
  if (Object.keys(k).length) localStorage.setItem(KEY, JSON.stringify(k));
  else localStorage.removeItem(KEY);
}
