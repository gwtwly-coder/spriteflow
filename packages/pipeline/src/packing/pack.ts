// biome-ignore-all lint/style/noNonNullAssertion: The packer receives validated unique frame IDs, all of which are inserted before lookup.
import { MaxRectsPacker, PACKING_LOGIC, Rectangle } from "maxrects-packer";
import { DEFAULT_PACK_OPTIONS } from "../defaults.js";
import * as validate from "../input/validate.js";
import { warnings } from "../normalization/frames.js";
import {
  checkpoint,
  createExecutionContext,
  fail,
  memory,
  outcome,
  Progress,
  uniqueId,
} from "../runtime/execution.js";
import type {
  AssetRef,
  ExecutionContext,
  Frame,
  Outcome,
  PackedFrame,
  PackOptions,
  PackResult,
} from "../types.js";
import { PipelineErrorCode as Code, ProgressStage as Stage } from "../types.js";

export async function packFrames(
  asset: AssetRef,
  frames: Frame[],
  options: PackOptions = DEFAULT_PACK_OPTIONS,
  context: ExecutionContext = createExecutionContext(uniqueId()),
): Promise<Outcome<PackResult>> {
  const progress = new Progress(context, asset ?? null, "pack");
  return outcome(progress, async () => {
    validate.context(context);
    validate.ref(asset);
    validate.packOptions(options, context.limits);
    const included = validate.frames(frames, asset, context.limits);
    const bound = {
      width: Math.max(...frames.map((f) => f.sourceRect.x + f.sourceRect.width)),
      height: Math.max(...frames.map((f) => f.sourceRect.y + f.sourceRect.height)),
    };
    memory(
      context,
      4 * bound.width * bound.height + 16_777_216 + frames.length * frames.length * 128,
      bound,
    );
    const packer = new MaxRectsPacker<Rectangle>(
      options.maxWidth,
      options.maxHeight,
      options.padding,
      {
        smart: true,
        pot: options.sizeMode === "pot",
        square: false,
        allowRotation: options.allowRotation,
        border: options.border,
        tag: false,
        exclusiveTag: false,
        logic: options.heuristic === "max-edge" ? PACKING_LOGIC.MAX_EDGE : PACKING_LOGIC.MAX_AREA,
      },
    );
    const sorted = included.map((frame) => ({
      frame,
      width: (frame.bbox?.width ?? 1) + 2 * options.extrude,
      height: (frame.bbox?.height ?? 1) + 2 * options.extrude,
    }));
    const edge = (r: { width: number; height: number }) => Math.max(r.width, r.height);
    const area = (r: { width: number; height: number }) => r.width * r.height;
    sorted.sort(
      (a, b) =>
        (options.heuristic === "max-edge"
          ? edge(b) - edge(a) || area(b) - area(a)
          : area(b) - area(a) || edge(b) - edge(a)) ||
        (a.frame.id < b.frame.id ? -1 : a.frame.id > b.frame.id ? 1 : 0),
    );
    progress.report(Stage.Pack);
    for (const [i, item] of sorted.entries()) {
      const w = item.width + 2 * options.border,
        h = item.height + 2 * options.border;
      if (
        (w > options.maxWidth || h > options.maxHeight) &&
        (!options.allowRotation || h > options.maxWidth || w > options.maxHeight)
      )
        fail(Code.FrameTooLarge, Stage.Pack, { frameIds: [item.frame.id] });
      const rectangle = new Rectangle(item.width, item.height);
      // The packer's outer oversized check ignores rotation. Orient a rectangle
      // that only fits rotated before add(), preserving its logical rotation flag.
      if (w > options.maxWidth || h > options.maxHeight) {
        rectangle.rot = true;
        rectangle.allowRotation = false;
      }
      rectangle.data = item.frame.id;
      packer.add(rectangle);
      if (packer.bins.length > options.maxPages)
        fail(Code.PackOverflow, Stage.Pack, {
          actual: packer.bins.length,
          limit: options.maxPages,
        });
      progress.report(Stage.Pack, i + 1, sorted.length);
      await checkpoint(context, Stage.Pack);
    }
    const byId = new Map(included.map((f) => [f.id, f]));
    const packedById = new Map<string, PackedFrame>();
    const pages = packer.bins.map((bin, pageIndex) => {
      for (const r of bin.rects) {
        const frame = byId.get(r.data as string)!;
        packedById.set(frame.id, {
          frameId: frame.id,
          name: frame.name,
          sourceRect: { ...frame.sourceRect },
          bbox: frame.bbox === null ? null : { ...frame.bbox },
          pageIndex,
          allocation: { x: r.x, y: r.y, width: r.width, height: r.height },
          rect: {
            x: r.x + options.extrude,
            y: r.y + options.extrude,
            width: r.width - 2 * options.extrude,
            height: r.height - 2 * options.extrude,
          },
          rotated: r.rot,
          sourceSize: { width: frame.canvas.width, height: frame.canvas.height },
          spriteSourceSize: frame.bbox
            ? { ...frame.canvas.offset, width: frame.bbox.width, height: frame.bbox.height }
            : { x: 0, y: 0, width: 1, height: 1 },
          empty: frame.bbox === null,
        });
      }
      return {
        index: pageIndex,
        width: bin.width,
        height: bin.height,
        frameIds: included
          .filter((f) => packedById.get(f.id)?.pageIndex === pageIndex)
          .map((f) => f.id),
      };
    });
    return {
      asset: { ...asset },
      options: { ...options },
      pages,
      frames: included.map((f) => packedById.get(f.id)!),
      frameOrder: included.map((f) => f.id),
      warnings: warnings(included),
    };
  });
}
