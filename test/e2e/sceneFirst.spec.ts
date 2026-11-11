import { expect, test } from "@playwright/test";

// The AI reply names a character the kit does not have. No real host is reached: every https
// request is aborted except the stubbed Anthropic endpoint.
const look = "A pale ghost in tattered grey robes, floating a little above the ground.";
const reply = {
  timeline: {
    name: "cave", duration: 10,
    shots: [{ id: "s1", type: "wide", start: 0, end: 10, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
    actors: [{ id: "ghost1", char: "ghost", x: 300, y: 450, actions: [{ id: "g_float", t: 1, do: "anim:float", dur: 2 }] }],
    fx: [], audio: [],
  },
  cast: [{ id: "ghost", look, anims: ["float"] }],
};

test("scene first: draft names a ghost, Cast offers to make it", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("pcs.keys", JSON.stringify({ ai: { provider: "anthropic", model: "m", key: "test-ai" }, pixellab: "test-key" })),
  );
  const seen: string[] = [];
  await page.route("https://**", (route) => (seen.push(route.request().url()), route.abort()));
  await page.route("https://api.anthropic.com/**", (route) => {
    const r = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access, content-type" };
    if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    seen.push(`${r.method()} ${r.url()}`);
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(reply) }] }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  const steps = page.getByRole("navigation", { name: "Steps" }).getByRole("button");
  await expect(steps).toHaveText(["① Scene", "② Cast", "③ Tweak", "④ Export"]);
  await expect(steps.first()).toHaveAttribute("aria-current", "step");

  await page.getByTestId("scene-text").fill("A ghost rises in a dark cave.");
  await page.getByRole("button", { name: "Draft it" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Run it" }).click();

  await expect(page.getByRole("button", { name: "② Cast" })).toHaveAttribute("aria-current", "step");
  const card = page.getByTestId("needed").locator(".need-card", { hasText: "ghost" });
  await expect(card).toContainText("needs idle, float");
  await expect(card.getByLabel("Look of ghost")).toHaveValue(look);
  await page.screenshot({ path: "test-results/scene-first-cast-1280x800.png" });

  // an edited look is what the generator gets
  // typed key by key: the card must not re-render under the cursor
  await card.getByLabel("Look of ghost").press("End");
  await card.getByLabel("Look of ghost").pressSequentially(" Glowing eyes.");
  await expect(card.getByLabel("Look of ghost")).toHaveValue(look + " Glowing eyes.");
  await card.getByRole("button", { name: "Generate with PixelLab" }).click();
  await expect(page.getByLabel("Character name")).toHaveValue("ghost");
  await expect(page.getByLabel("Character name")).not.toBeEditable();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(look + " Glowing eyes.");

  expect(seen).toEqual(["POST https://api.anthropic.com/v1/messages"]);
});

test("scene first: without a PixelLab key the card's Generate is shut", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[accept*=zip]").waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const src = (f: string) => `/src/core/${f}.ts`;
    const { newProject, toZip } = await import(src("project"));
    const p = newProject("Pending");
    p.step = 1;
    p.cast = { ghost: { look: "a ghost", anims: [] } };
    const dt = new DataTransfer();
    dt.items.add(new File([await toZip(p)], "p.zip", { type: "application/zip" }));
    const input = document.querySelector<HTMLInputElement>("input[accept*=zip]")!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  const card = page.getByTestId("needed").locator(".need-card", { hasText: "ghost" });
  await expect(card.getByRole("button", { name: "Generate with PixelLab" })).toBeDisabled();
  await expect(card).toContainText("Add a PixelLab key in Settings to generate.");
  await expect(card.getByRole("button", { name: "Use my sprites" })).toBeEnabled();
  // the hero folder lands under the card's name, and the card goes once ghost has an idle
  await card.locator("input[type=file]").setInputFiles("test/fixtures/sprites/hero");
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByTestId("cast-list")).toContainText("ghost");
  await expect(page.getByTestId("cast-list")).not.toContainText("hero");
  await expect(page.getByTestId("needed")).toBeHidden();
});

test("without an AI key, Write it myself leads and Draft it says what it needs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await expect(page.getByRole("button", { name: "Write it myself" })).toHaveClass(/primary/);
  await expect(page.getByRole("button", { name: "Draft it (needs an AI key)" })).toBeDisabled();
});

test("the scene size names the real export size (the sample is 320×180 at ×4)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the sample" }).click();
  await page.getByRole("button", { name: "① Scene" }).click();
  await expect(page.getByLabel("Scene size")).toHaveValue("");
  await expect(page.locator(".scene-size option:checked")).toHaveText("320×180, ×4");
});
