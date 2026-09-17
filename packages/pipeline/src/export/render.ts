// biome-ignore-all lint/style/noNonNullAssertion: The export validator establishes all page, frame, and pixel bounds before rendering.
import { pixels } from "../input/pixels.js";
import { checkpoint } from "../runtime/execution.js";
import type { ExecutionContext, Frame, InputAsset, PackResult, PixelBuffer } from "../types.js";
import { ProgressStage } from "../types.js";

function copy(
  source: PixelBuffer,
  sx: number,
  sy: number,
  dest: PixelBuffer,
  dx: number,
  dy: number,
): void {
  const s = (sy * source.width + sx) * 4,
    d = (dy * dest.width + dx) * 4;
  const alpha = source.data[s + 3]!;
  if (!alpha) return;
  dest.data[d] = source.data[s]!;
  dest.data[d + 1] = source.data[s + 1]!;
  dest.data[d + 2] = source.data[s + 2]!;
  dest.data[d + 3] = alpha;
}
export async function renderFrame(
  asset: InputAsset,
  frame: Frame,
  context: ExecutionContext,
): Promise<PixelBuffer> {
  const output = pixels(frame.canvas.width, frame.canvas.height),
    b = frame.bbox;
  if (!b) return output;
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++)
      copy(
        asset.pixels,
        b.x + x,
        b.y + y,
        output,
        frame.canvas.offset.x + x,
        frame.canvas.offset.y + y,
      );
    if ((y & 63) === 63) await checkpoint(context, ProgressStage.Render);
  }
  return output;
}
export async function renderAtlas(
  asset: InputAsset,
  frames: Frame[],
  pack: PackResult,
  pageIndex: number,
  context: ExecutionContext,
): Promise<PixelBuffer> {
  const page = pack.pages[pageIndex]!,
    output = pixels(page.width, page.height),
    byId = new Map(frames.map((f) => [f.id, f]));
  for (const packed of pack.frames) {
    if (packed.pageIndex !== pageIndex) continue;
    const b = byId.get(packed.frameId)!.bbox;
    if (!b) continue;
    for (let y = 0; y < packed.allocation.height; y++) {
      for (let x = 0; x < packed.allocation.width; x++) {
        const xx = Math.max(0, Math.min(packed.rect.width - 1, x - pack.options.extrude));
        const yy = Math.max(0, Math.min(packed.rect.height - 1, y - pack.options.extrude));
        const sx = packed.rotated ? yy : xx,
          sy = packed.rotated ? b.height - 1 - xx : yy;
        copy(
          asset.pixels,
          b.x + sx,
          b.y + sy,
          output,
          packed.allocation.x + x,
          packed.allocation.y + y,
        );
      }
      if ((y & 63) === 63) await checkpoint(context, ProgressStage.Render);
    }
    await checkpoint(context, ProgressStage.Render);
  }
  return output;
}
