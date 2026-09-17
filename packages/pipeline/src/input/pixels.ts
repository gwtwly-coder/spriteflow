// biome-ignore-all lint/style/noNonNullAssertion: Validated image dimensions bound all typed-array indices in these pixel loops.
import type { Progress } from "../runtime/execution.js";
import { checkpoint, fail } from "../runtime/execution.js";
import type { ExecutionContext, PixelBuffer, Rect } from "../types.js";
import { PipelineErrorCode, ProgressStage } from "../types.js";

export function pixels(width: number, height: number): PixelBuffer {
  return {
    width,
    height,
    format: "rgba8",
    colorSpace: "srgb",
    alphaMode: "straight",
    data: new Uint8ClampedArray(width * height * 4),
  };
}
export async function makeMask(
  input: PixelBuffer,
  threshold: number,
  context: ExecutionContext,
  progress?: Progress,
) {
  const { width, height, data } = input;
  const mask = new Uint8Array(width * height),
    rows = new Uint32Array(height),
    cols = new Uint32Array(width);
  let foreground = 0,
    transparent = 0,
    opaque = 0;
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0, p = y * width; x < width; x++, p++) {
      const a = data[p * 4 + 3]!;
      if (a === 0) transparent++;
      else if (a === 255) opaque++;
      if (a > threshold) {
        mask[p] = 1;
        row++;
        cols[x] = cols[x]! + 1;
      }
    }
    rows[y] = row;
    foreground += row;
    if ((y & 63) === 63) {
      progress?.report(ProgressStage.Analyze, y + 1, height);
      await checkpoint(context, ProgressStage.Analyze);
    }
  }
  if (opaque / (width * height) > 0.99) fail(PipelineErrorCode.OpaqueInput);
  return {
    mask,
    rows,
    cols,
    foreground,
    alpha: { transparent, opaque, translucent: width * height - transparent - opaque },
  };
}
export async function alphaStats(input: PixelBuffer, context: ExecutionContext) {
  let transparent = 0,
    opaque = 0;
  for (let y = 0; y < input.height; y++) {
    for (let p = y * input.width * 4 + 3, end = (y + 1) * input.width * 4; p < end; p += 4) {
      if (input.data[p] === 0) transparent++;
      else if (input.data[p] === 255) opaque++;
    }
    if ((y & 63) === 63) await checkpoint(context, ProgressStage.Analyze);
  }
  if (opaque / (input.width * input.height) > 0.99) fail(PipelineErrorCode.OpaqueInput);
  return { transparent, opaque, translucent: input.width * input.height - transparent - opaque };
}

// Exact pixel-area integration avoids platform-specific Canvas sampling.
export async function resizePixels(
  input: PixelBuffer,
  maxDimension: number,
  context: ExecutionContext,
  crop: Rect = { x: 0, y: 0, width: input.width, height: input.height },
): Promise<PixelBuffer> {
  const scale = Math.min(1, maxDimension / Math.max(crop.width, crop.height));
  const output = pixels(
    Math.max(1, Math.floor(crop.width * scale)),
    Math.max(1, Math.floor(crop.height * scale)),
  );
  const sx = crop.width / output.width,
    sy = crop.height / output.height;
  for (let y = 0; y < output.height; y++) {
    for (let x = 0; x < output.width; x++) {
      const left = x * sx,
        right = (x + 1) * sx,
        top = y * sy,
        bottom = (y + 1) * sy;
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let yy = Math.floor(top); yy < Math.ceil(bottom); yy++) {
        const wy = Math.min(bottom, yy + 1) - Math.max(top, yy);
        for (let xx = Math.floor(left); xx < Math.ceil(right); xx++) {
          const weight = wy * (Math.min(right, xx + 1) - Math.max(left, xx));
          const p = ((yy + crop.y) * input.width + xx + crop.x) * 4;
          if (input.data[p + 3]) {
            r += input.data[p]! * weight;
            g += input.data[p + 1]! * weight;
            b += input.data[p + 2]! * weight;
          }
          a += input.data[p + 3]! * weight;
        }
      }
      const p = (y * output.width + x) * 4,
        area = sx * sy;
      output.data[p + 3] = Math.round(a / area);
      if (output.data[p + 3]) {
        output.data[p] = Math.round(r / area);
        output.data[p + 1] = Math.round(g / area);
        output.data[p + 2] = Math.round(b / area);
      }
    }
    if ((y & 15) === 15) await checkpoint(context, ProgressStage.Analyze);
  }
  return output;
}
export function tightBounds(
  mask: Uint8Array,
  stride: number,
  region: Rect,
): { bbox: Rect | null; area: number } {
  let left = region.x + region.width,
    right = -1,
    top = region.y + region.height,
    bottom = -1,
    area = 0;
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++)
      if (mask[y * stride + x]) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = y;
        area++;
      }
  }
  return {
    bbox: area ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : null,
    area,
  };
}

export async function tightBoundsAsync(
  mask: Uint8Array,
  stride: number,
  region: Rect,
  context: ExecutionContext,
  stage: ProgressStage,
) {
  let bbox: Rect | null = null,
    area = 0;
  for (let y = region.y; y < region.y + region.height; y += 64) {
    const part = tightBounds(mask, stride, {
      ...region,
      y,
      height: Math.min(64, region.y + region.height - y),
    });
    area += part.area;
    if (part.bbox) {
      if (!bbox) bbox = part.bbox;
      else {
        const x = Math.min(bbox.x, part.bbox.x),
          right = Math.max(bbox.x + bbox.width, part.bbox.x + part.bbox.width);
        bbox = { x, y: bbox.y, width: right - x, height: part.bbox.y + part.bbox.height - bbox.y };
      }
    }
    if (region.height > 64) await checkpoint(context, stage);
  }
  return { bbox, area };
}
