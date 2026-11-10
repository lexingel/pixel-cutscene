import { afterEach, expect, test, vi } from "vitest";
import { confirmPaid, type PaidTicket } from "../src/ai/confirm";
import { callApi, callFree, ProviderError, type Provider } from "../src/ai/http";
import { chat } from "../src/ai/providers";

const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const stub = (r: Response) => {
  const f = vi.fn(async () => r);
  vi.stubGlobal("fetch", f);
  return f;
};
const tk = async (p: Provider, calls = 1) => (await confirmPaid(p, "test", "free", calls, async () => true)) as PaidTicket;
afterEach(() => vi.unstubAllGlobals());

const fail = async (status: number) => {
  stub(reply(status));
  return callApi("anthropic", "https://api.anthropic.com/v1/messages", {}, await tk("anthropic")).catch((e) => e);
};

test("401_names_provider", async () => {
  const e = await fail(401);
  expect(e).toBeInstanceOf(ProviderError);
  expect(e).toMatchObject({ provider: "anthropic", status: 401, message: "Anthropic rejected the key" });
});
test("402_credits_message", async () => {
  expect((await fail(402)).message).toBe("Anthropic says the account is out of credits");
});
test("429_message", async () => {
  expect((await fail(429)).message).toBe("Anthropic is rate-limiting, try again in a minute");
});
test("no_retry", async () => {
  const f = stub(reply(429));
  await callApi("openai", "https://api.openai.com/v1/x", {}, await tk("openai")).catch(() => {});
  expect(f).toHaveBeenCalledTimes(1);
});
test("host_allowlist", async () => {
  const f = stub(reply(200));
  await expect(callApi("pixellab", "https://api.elevenlabs.io/v1/x", { headers: { Authorization: "Bearer k" } }, await tk("pixellab"))).rejects.toThrow();
  await expect(callApi("pixellab", "http://api.pixellab.ai/v2/x", {}, await tk("pixellab"))).rejects.toThrow();
  await expect(callApi("pixellab", "https://api.pixellab.ai.evil.com/x", {}, await tk("pixellab"))).rejects.toThrow();
  expect(f).not.toHaveBeenCalled();
});
test("anthropic_request_shape", async () => {
  const f = stub(reply(200, { content: [{ type: "text", text: "hi" }] }));
  const out = await chat({ provider: "anthropic", model: "claude-opus-5-5", key: "K" }, "sys", "usr", await tk("anthropic"));
  expect(out).toBe("hi");
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
  const h = init.headers as Record<string, string>;
  expect(url).toBe("https://api.anthropic.com/v1/messages");
  expect(h["x-api-key"]).toBe("K");
  expect(h["anthropic-dangerous-direct-browser-access"]).toBe("true");
  expect(h["anthropic-version"]).toBeTruthy();
  const b = JSON.parse(init.body as string);
  expect(b).toMatchObject({ model: "claude-opus-5-5", system: "sys", messages: [{ role: "user", content: "usr" }] });
});
test("openai_request_shape", async () => {
  const f = stub(reply(200, { choices: [{ message: { content: "yo" } }] }));
  expect(await chat({ provider: "openai", model: "m", key: "K" }, "sys", "usr", await tk("openai"))).toBe("yo");
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.openai.com/v1/chat/completions");
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer K");
  expect(JSON.parse(init.body as string).messages).toEqual([
    { role: "system", content: "sys" },
    { role: "user", content: "usr" },
  ]);
});
test("gemini_request_shape", async () => {
  const f = stub(reply(200, { candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }] }));
  expect(await chat({ provider: "google", model: "gm", key: "K" }, "sys", "usr", await tk("google"))).toBe("ab");
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gm:generateContent");
  expect(url).not.toContain("K");
  expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("K");
  expect(JSON.parse(init.body as string)).toMatchObject({
    systemInstruction: { parts: [{ text: "sys" }] },
    contents: [{ role: "user", parts: [{ text: "usr" }] }],
  });
});

