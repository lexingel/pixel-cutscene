import { callApi } from "./http";
import type { PaidTicket } from "./confirm";
import type { AiProvider, Keys } from "./keys";

export const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-5",
  google: "gemini-2.5-pro",
};

const json = (h: Record<string, string>) => ({ "content-type": "application/json", ...h });

export async function chat(ai: NonNullable<Keys["ai"]>, system: string, user: string, ticket: PaidTicket): Promise<string> {
  const { provider, model, key } = ai;
  if (provider === "anthropic") {
    const r = await callApi("anthropic", "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: json({ "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }),
      body: JSON.stringify({ model, max_tokens: 4096, system, messages: [{ role: "user", content: user }] }),
    }, ticket);
    const d = await r.json();
    return (d.content as { text?: string }[]).map((c) => c.text ?? "").join("");
  }
  if (provider === "openai") {
    const r = await callApi("openai", "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: json({ Authorization: `Bearer ${key}` }),
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    }, ticket);
    return (await r.json()).choices[0].message.content as string;
  }
  // Gemini: key goes in a header, never the URL.
  const r = await callApi("google", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: json({ "x-goog-api-key": key }),
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }] }),
  }, ticket);
  return ((await r.json()).candidates[0].content.parts as { text?: string }[]).map((p) => p.text ?? "").join("");
}
