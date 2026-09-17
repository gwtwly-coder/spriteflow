// biome-ignore-all lint/style/noNonNullAssertion: Validated draft geometry and nonempty cluster guards establish indexed entries.
import { DEFAULT_NORMALIZE_OPTIONS } from "../defaults.js";
import { components, median } from "../detection/components.js";
import { alphaStats, tightBoundsAsync } from "../input/pixels.js";
import * as validate from "../input/validate.js";
import {
  checkpoint,
  createExecutionContext,
  memory,
  outcome,
  Progress,
  uniqueId,
} from "../runtime/execution.js";
import type {
  ExecutionContext,
  Frame,
  FrameDraft,
  InputAsset,
  NormalizeOptions,
  NormalizeResult,
  Outcome,
  PipelineWarning,
  Rect,
} from "../types.js";
import { ProgressStage as Stage, PipelineWarningCode as Warning } from "../types.js";
import { dhash } from "./hash.js";

export function clusters(items: { id: string; rect: Rect }[], tolerance: number): string[][] {
  const groups: { ids: string[]; widths: number[]; heights: number[] }[] = [];
  for (const item of [...items].sort(
    (a, b) =>
      a.rect.width * a.rect.height - b.rect.width * b.rect.height ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )) {
    const group = groups.find(
      (g) =>
        Math.abs(item.rect.width - median(g.widths)) / median(g.widths) <= tolerance &&
        Math.abs(item.rect.height - median(g.heights)) / median(g.heights) <= tolerance,
    );
    if (group) {
      group.ids.push(item.id);
      group.widths.push(item.rect.width);
      group.heights.push(item.rect.height);
    } else groups.push({ ids: [item.id], widths: [item.rect.width], heights: [item.rect.height] });
  }
  return groups.map((g) => g.ids);
}
export function warnings(frames: Frame[]): PipelineWarning[] {
  const result: PipelineWarning[] = [];
  for (const [code, flag] of [
    [Warning.OutlierFrames, "outlier"],
    [Warning.MultipleComponents, "multipleComponents"],
    [Warning.EmptyFrames, "empty"],
  ] as const) {
    const frameIds = frames.filter((f) => f.flags[flag]).map((f) => f.id);
    if (frameIds.length)
      result.push({ code, messageKey: `pipeline.warning.${code}`, frameIds, reason: null });
  }
  return result;
}
export async function normalizeInternal(
  asset: InputAsset,
  drafts: FrameDraft[],
  options: NormalizeOptions,
  context: ExecutionContext,
  progress: Progress,
): Promise<Frame[]> {
  const frames: Frame[] = [];
  for (const [i, draft] of drafts.entries()) {
    const r = draft.sourceRect,
      mask = new Uint8Array(r.width * r.height);
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++)
        mask[y * r.width + x] = Number(
          asset.pixels.data[((r.y + y) * asset.pixels.width + r.x + x) * 4 + 3]! >
            options.alphaThreshold,
        );
      if ((y & 63) === 63) await checkpoint(context, Stage.Normalize);
    }
    const tight = (
      await tightBoundsAsync(
        mask,
        r.width,
        { x: 0, y: 0, width: r.width, height: r.height },
        context,
        Stage.Normalize,
      )
    ).bbox;
    const bbox = tight
      ? options.trim
        ? { ...tight, x: tight.x + r.x, y: tight.y + r.y }
        : { ...r }
      : null;
    const count = tight
      ? (await components(mask, r.width, r.height, context)).groups.filter(
          (g) => g.area >= options.componentMinAreaPx,
        ).length
      : 0;
    frames.push({
      id: draft.id,
      name: draft.name,
      asset: { ...asset.ref },
      sourceRect: { ...r },
      bbox,
      origin: draft.origin,
      sourceFrameIds: [...draft.sourceFrameIds],
      included: draft.included,
      reviewStatus: draft.reviewStatus,
      canvas: {
        width: (bbox ?? r).width + 2 * options.padding,
        height: (bbox ?? r).height + 2 * options.padding,
        offset: { x: 0, y: 0 },
      },
      pHash: null,
      clusterId: null,
      flags: {
        outlier: false,
        merged: draft.sourceFrameIds.length >= 2,
        multipleComponents: count > 1,
        empty: bbox === null,
        edited: draft.edited,
        duplicateOf: null,
      },
    });
    progress.report(Stage.Normalize, i + 1, drafts.length);
    if ((i & 15) === 15) await checkpoint(context, Stage.Normalize);
  }
  const included = frames.filter((f) => f.included);
  const uniformW = Math.max(1, ...included.map((f) => f.canvas.width)),
    uniformH = Math.max(1, ...included.map((f) => f.canvas.height));
  const nonempty = frames.filter((f) => f.bbox !== null);
  const grouped = clusters(
    nonempty.map((f) => ({ id: f.id, rect: f.bbox! })),
    options.clusterTolerance,
  );
  const membership = new Map(
    grouped.flatMap((group, i) => group.map((id) => [id, `cluster_${i}`] as const)),
  );
  const reference = included.filter((f) => f.bbox);
  const mw = median(reference.map((f) => f.bbox!.width)),
    mh = median(reference.map((f) => f.bbox!.height));
  const ma = median(reference.map((f) => f.bbox!.width / f.bbox!.height));
  for (const frame of frames) {
    if (options.canvasMode === "uniform" && frame.included) {
      frame.canvas.width = uniformW;
      frame.canvas.height = uniformH;
    }
    const b = frame.bbox;
    if (!b) continue;
    frame.clusterId = membership.get(frame.id) ?? null;
    frame.canvas.offset =
      options.alignment === "top-left"
        ? { x: options.padding, y: options.padding }
        : {
            x: Math.floor((frame.canvas.width - b.width) / 2),
            y: Math.floor((frame.canvas.height - b.height) / 2),
          };
    frame.flags.outlier =
      reference.length >= 3 &&
      (Math.abs(b.width - mw) / mw > options.outlierThreshold ||
        Math.abs(b.height - mh) / mh > options.outlierThreshold ||
        Math.abs(b.width / b.height - ma) / ma > options.outlierThreshold);
  }
  progress.report(Stage.Normalize, drafts.length, drafts.length || null, true);
  progress.report(Stage.Hash);
  if (options.computeHash)
    for (const [i, frame] of frames.entries()) {
      if (frame.bbox) frame.pHash = await dhash(asset.pixels, frame.bbox, context);
      progress.report(Stage.Hash, i + 1, frames.length);
      if ((i & 15) === 15) await checkpoint(context, Stage.Hash);
    }
  progress.report(Stage.Hash, frames.length, frames.length || null, true);
  return frames;
}
export async function normalizeFrames(
  asset: InputAsset,
  drafts: FrameDraft[],
  options: NormalizeOptions = DEFAULT_NORMALIZE_OPTIONS,
  context: ExecutionContext = createExecutionContext(uniqueId()),
): Promise<Outcome<NormalizeResult>> {
  const progress = new Progress(context, asset?.ref ?? null, "normalize");
  return outcome(progress, async () => {
    validate.context(context);
    validate.asset(asset, context.limits);
    validate.normalizeOptions(options);
    validate.drafts(drafts, asset.pixels, context.limits);
    memory(context, 24 * asset.pixels.width * asset.pixels.height + 16_777_216, asset.pixels);
    await alphaStats(asset.pixels, context);
    const frames = await normalizeInternal(asset, drafts, options, context, progress);
    return { asset: { ...asset.ref }, frames, options: { ...options }, warnings: warnings(frames) };
  });
}
