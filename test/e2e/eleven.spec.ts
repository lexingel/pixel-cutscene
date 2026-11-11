import { expect, test, type Page } from "@playwright/test";
import { closeApprovals, openApprovals } from "./fixture";
// @ts-ignore node types are not part of the browser build
import { readFileSync } from "node:fs";

// Every ElevenLabs call is answered from hand-made fixtures; no real host is hit.
const fx = (n: string) => readFileSync(`test/fixtures/eleven/${n}`) as Uint8Array;

async function stubEleven(page: Page) {
  const seen: { m: string; path: string; key: string | undefined; body: string | null }[] = [];
  await page.route("https://api.elevenlabs.io/**", async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname;
    seen.push({ m: r.method(), path, key: r.headers()["xi-api-key"], body: r.postData() });
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "xi-api-key, content-type" };
    if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (path === "/v1/voices") return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: fx("voices.json") as never });
    if (path.startsWith("/v1/text-to-speech/") || path === "/v1/sound-generation")
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "audio/mpeg" }, body: fx("speech.mp3") as never });
    return route.fulfill({ status: 404, headers: cors, body: "{}" });
  });
  return seen;
}

async function open(page: Page, speaker?: string) {
  await page.goto("/");
  await page.locator("input[accept*=zip]").waitFor({ state: "attached" });
  await page.evaluate(async (speaker) => {
    const src = (f: string) => `/src/core/${f}.ts`; // served by vite; a variable keeps tsc from resolving it
    const { newProject, toZip } = await import(src("project"));
    const p = newProject("Voice fixture");
    p.canvas = { W: 320, H: 180, exportScale: 2 };
    const idle = [0, 1, 2, 3].map((i) => `chars/hero/idle/idle_${i}.png`);
    for (const [i, f] of idle.entries()) p.files.set(f, await (await fetch(`/test/fixtures/sprites/hero/idle_${i}.png`)).blob());
    p.kit.chars.hero = { view: "side", anims: { idle: { approved: true, source: "user", frames: idle } } };
    p.tl = {
      name: "voice", duration: 5,
      shots: [{ id: "s1", type: "wide", start: 0, end: 5, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
      actors: [{ id: "hero1", char: "hero", x: 80, y: 150, actions: [] }],
      fx: [],
      audio: [
        { id: "vo1", t: 1, clip: "vo_close", kind: "voice", line: "Stay close.", speaker },
        { id: "boom", t: 3, clip: "sfx_rumble", kind: "sfx" },
      ],
    };
    const dt = new DataTransfer();
    dt.items.add(new File([await toZip(p)], "voice.zip", { type: "application/zip" }));
    const input = document.querySelector<HTMLInputElement>("input[accept*=zip]")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  }, speaker);
  await expect(page.getByLabel("Project name")).toHaveValue("Voice fixture");
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
}

test("elevenlabs: pick a voice, generate a line and a sound, approve", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pcs.keys", JSON.stringify({ elevenlabs: "test-key" })));
  const seen = await stubEleven(page);
  await open(page);
  await openApprovals(page);
  const needs = page.getByTestId("needs");
  const vo = needs.locator("li", { hasText: "vo_close" });
  await expect(vo.getByRole("button", { name: "Generate" })).toBeDisabled();

  await closeApprovals(page);
  await page.locator("[data-id=vo1]").click();
  await page.getByLabel("Speaker").selectOption("hero");
  const voice = page.getByLabel("voice for hero");
  await expect(voice.locator("option", { hasText: "Aria" })).toHaveCount(1);
  await voice.selectOption("v_aria_01");
  await openApprovals(page);
  await expect(vo.getByRole("button", { name: "Generate" })).toBeEnabled();

  await vo.getByRole("button", { name: "Generate" }).click();
  const dialog = page.locator("dialog[open]:not(.approvals)");
  await expect(dialog).toContainText("ElevenLabs: Generate voice line vo close");
  await expect(dialog).toContainText("11 characters");
  await dialog.getByRole("button", { name: "Run it" }).click();
  const fresh = needs.locator("li", { hasText: "vo_close" });
  await expect(fresh.locator("audio")).toHaveCount(1);
  await expect(fresh.getByRole("button", { name: "Try again" })).toBeEnabled();
  await fresh.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(needs.locator("li", { hasText: "vo_close" })).toHaveCount(0);

  const sfx = needs.locator("li", { hasText: "sfx_rumble" });
  await sfx.getByRole("button", { name: "Generate" }).click();
  await expect(page.locator("dialog[open]:not(.approvals)")).toContainText("2 seconds");
  await page.locator("dialog[open]:not(.approvals)").getByRole("button", { name: "Run it" }).click();
  await expect(needs.locator("li", { hasText: "sfx_rumble" }).locator("audio")).toHaveCount(1);
  await page.screenshot({ path: "test-results/elevenlabs-needs-1280x800.png" });

  const posts = seen.filter((s) => s.m === "POST");
  expect(posts.map((s) => s.path)).toEqual(["/v1/text-to-speech/v_aria_01", "/v1/sound-generation"]);
  expect(JSON.parse(posts[0].body!)).toMatchObject({ text: "Stay close.", model_id: "eleven_v3" });
  expect(seen.every((s) => s.key === "test-key" || s.m === "OPTIONS")).toBe(true);
});

test("elevenlabs: without a key Generate is off with a hint", async ({ page }) => {
  await open(page);
  await openApprovals(page);
  const sfx = page.getByTestId("needs").locator("li", { hasText: "sfx_rumble" });
  const gen = sfx.getByRole("button", { name: "Generate" });
  await expect(gen).toBeDisabled();
  await expect(gen).toHaveAttribute("title", "Add an ElevenLabs key in Settings to generate.");
  // without a key the voice id is typed, not picked
  await closeApprovals(page);
  await page.locator("[data-id=vo1]").click();
  await page.getByLabel("Speaker").selectOption("hero");
  await page.getByLabel("voice for hero").fill("my_voice_id");
  await page.getByLabel("voice for hero").press("Tab");
  await expect(page.getByLabel("voice for hero")).toHaveValue("my_voice_id");
});

test("elevenlabs: a missing speaker is flagged and a failed voice list falls back to typing", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pcs.keys", JSON.stringify({ elevenlabs: "test-key" })));
  await page.route("https://api.elevenlabs.io/**", (route) =>
    route.fulfill({ status: route.request().method() === "OPTIONS" ? 204 : 500, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "xi-api-key, content-type" }, body: "{}" }));
  await open(page, "ghost");
  await openApprovals(page);
  const vo = page.getByTestId("needs").locator("li", { hasText: "vo_close" });
  await expect(vo.getByRole("button", { name: "Generate" })).toHaveAttribute("title", "ghost is not in the cast. Pick a speaker in the inspector.");
  await closeApprovals(page);
  await page.locator("[data-id=vo1]").click();
  await expect(page.getByLabel("Speaker").locator("option", { hasText: "ghost (missing)" })).toHaveCount(1);
  await page.getByLabel("Speaker").selectOption("hero");
  await expect(page.getByText("Could not load voices. Type a voice id.")).toBeVisible();
  await expect(page.getByLabel("voice for hero")).toHaveJSProperty("tagName", "INPUT");
});

test("elevenlabs: a sound is generated from its own bar's inspector", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pcs.keys", JSON.stringify({ elevenlabs: "test-key" })));
  await stubEleven(page);
  await open(page);
  await page.locator("[data-id=boom]").click();
  await page.locator(".inspector").getByRole("button", { name: "Generate with ElevenLabs" }).click();
  await expect(page.locator("dialog[open]:not(.approvals)")).toContainText("ElevenLabs: Generate sound sfx rumble");
  await page.locator("dialog[open]:not(.approvals)").getByRole("button", { name: "Run it" }).click();
  await expect(page.getByTestId("needs").locator("li", { hasText: "sfx_rumble" }).locator("audio")).toHaveCount(1);
});
