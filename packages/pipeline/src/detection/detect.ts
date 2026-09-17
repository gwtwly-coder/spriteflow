// biome-ignore-all lint/style/noNonNullAssertion: The nonempty candidate guard establishes the selected cluster.
import { DEFAULT_DETECT_OPTIONS } from "../defaults.js";
import { makeMask, resizePixels } from "../input/pixels.js";
import * as validate from "../input/validate.js";
import { clusters, normalizeInternal, warnings } from "../normalization/frames.js";
import {
  createExecutionContext,
  memory,
  outcome,
  Progress,
  uniqueId,
} from "../runtime/execution.js";
import type {
  Degradation,
  DetectDiagnostics,
  DetectOptions,
  DetectResult,
  ExecutionContext,
  FrameDraft,
  InputAsset,
  ManualGrid,
  Outcome,
} from "../types.js";
import {
  DegradedReason as Reason,
  ProgressStage as Stage,
  PipelineWarningCode as Warning,
} from "../types.js";
import { groupComponents } from "./components.js";
import { findGrid, manualDrafts } from "./grid.js";

export async function detect(
  asset: InputAsset,
  options: DetectOptions = DEFAULT_DETECT_OPTIONS,
  context: ExecutionContext = createExecutionContext(uniqueId()),
): Promise<Outcome<DetectResult>> {
  const progress = new Progress(context, asset?.ref ?? null, "detect");
  return outcome(progress, async () => {
    validate.context(context);
    validate.asset(asset, context.limits);
    validate.detectOptions(options, asset.pixels, context.limits);
    const { width, height } = asset.pixels,
      maxFrames = Math.min(options.maxFrames, context.limits.maxFrames);
    memory(context, 24 * width * height + 16_777_216, asset.pixels);
    progress.report(Stage.Validate, 1, 1, true);
    progress.report(Stage.Analyze);
    const raw = await makeMask(asset.pixels, options.alphaThreshold, context, progress);
    const minArea = Math.max(options.minAreaPx, Math.ceil(width * height * options.minAreaRatio));
    const diagnostics: DetectDiagnostics = {
      gridConfidence: 0,
      componentConfidence: 0,
      componentCount: 0,
      filteredComponentCount: 0,
      foregroundPixels: raw.foreground,
      effectiveMinAreaPx: minArea,
      effectiveDilationRadiusPx: 0,
      effectiveMergeDistancePx: 0,
    };
    let drafts: FrameDraft[] = [],
      strategy: DetectResult["strategy"] = "manual-grid",
      confidence = 0,
      degraded: Degradation | null = null;
    const attempted: ("grid" | "components")[] = [];
    const finish = async (): Promise<DetectResult> => {
      progress.report(Stage.Components, 1, 1, true);
      const frames = await normalizeInternal(
        asset,
        drafts,
        {
          ...options.normalize,
          computeHash: options.quality === "final" && options.normalize.computeHash,
        },
        context,
        progress,
      );
      const issues = warnings(frames);
      if (degraded)
        issues.unshift({
          code: Warning.DetectionDegraded,
          messageKey: `pipeline.warning.${Warning.DetectionDegraded}`,
          frameIds: [],
          reason: degraded.reason,
        });
      return {
        asset: { ...asset.ref },
        quality: options.quality,
        frames,
        strategy,
        confidence,
        degraded,
        options: {
          ...options,
          grid: { ...options.grid },
          normalize: { ...options.normalize },
          manualGrid: options.manualGrid
            ? {
                ...options.manualGrid,
                region: options.manualGrid.region ? { ...options.manualGrid.region } : null,
              }
            : null,
        },
        diagnostics,
        warnings: issues,
      };
    };
    if (options.mode === "manual-grid") {
      drafts = await manualDrafts(options.manualGrid!, width, height, raw.mask, context);
      confidence = 1;
      return finish();
    }
    if (raw.alpha.transparent === width * height) {
      const suggestedGrid: ManualGrid = { rows: 1, columns: 1, region: null, keepEmptyCells: true };
      degraded = { reason: Reason.EmptyInput, attempted: [], suggestedGrid };
      drafts = await manualDrafts(suggestedGrid, width, height, raw.mask, context);
      return finish();
    }
    const small =
      Math.max(width, height) > options.analysisMaxDimension
        ? await resizePixels(asset.pixels, options.analysisMaxDimension, context)
        : asset.pixels;
    const analysis =
      small === asset.pixels ? raw : await makeMask(small, options.alphaThreshold, context);
    progress.report(Stage.Analyze, 1, 1, true);
    let tooMany = false,
      candidateCount = 0;
    if (options.mode !== "components") {
      attempted.push("grid");
      progress.report(Stage.Grid);
      const grid = await findGrid(
        raw.mask,
        width,
        height,
        analysis.rows,
        analysis.cols,
        options.grid,
        minArea,
        context,
      );
      diagnostics.gridConfidence = grid?.confidence ?? 0;
      if (grid) {
        tooMany = grid.drafts.length > maxFrames;
        if (!tooMany) candidateCount = grid.drafts.length;
        if (!tooMany && grid.confidence > options.grid.confidenceThreshold) {
          drafts = grid.drafts;
          strategy = "grid";
          confidence = grid.confidence;
          return finish();
        }
      }
    }
    progress.report(Stage.Grid, 1, 1, true);
    if (options.mode !== "grid") {
      attempted.push("components");
      progress.report(Stage.Components);
      const preview = options.quality === "preview",
        image = preview ? small : asset.pixels,
        scan = preview ? analysis : raw;
      const sx = image.width / width,
        sy = image.height / height,
        s = Math.min(sx, sy);
      const radius =
        options.dilationRadiusPx ??
        Math.min(64, Math.max(0, Math.round(Math.min(width, height) * 0.01)));
      const grouped = await groupComponents(
        scan.mask,
        image.width,
        image.height,
        Math.round(radius * s),
        options.mergeDistancePx === null ? null : Math.round(options.mergeDistancePx * s),
        options.mergeDistanceRatio,
        Math.ceil(minArea * sx * sy),
        context,
        progress,
      );
      const groups = grouped.groups;
      diagnostics.effectiveDilationRadiusPx = radius;
      diagnostics.effectiveMergeDistancePx =
        options.mergeDistancePx ?? Math.round(grouped.effectiveDistance / s);
      diagnostics.componentCount = grouped.count;
      diagnostics.filteredComponentCount = groups.length;
      diagnostics.foregroundPixels = Math.round(scan.foreground / (sx * sy));
      const sizes = clusters(
        groups.map((g, i) => ({ id: `c_${i}`, rect: g.rect })),
        options.normalize.clusterTolerance,
      );
      const score =
        groups.length >= 2 && scan.foreground
          ? (0.7 * Math.max(...sizes.map((c) => c.length))) / groups.length +
            (0.3 * groups.reduce((sum, g) => sum + g.area, 0)) / scan.foreground
          : 0;
      diagnostics.componentConfidence = Math.min(1, score);
      tooMany ||= groups.length > maxFrames;
      if (groups.length <= maxFrames && groups.length) candidateCount = groups.length;
      if (
        groups.length >= 2 &&
        groups.length <= maxFrames &&
        score >= options.componentConfidenceThreshold
      ) {
        strategy = "components";
        confidence = Math.min(1, score);
        drafts = groups.map((g, i) => {
          const x = Math.floor(g.rect.x / sx),
            y = Math.floor(g.rect.y / sy);
          return {
            id: `c_${i}`,
            name: `frame_${String(i).padStart(3, "0")}`,
            sourceRect: {
              x,
              y,
              width: Math.min(width, Math.ceil((g.rect.x + g.rect.width) / sx)) - x,
              height: Math.min(height, Math.ceil((g.rect.y + g.rect.height) / sy)) - y,
            },
            origin: "components",
            sourceFrameIds: g.sources.length > 1 ? g.sources.map((n) => `p_${n}`) : [],
            edited: false,
            included: true,
            reviewStatus: "pending",
          };
        });
        return finish();
      }
    }
    const reason = tooMany
      ? Reason.FrameLimitExceeded
      : attempted.includes("components")
        ? diagnostics.filteredComponentCount < 2
          ? Reason.InsufficientComponents
          : Reason.AmbiguousComponents
        : Reason.LowConfidence;
    const n = candidateCount || 1;
    let columns = Math.ceil(Math.sqrt((n * width) / height)),
      rows = Math.ceil(n / columns);
    columns = Math.min(Math.max(1, columns), 100, width, maxFrames);
    rows = Math.min(Math.max(1, rows), 100, height, Math.floor(maxFrames / columns));
    const suggestedGrid: ManualGrid = { rows, columns, region: null, keepEmptyCells: true };
    degraded = { reason, attempted, suggestedGrid };
    drafts = await manualDrafts(suggestedGrid, width, height, raw.mask, context);
    return finish();
  });
}
