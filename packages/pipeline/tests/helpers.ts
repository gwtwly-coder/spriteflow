import { expect } from "vitest";
import type { InputAsset, Outcome, Rect } from "../src/types.js";

export function asset(width = 200, height = 100): InputAsset {
  return {
    ref: { assetId: "fixture", revision: 1 },
    name: "fixture.png",
    sourceMime: "application/x-rgba8",
    originalSize: { width, height },
    scaleFromOriginal: { x: 1, y: 1 },
    pixels: {
      width,
      height,
      format: "rgba8",
      colorSpace: "srgb",
      alphaMode: "straight",
      data: new Uint8ClampedArray(width * height * 4),
    },
  };
}

export function paint(input: InputAsset, rect: Rect, rgba = [150, 90, 30, 255]): InputAsset {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      input.pixels.data.set(rgba, (y * input.pixels.width + x) * 4);
    }
  }
  return input;
}

export function value<T>(outcome: Outcome<T>): T {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  if (!outcome.ok) throw new Error(outcome.error.code);
  return outcome.value;
}
