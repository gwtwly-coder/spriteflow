// biome-ignore-all lint/style/noNonNullAssertion: Fixed-size hash grids and validated pixel geometry bound indexed access.
import { checkpoint } from "../runtime/execution.js";
import type { ExecutionContext, PerceptualHash, PixelBuffer, Rect } from "../types.js";
import { ProgressStage } from "../types.js";

export async function dhash(
  input: PixelBuffer,
  bbox: Rect,
  context: ExecutionContext,
): Promise<PerceptualHash> {
  const samples = new Float64Array(72);
  // Integer overlap areas keep equal means exactly equal. Every output cell has
  // the same denominator, so division is unnecessary for strict comparisons.
  for (let y = 0; y < bbox.height; y++) {
    const top = y * 8,
      bottom = (y + 1) * 8;
    for (let x = 0; x < bbox.width; x++) {
      const p = ((bbox.y + y) * input.width + bbox.x + x) * 4;
      const gray = Math.floor(
        ((77 * input.data[p]! + 150 * input.data[p + 1]! + 29 * input.data[p + 2]!) *
          input.data[p + 3]!) /
          (256 * 255),
      );
      const left = x * 9,
        right = (x + 1) * 9;
      for (
        let yy = Math.floor(top / bbox.height);
        yy < Math.min(8, Math.ceil(bottom / bbox.height));
        yy++
      ) {
        const wy = Math.min(bottom, (yy + 1) * bbox.height) - Math.max(top, yy * bbox.height);
        for (
          let xx = Math.floor(left / bbox.width);
          xx < Math.min(9, Math.ceil(right / bbox.width));
          xx++
        ) {
          const q = yy * 9 + xx;
          samples[q] =
            samples[q]! +
            gray * wy * (Math.min(right, (xx + 1) * bbox.width) - Math.max(left, xx * bbox.width));
        }
      }
    }
    if ((y & 31) === 31) await checkpoint(context, ProgressStage.Hash);
  }
  let bits = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      bits = (bits << 1n) | BigInt(samples[y * 9 + x]! > samples[y * 9 + x + 1]!);
  return { algorithm: "dhash64-v1", hex: bits.toString(16).padStart(16, "0") };
}