const AN = "https://api.anthropic.com/v1/messages";
test("redirect_never_followed", async () => {
  const f = stub(reply(200));
  await callApi("anthropic", AN, { redirect: "follow" }, await tk("anthropic"));
  expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe("error");
});
test("no_ticket_throws_before_fetch", async () => {
  const f = stub(reply(200));
  await expect(callApi("anthropic", AN, {}, undefined as never)).rejects.toThrow();
  await expect(callApi("anthropic", AN, {}, {} as PaidTicket)).rejects.toThrow();
  expect(f).not.toHaveBeenCalled();
});
test("wrong_provider_ticket_throws", async () => {
  const f = stub(reply(200));
  await expect(callApi("anthropic", AN, {}, await tk("openai"))).rejects.toThrow();
  expect(f).not.toHaveBeenCalled();
});
test("ticket_single_use_and_calls_n", async () => {
  const f = stub(reply(200));
  const t = await tk("anthropic");
  await callApi("anthropic", AN, {}, t);
  await expect(callApi("anthropic", AN, {}, t)).rejects.toThrow();
  const t2 = await tk("anthropic", 2);
  await callApi("anthropic", AN, {}, t2);
  await callApi("anthropic", AN, {}, t2);
  await expect(callApi("anthropic", AN, {}, t2)).rejects.toThrow();
  expect(f).toHaveBeenCalledTimes(3);
});
test("confirmPaid_true_gives_ticket_false_null", async () => {
  expect(await confirmPaid("openai", "a", "b", 1, async () => true)).toBeTruthy();
  expect(await confirmPaid("openai", "a", "b", 1, async () => false)).toBeNull();
});

test("callFree_get_only_and_allowlisted", async () => {
  const f = stub(reply(200, { ok: 1 }));
  await expect(callFree("pixellab", "https://api.pixellab.ai/v2/balance", { method: "POST" })).rejects.toThrow(/GET/);
  await expect(callFree("pixellab", "https://api.pixellab.ai.evil.com/v2/balance", {})).rejects.toThrow(/Blocked/);
  await expect(callFree("pixellab", "http://api.pixellab.ai/v2/balance", {})).rejects.toThrow(/Blocked/);
  // only the balance and job-status reads are free
  await expect(callFree("pixellab", "https://api.pixellab.ai/v2/characters", {})).rejects.toThrow(/Blocked/);
  await expect(callFree("pixellab", "https://api.pixellab.ai/v2/background-jobs", {})).rejects.toThrow(/Blocked/);
  await expect(callFree("anthropic", "https://api.anthropic.com/v1/models", {})).rejects.toThrow(/Blocked/);
  expect(f).not.toHaveBeenCalled();
  await callFree("pixellab", "https://api.pixellab.ai/v2/balance", { redirect: "follow" });
  await callFree("pixellab", "https://api.pixellab.ai/v2/background-jobs/job_1", {});
  expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe("error");
});
test("callFree_maps_errors", async () => {
  stub(reply(401));
  await expect(callFree("pixellab", "https://api.pixellab.ai/v2/balance", {})).rejects.toThrow("PixelLab rejected the key");
});

test("callFree_elevenlabs_voices_only", async () => {
  const f = stub(reply(200, { voices: [] }));
  await expect(callFree("elevenlabs", "https://api.elevenlabs.io/v1/text-to-speech/v1", {})).rejects.toThrow(/Blocked/);
  await expect(callFree("elevenlabs", "https://api.elevenlabs.io/v1/voices/abc", {})).rejects.toThrow(/Blocked/);
  await expect(callFree("elevenlabs", "https://api.elevenlabs.io/v1/voices", { method: "POST" })).rejects.toThrow(/GET/);
  expect(f).not.toHaveBeenCalled();
  await callFree("elevenlabs", "https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": "test-key" } });
  expect(f).toHaveBeenCalledTimes(1);
});
