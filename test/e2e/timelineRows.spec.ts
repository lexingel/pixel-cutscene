import { expect, test } from "@playwright/test";
import { openFixture } from "./fixture";

test("+ Character adds an actor; + opens an effects row and × takes an empty one out; a bar click moves the playhead", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await page.getByRole("button", { name: "+ Character" }).click();
  await page.getByRole("menuitem", { name: "hero", exact: true }).click();
  await expect(page.locator(".track-label[data-actor=actor1]")).toHaveCount(1);

  await page.getByRole("button", { name: "Add an effects row" }).click();
  await expect(page.locator(".track-label[data-fxrow]")).toHaveText([/FX 2/, /FX 1/]);
  await page.getByRole("button", { name: "Remove FX 2" }).click();
  await expect(page.locator(".track-label[data-fxrow]")).toHaveText([/Effects/]);

  await page.locator("[data-id=a1]").click();
  await expect(page.getByTestId("timecode")).toHaveText(/^00:01\.00/); // a1 starts at 1 s
});

test("view: groups fold and stay folded, rows go compact, zooming in shows the overview strip", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.getByTestId("preview")).toHaveAttribute("data-ready", "1");
  await page.locator("[data-group=chars]").click();
  await expect(page.locator(".track-label[data-actor]")).toHaveCount(0);
  await expect(page.locator(".gmark")).toHaveCount(1); // the folded row still shows where hero's walk is
  await page.reload();
  await page.getByRole("button", { name: "Tweak", exact: true }).click();
  await expect(page.locator("[data-group=chars]")).toHaveAttribute("aria-expanded", "false");
  await page.locator("[data-group=chars]").click();
  await expect(page.locator(".track-label[data-actor=hero1]")).toHaveCount(1);

  await page.getByRole("button", { name: "Compact rows" }).click();
  await expect(page.getByTestId("tracks")).toHaveClass(/compact/);
  await expect(page.locator(".overview")).toBeHidden();
  await page.getByRole("button", { name: "Zoom the timeline in" }).click();
  await expect(page.locator(".overview")).toBeVisible();
  await expect(page.locator(".ph-t")).toHaveText("0.00");
});
