import { expect, test } from "@playwright/test";
import { openFixture } from "./fixture";

// fixes from the second UI critique (2026-11-11)

test("phone width: the effects library still shows tiles", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const grid = page.locator(".d-fx .d-grid");
  expect((await grid.boundingBox())!.height).toBeGreaterThan(80);
});

test("phone width: the steps sit right under the project name, before Settings and Download", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openFixture(page);
  const steps = (await page.locator(".bar .steps").boundingBox())!;
  const settings = (await page.getByRole("button", { name: "Settings" }).boundingBox())!;
  expect(steps.y).toBeLessThan(settings.y);
});

test("the Getting started card sits under the inspector, not above it", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const order = await page.locator(".side > section").evaluateAll((s) => s.map((x) => x.className.split(" ")[0]));
  expect(order.indexOf("inspector")).toBeLessThan(order.indexOf("guide-box"));
});

test("a piece to approve is amber, not an error, and the hint says how to approve it", async ({ page }) => {
  await openFixture(page, { unapproved: true, extraAnim: "walk" }); // only the tone waits, for approval
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const btn = page.getByRole("button", { name: "1 piece needs you" });
  const [color, accent] = await btn.evaluate((b) => [getComputedStyle(b).color, getComputedStyle(document.documentElement).getPropertyValue("--focus")]);
  const probe = await page.evaluate((c) => { const d = document.createElement("i"); d.style.color = c; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; }, accent.trim());
  expect(color).toBe(probe);
  await expect(page.locator(".needs-box .hint").first()).toHaveText("Play each piece, then Approve it or try again.");
});

test("file pickers are reachable from the keyboard", async ({ page }) => {
  await page.goto("/");
  const pick = page.getByLabel("Open a project (.zip)");
  await pick.focus();
  await expect(pick).toBeFocused();
});

test("[ and ] on a selected shot move its cuts to the playhead", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const canvas = page.getByTestId("preview");
  await expect(canvas).toHaveAttribute("data-ready", "1");
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight"); // 2.0 s
  await page.getByRole("button", { name: "+ Shot ▾" }).click();
  await page.getByRole("menuitem", { name: "Cut here" }).click();
  const second = page.locator(".clip.shot").nth(1);
  await expect(second).toHaveAttribute("aria-label", /, 2\.0 s/);
  await second.focus(); // selects it
  await canvas.focus();
  await page.keyboard.press("ArrowRight"); // 3.0 s
  await page.keyboard.press("[");
  await expect(page.locator(".clip.shot").nth(1)).toHaveAttribute("aria-label", /, 3\.0 s/);
});

test("a locked scene size says how to unlock it, with a way there", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await expect(page.getByLabel("Scene size")).toBeDisabled();
  await page.getByRole("button", { name: "Open Tweak" }).click();
  await expect(page.getByTestId("preview")).toBeVisible();
});

test("inspector labels are plain, sentence-case words", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.locator(".clip:not(.shot)").first().focus();
  await expect(page.getByLabel("Start (s)")).toBeVisible();
  await expect(page.getByLabel("Move", { exact: true })).toBeVisible();
});

test("Scene shows the chosen size at a fixed width, so a smaller scene shows bigger characters", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  const peek = page.locator("figure.scene-peek canvas");
  await expect(peek).toHaveAttribute("width", /^\d+$/);
  await page.getByLabel("Scene size").selectOption("3");
  await expect(peek).toHaveAttribute("width", "960");
  await page.getByLabel("Scene size").selectOption("0");
  await expect(peek).toHaveAttribute("width", "320");
  await expect(page.locator("figure.scene-peek figcaption")).toContainText("320×180");
});

test("phone width: the library is as tall as its lists, no empty tail", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  const [h, sum] = await page.locator(".drawer").evaluate((d) => [d.getBoundingClientRect().height, [...d.children].reduce((n, c) => n + c.getBoundingClientRect().height, 0)]);
  expect(h - sum).toBeLessThan(60); // padding and gaps only
});
