import { expect, test } from "vitest";
import { mediumHeight, sizePlan } from "../src/core/sizes";
import { newProject } from "../src/core/project";
import { figure } from "./png";

test("medium_is_the_heroes", () => expect(sizePlan("medium", 48)).toEqual({ genPx: 48, scale: 1 }));
test("large", () => expect(sizePlan("large", 48)).toEqual({ genPx: 96, scale: 1 }));
test("huge", () => expect(sizePlan("huge", 48)).toEqual({ genPx: 192, scale: 1 }));
test("gargantuan_is_half_then_2x", () => expect(sizePlan("gargantuan", 48)).toEqual({ genPx: 200, scale: 2 }));
test("gargantuan_with_64px_heroes", () => expect(sizePlan("gargantuan", 64)).toEqual({ genPx: 256, scale: 2 }));

test("medium_height_ignores_scaled_and_large", () => {
  const p = newProject("t");
  const mk = (size?: "large" | "medium", scale?: 2) => ({ view: "side" as const, size, scale, anims: { idle: { approved: true, source: "user" as const, frames: [`${size}${scale}`] } } });
  p.kit.chars.big = mk("large");
  p.kit.chars.dragon = mk("medium", 2);
  p.kit.chars.hero = mk();
  const imgs: Record<string, ReturnType<typeof figure>> = { large: figure(96, 96, 0, 0), mediumundefined: figure(200, 200, 0, 0), undefinedundefined: figure(40, 40, 0, 0) };
  expect(mediumHeight(p, (path) => imgs[path] ?? null)).toBe(40);
  expect(mediumHeight(newProject("e"), () => null)).toBe(48);
});

import { bgScale } from "../src/gen/pixellab";
test("a_generated_background_is_drawn_at_the_scale_it_was_made_for", () => {
  expect(bgScale({ W: 480, H: 270 })).toBe(1); // made 1:1, fits PixelLab's 512x512
  expect(bgScale({ W: 640, H: 360 })).toBe(1);
  expect(bgScale({ W: 960, H: 540 })).toBe(2); // made at half size
});
