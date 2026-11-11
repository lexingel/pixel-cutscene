import { expect, test } from "@playwright/test";
import { openFixture } from "./fixture";

test("next band", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the sample" }).click();
  await expect(page).toHaveURL(/#\/p\//);
  const band = page.getByTestId("next-band");
  await expect(band).toContainText("Ready to export");
  await band.click();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toHaveAttribute("aria-current", "step");
});

test("theme toggle", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the sample" }).click();
  await expect(page).toHaveURL(/#\/p\//);
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", /^(dark|light)$/);
  const v = await html.getAttribute("data-theme");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", v!);
});

test("approvals overlay", async ({ page }) => {
  await openFixture(page); // the hero's walk is missing
  const band = page.getByTestId("next-band");
  await expect(band).toContainText("waits for you");
  await band.click();
  const dlg = page.getByRole("dialog", { name: "Approve pieces" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId("needs")).toContainText("hero walk");
  await expect(dlg.locator("li[data-cat=char] .tag.missing")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(band).toBeFocused();
});

test("an empty timeline has no ready band, and the theme toggle says which way it is set", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await page.getByRole("button", { name: "Start an empty timeline" }).click();
  await expect(page.getByTestId("next-band")).toBeHidden();
  const theme = page.getByRole("button", { name: "Theme", exact: true });
  const before = await theme.getAttribute("aria-pressed");
  await theme.click();
  expect(await theme.getAttribute("aria-pressed")).not.toBe(before);
});

for (const from of ["Scene", "Cast"]) {
  test(`next band from ${from} lands on Tweak with the approvals open`, async ({ page }) => {
    await openFixture(page); // starts on Scene; the hero's walk is missing
    await page.getByRole("button", { name: from, exact: true }).click();
    await page.getByTestId("next-band").click();
    await expect(page.getByRole("button", { name: "Tweak", exact: true })).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("dialog", { name: "Approve pieces" })).toBeVisible();
  });
}

test("home card without a background", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a new cutscene" }).click();
  await expect(page).toHaveURL(/#\/p\//);
  await page.goto("/#");
  const card = page.locator(".projects li", { hasText: "Untitled cutscene" });
  await expect(card.locator(".pthumb.empty")).toHaveCount(1);
  await expect(card.locator("img")).toHaveCount(0);
});

test("home card with a background shows it pixelated", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the sample" }).click();
  await expect(page).toHaveURL(/#\/p\//);
  await page.goto("/#");
  const img = page.locator(".projects li .pthumb img");
  await expect(img).toHaveCount(1);
  await expect(img).toHaveCSS("image-rendering", "pixelated");
  expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  const noSideways = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth);

  test("phone has no sideways scroll", async ({ page }) => {
    await page.goto("/");
    expect(await noSideways(page)).toBeLessThanOrEqual(375);
    await page.getByRole("button", { name: "Open the sample" }).click();
    await expect(page).toHaveURL(/#\/p\//);
    await page.getByRole("button", { name: "Tweak", exact: true }).click();
    await expect(page.getByTestId("next-band")).toBeVisible();
    expect(await noSideways(page)).toBeLessThanOrEqual(375);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    expect(await noSideways(page)).toBeLessThanOrEqual(375);
  });

  test("a new 480x270 scene picture fits its box, scaled by a whole-number ratio", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start a new cutscene" }).click();
    const c = page.locator(".scene-peek canvas");
    await expect(c).toBeVisible();
    const r = await c.evaluate((e: HTMLCanvasElement) => ({ w: e.getBoundingClientRect().width, n: e.width, box: e.parentElement!.clientWidth }));
    expect(r.n).toBe(480);
    expect(r.w).toBeLessThanOrEqual(r.box);
    const q = r.w > r.n ? r.w / r.n : r.n / r.w;
    expect(Math.abs(q - Math.round(q))).toBeLessThan(0.01);
  });

  test("scene picture and cast frames are scaled by whole numbers", async ({ page }) => {
    await openFixture(page);
    const c = page.locator(".scene-peek canvas");
    await expect(c).toBeVisible();
    const r = await c.evaluate((e: HTMLCanvasElement) => ({ w: e.getBoundingClientRect().width, n: e.width }));
    expect(r.w % r.n).toBe(0);
    await page.getByRole("button", { name: "Cast", exact: true }).click();
    const img = page.locator("img.frame").first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => { const h = e.getBoundingClientRect().height; return e.naturalHeight > 0 && h % e.naturalHeight === 0; })).toBe(true);
  });
});

test("busy cards shimmer, still under reduced motion, and an error toast carries a top band", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", `<div id="b" aria-busy="true" data-cat="char"><span class="card-band">Character</span></div><div class="toast error" id="t">Failed</div>`);
  });
  const anim = () => page.locator("#b .card-band").evaluate((e) => getComputedStyle(e).animationName);
  expect(await anim()).not.toBe("none");
  const t = await page.locator("#t").evaluate((e) => { const s = getComputedStyle(e); return [s.borderTopWidth, s.borderLeftWidth]; });
  expect(t).toEqual(["4px", "1px"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await anim()).toBe("none");
});

test("a .frame.playing motion preview keeps its 160px CSS box, whole-number scaled", async ({ page }) => {
  await openFixture(page);
  const h = await page.evaluate(async () => {
    const c = Object.assign(document.createElement("canvas"), { width: 20, height: 30 });
    const img = Object.assign(document.createElement("img"), { className: "px frame playing", src: c.toDataURL() });
    document.body.append(img);
    await new Promise((r) => (img.complete && img.naturalWidth ? r(0) : img.addEventListener("load", () => r(0))));
    await new Promise((r) => setTimeout(r, 50));
    return img.getBoundingClientRect().height;
  });
  expect(h).toBe(150); // 30px art: k = floor(160/30) = 5; never the 72px strip box
});
