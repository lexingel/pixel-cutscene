// The single path for provider HTTP calls. Never retries; refuses any host that is not the provider's own.
import { spendTicket, type PaidTicket } from "./confirm";
export type Provider = "anthropic" | "openai" | "google" | "pixellab" | "elevenlabs";

const HOST: Record<Provider, string> = {
  anthropic: "api.anthropic.com",
  openai: "api.openai.com",
  google: "generativelanguage.googleapis.com",
  pixellab: "api.pixellab.ai",
  elevenlabs: "api.elevenlabs.io",
};
export const PROVIDER_NAME: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  pixellab: "PixelLab",
  elevenlabs: "ElevenLabs",
};

export class ProviderError extends Error {
  constructor(
    readonly provider: Provider,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

function allow(provider: Provider, url: string): void {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== HOST[provider]) {
    throw new Error(`Blocked: ${PROVIDER_NAME[provider]} calls may only go to ${HOST[provider]}`);
  }
}

// redirect: "error" so a redirect can never carry the key header to another host.
async function send(provider: Provider, url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, redirect: "error" });
  if (res.ok) return res;
  const n = PROVIDER_NAME[provider];
  const msg =
    res.status === 401 ? `${n} rejected the key`
    : res.status === 402 ? `${n} says the account is out of credits`
    : res.status === 429 ? `${n} is rate-limiting, try again in a minute`
    : `${n} returned an error (${res.status})`;
  throw new ProviderError(provider, res.status, msg);
}

export async function callApi(provider: Provider, url: string, init: RequestInit, ticket: PaidTicket): Promise<Response> {
  allow(provider, url);
  spendTicket(provider, ticket);
  return send(provider, url, init);
}

// The only reads that may skip the paid-call confirm.
const FREE: Partial<Record<Provider, RegExp>> = {
  pixellab: /^\/v2\/(balance|background-jobs\/[^/]+)$/,
  elevenlabs: /^\/v1\/voices$/,
};

// Free reads (balance, job status): GET only, so nothing paid can go out without a ticket.
export async function callFree(provider: Provider, url: string, init: RequestInit): Promise<Response> {
  if ((init.method ?? "GET").toUpperCase() !== "GET") throw new Error("Blocked: only GET calls may skip the paid-call confirm");
  allow(provider, url);
  if (!FREE[provider]?.test(new URL(url).pathname)) throw new Error(`Blocked: ${new URL(url).pathname} is not a free ${PROVIDER_NAME[provider]} read`);
  return send(provider, url, { ...init, method: "GET" });
}
