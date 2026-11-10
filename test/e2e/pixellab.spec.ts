import { expect, test, type Page } from "@playwright/test";
// @ts-ignore node types are not part of the browser build
import { readFileSync } from "node:fs";

// Every PixelLab call is answered from the hand-made fixtures; no real host is hit.
const fx = (n: string) => readFileSync(`test/fixtures/pixellab/${n}.json`, "utf8") as string;

// `hold` (when given) keeps job-status replies waiting until it resolves.
async function stubPixellab(page: Page, hold?: Promise<void>) {
  const seen: string[] = [];
  await page.route("https://api.pixellab.ai/**", async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname;
    seen.push(`${r.method()} ${path}`);
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" };
    if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const name =
      path === "/v2/balance" ? "balance"
      : path === "/v2/create-image-pixen" ? "create-image-pixen"
      : path === "/v2/animate-pixminimax" ? "job-accepted"
      : path.startsWith("/v2/background-jobs/") ? "job-anim-completed"
      : null;
    if (!name) return route.fulfill({ status: 404, headers: cors, body: "{}" });
    if (hold && name === "job-anim-completed") await hold;
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: fx(name) });
  });
  return seen;
}

test("pixellab: candidates, approve, idle, approve", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pcs.keys", JSON.stringify({ pixellab: "test-key" })));
  const seen = await stubPixellab(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await page.getByRole("button", { name: "② Cast" }).click();
  await page.getByRole("button", { name: "Generate with PixelLab" }).click();
  await page.getByLabel("Character name").fill("knight");
  await page.getByLabel("Description", { exact: true }).fill("a knight in dented armour");
  await page.getByRole("button", { name: "Generate 4 candidates" }).click();

  const dialog = page.locator("dialog[open]");
  await expect(dialog).toContainText("PixelLab: Generate 4 candidates for knight");
  await expect(dialog).toContainText("$4.20 credits, 450 of 2000 generations left");
  await dialog.getByRole("button", { name: "Run it" }).click();

  const grid = page.getByRole("group", { name: "Candidates" });
  await expect(grid.getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Approve this one" })).toBeDisabled();
  await page.screenshot({ path: "test-results/pixellab-candidates-1280x800.png" });

  await grid.getByRole("button", { name: "Candidate 2" }).click();
  await page.getByRole("button", { name: "Approve this one" }).click();
  await expect(page.getByTestId("cast-list")).toContainText("no idle yet");
  await page.getByRole("button", { name: "Generate idle" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Run it" }).click();
  await expect(page.locator(".gen-body .strip img")).toHaveCount(5);
  await expect(page.getByTestId("cast-list")).toContainText("idle not approved yet");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByTestId("cast-list")).toContainText("knight");
  await expect(page.getByTestId("cast-list")).toContainText("idle 5 frames");
  await expect(page.getByTestId("cast-list")).not.toContainText("not approved");

  // 4 paid creates, 1 paid animation, its free polling and the free balance reads
  const paid = seen.filter((s) => s.startsWith("POST"));
  expect(paid).toEqual([...Array(4).fill("POST /v2/create-image-pixen"), "POST /v2/animate-pixminimax"]);
});

test("pixellab: without a key the door stays shut", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await page.getByRole("button", { name: "② Cast" }).click();
  await expect(page.getByRole("button", { name: "Generate with PixelLab" })).toBeDisabled();
  await expect(page.getByText("Add a PixelLab key in Settings to generate.")).toBeVisible();
});

test("pixellab: a row is locked while its Redo runs", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pcs.keys", JSON.stringify({ pixellab: "test-key" })));
  let release = () => {};
  await stubPixellab(page, new Promise<void>((r) => (release = r)));
  await page.goto("/");
  await page.locator("input[accept*=zip]").waitFor({ state: "attached" });
  // hero: approved idle from the user, a generated walk still to approve
  await page.evaluate(async () => {
    const src = (f: string) => `/src/core/${f}.ts`; // served by vite; a variable keeps tsc from resolving it
    const { newProject, toZip } = await import(src("project"));
    const p = newProject("Redo fixture");
    p.canvas = { W: 320, H: 180, exportScale: 2 };
    const idle = [0, 1, 2, 3].map((i) => `chars/hero/idle/idle_${i}.png`);
    const walk = [0, 1].map((i) => `chars/hero/walk/walk_${i}.png`);
    for (const [i, f] of idle.entries()) p.files.set(f, await (await fetch(`/test/fixtures/sprites/hero/idle_${i}.png`)).blob());
    for (const [i, f] of walk.entries()) p.files.set(f, await (await fetch(`/test/fixtures/sprites/hero/idle_${i}.png`)).blob());
    p.kit.chars.hero = { view: "side", anims: { idle: { approved: true, source: "user", frames: idle }, walk: { approved: false, source: "pixellab", frames: walk } } };
    p.tl = {
      name: "redo", duration: 5,
      shots: [{ id: "s1", type: "wide", start: 0, end: 5, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
      actors: [{ id: "hero1", char: "hero", x: 80, y: 150, actions: [{ id: "a1", t: 1, do: "walk", to: [200, 150], dur: 2 }] }],
      fx: [], audio: [],
    };
    const dt = new DataTransfer();
    dt.items.add(new File([await toZip(p)], "redo.zip", { type: "application/zip" }));
    const input = document.querySelector<HTMLInputElement>("input[accept*=zip]")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.getByLabel("Project name")).toHaveValue("Redo fixture");
  await page.getByRole("button", { name: "③ Tweak" }).click();
  const row = page.getByTestId("needs").locator("li", { hasText: "hero walk" });
  await row.getByRole("button", { name: "Redo" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Run it" }).click();
  // the job is held: nothing on the row can be pressed
  for (const name of ["Approve", "Redo", "Generate"]) await expect(row.getByRole("button", { name, exact: true })).toBeDisabled();
  release();
  await expect(page.getByText("Generated. Look it over, then Approve or Redo.")).toBeVisible();
  const fresh = page.getByTestId("needs").locator("li", { hasText: "hero walk" });
  await expect(fresh.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
});

test("pixellab: Settings shows the balance", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pcs.keys", JSON.stringify({ pixellab: "test-key" })));
  await stubPixellab(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByTestId("pixellab-balance")).toHaveText("PixelLab balance: $4.20 credits, 450 of 2000 generations left");
});

test("settings: Enter in a key field saves, it does not cancel", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await page.getByRole("button", { name: "② Cast" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  const field = page.locator("dialog input[name=pixellab]");
  await field.fill("test-key");
  await field.press("Enter");
  await expect(page.locator("dialog")).toHaveCount(0);
  const saved = await page.evaluate(() => !!JSON.parse(localStorage.getItem("pcs.keys") || "{}")?.pixellab);
  expect(saved).toBe(true);
  await expect(page.getByRole("button", { name: "Generate with PixelLab" })).toBeEnabled();
});

test("settings: every key label sits on the same row as its own box", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  for (const name of ["provider", "model", "ai", "pixellab", "elevenlabs"]) {
    const box = await page.locator(`dialog [name=${name}]`).boundingBox();
    const text = await page.locator(`dialog label:has([name=${name}])`).evaluate((l) => {
      const r = document.createRange();
      r.setStart(l.firstChild!, 0);
      r.setEnd(l.firstChild!, (l.firstChild as Text).length);
      const b = r.getBoundingClientRect();
      return { y: b.y + b.height / 2 };
    });
    expect(Math.abs(box!.y + box!.height / 2 - text.y), name).toBeLessThan(8);
  }
});
