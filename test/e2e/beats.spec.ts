import { expect, test } from "@playwright/test";

const beats = { beats: [{ text: "A ghost rises in the cave.", shot: "wide", fx: "arcane/arcane-orb" }, { text: "It looks around.", move: "look_around" }] };
const timeline = {
  timeline: {
    name: "ghost", duration: 10,
    shots: [{ id: "s1", type: "wide", start: 0, end: 10, bg_scale: 1, camera: [{ t: 0, x: 0, y: 0 }] }],
    actors: [{ id: "g1", char: "ghost", x: 300, y: 400, actions: [{ id: "a1", t: 1, do: "look_around", dur: 2 }] }],
    fx: [], audio: [],
  },
  cast: [{ id: "ghost", look: "A pale ghost.", anims: [] }],
};

test("two-step draft: plan the beats, change one, then the timeline is drafted from the edited list", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pcs.keys", JSON.stringify({ ai: { provider: "anthropic", model: "m", key: "test-ai" } })));
  await page.route("https://**", (route) => (/^https:\/\/fonts\./.test(route.request().url()) ? route.continue() : route.abort()));
  const asked: string[] = [];
  await page.route("https://api.anthropic.com/**", (route) => {
    const r = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access, content-type" };
    if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    asked.push(r.postDataJSON().messages[0].content);
    const reply = asked.length === 1 ? beats : timeline;
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(reply) }] }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await page.getByTestId("scene-text").fill("A ghost rises in a dark cave.");
  await page.getByRole("button", { name: "Plan the beats first" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Run it" }).click();
  const list = page.getByTestId("beats");
  await expect(list).toHaveValue("1. A ghost rises in the cave. [wide · fx: arcane/arcane-orb]\n2. It looks around. [move: look_around]");
  await page.screenshot({ path: "test-results/s1-beats.png" });
  await list.fill("1. A ghost rises in the cave.\n2. It screams at the camera.");
  await page.getByRole("button", { name: "Draft the timeline from these beats" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Run it" }).click();
  await expect(page.getByRole("button", { name: "Cast", exact: true })).toHaveAttribute("aria-current", "step");
  expect(asked).toHaveLength(2);
  expect(asked[1]).toContain("It screams at the camera.");
  expect(asked[1]).toContain("A ghost rises in a dark cave.");
});
