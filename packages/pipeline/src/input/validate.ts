import { DESKTOP_LIMITS } from "../defaults.js";
import { fail, invalid } from "../runtime/execution.js";

export { invalid } from "../runtime/execution.js";

import type {
  AssetRef,
  DetectOptions,
  ExecutionContext,
  Frame,
  FrameDraft,
  InputAsset,
  NormalizeOptions,
  PackOptions,
  Rect,
  ResourceLimits,
  Size,
} from "../types.js";
import { PipelineErrorCode as Code, ProgressStage as Stage } from "../types.js";

export function object(
  value: unknown,
  keys: string[],
  field: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(field);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!keys.includes(key)) invalid(`${field}.${key}`);
  for (const key of keys)
    if (!(key in record) || record[key] === undefined) invalid(`${field}.${key}`);
}
export function number(
  value: unknown,
  min: number,
  max: number,
  field: string,
  integer = true,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    invalid(field);
}
export function oneOf(value: unknown, allowed: readonly unknown[], field: string): void {
  if (!allowed.includes(value)) invalid(field);
}
export function bool(value: unknown, field: string): void {
  oneOf(value, [true, false], field);
}
export function id(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) invalid(field);
}
export function name(value: unknown, field: string): void {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|constructor|prototype|hasownproperty)$/i.test(value)
  )
    invalid(field);
}
export function ref(value: AssetRef, field = "asset"): void {
  object(value, ["assetId", "revision"], field);
  id(value.assetId, `${field}.assetId`);
  number(value.revision, 1, Number.MAX_SAFE_INTEGER, `${field}.revision`);
}
export function sameRef(a: AssetRef, b: AssetRef): boolean {
  return a.assetId === b.assetId && a.revision === b.revision;
}
export function size(value: Size, field: string): void {
  object(value, ["width", "height"], field);
  number(value.width, 1, Number.MAX_SAFE_INTEGER, `${field}.width`);
  number(value.height, 1, Number.MAX_SAFE_INTEGER, `${field}.height`);
}
export function rect(value: Rect, bounds: Size, field: string): void {
  object(value, ["x", "y", "width", "height"], field);
  number(value.x, 0, bounds.width - 1, `${field}.x`);
  number(value.y, 0, bounds.height - 1, `${field}.y`);
  number(value.width, 1, bounds.width - value.x, `${field}.width`);
  number(value.height, 1, bounds.height - value.y, `${field}.height`);
}
export function limits(value: ResourceLimits): void {
  object(value, Object.keys(DESKTOP_LIMITS), "limits");
  for (const key of Object.keys(DESKTOP_LIMITS) as (keyof ResourceLimits)[])
    number(value[key], 1, DESKTOP_LIMITS[key], `limits.${key}`);
}
export function context(value: ExecutionContext): void {
  object(value, ["taskId", "limits", "isCancelled", "yieldControl", "onProgress"], "context");
  id(value.taskId, "context.taskId");
  limits(value.limits);
  for (const key of ["isCancelled", "yieldControl", "onProgress"] as const)
    if (typeof value[key] !== "function") invalid(`context.${key}`);
}
export function dimensions(value: Size, resources: ResourceLimits): void {
  const actual = Math.max(value.width, value.height);
  if (actual > resources.maxDimension || value.width * value.height > resources.maxPixels) {
    const scale = Math.min(
      resources.maxDimension / actual,
      Math.sqrt(resources.maxPixels / (value.width * value.height)),
    );
    fail(Code.DimensionLimit, Stage.Validate, {
      actual: actual > resources.maxDimension ? actual : value.width * value.height,
      limit: actual > resources.maxDimension ? resources.maxDimension : resources.maxPixels,
      suggestedSize: {
        width: Math.max(1, Math.floor(value.width * scale)),
        height: Math.max(1, Math.floor(value.height * scale)),
      },
    });
  }
}
export function asset(value: InputAsset, resources: ResourceLimits): void {
  object(
    value,
    ["ref", "name", "sourceMime", "originalSize", "pixels", "scaleFromOriginal"],
    "asset",
  );
  ref(value.ref, "asset.ref");
  if (typeof value.name !== "string") invalid("asset.name");
  oneOf(value.sourceMime, ["image/png", "image/webp", "application/x-rgba8"], "asset.sourceMime");
  size(value.originalSize, "asset.originalSize");
  object(
    value.pixels,
    ["width", "height", "format", "colorSpace", "alphaMode", "data"],
    "asset.pixels",
  );
  number(value.pixels.width, 1, Number.MAX_SAFE_INTEGER, "asset.pixels.width");
  number(value.pixels.height, 1, Number.MAX_SAFE_INTEGER, "asset.pixels.height");
  dimensions(value.pixels, resources);
  oneOf(value.pixels.format, ["rgba8"], "asset.pixels.format");
  oneOf(value.pixels.colorSpace, ["srgb"], "asset.pixels.colorSpace");
  oneOf(value.pixels.alphaMode, ["straight"], "asset.pixels.alphaMode");
  const data = value.pixels.data;
  if (
    !(data instanceof Uint8ClampedArray) ||
    !(data.buffer instanceof ArrayBuffer) ||
    data.byteOffset !== 0 ||
    data.byteLength !== value.pixels.width * value.pixels.height * 4 ||
    data.buffer.byteLength !== data.byteLength
  )
    invalid("asset.pixels.data");
  object(value.scaleFromOriginal, ["x", "y"], "asset.scaleFromOriginal");
  const sx = value.pixels.width / value.originalSize.width;
  const sy = value.pixels.height / value.originalSize.height;
  if (
    sx > 1 ||
    sy > 1 ||
    (Math.abs(value.pixels.width - value.originalSize.width * sy) > 1 &&
      Math.abs(value.pixels.height - value.originalSize.height * sx) > 1)
  )
    invalid("asset.originalSize");
  if (value.scaleFromOriginal.x !== sx || value.scaleFromOriginal.y !== sy)
    invalid("asset.scaleFromOriginal");
}
const normalizeKeys = [
  "alphaThreshold",
  "componentMinAreaPx",
  "trim",
  "padding",
  "canvasMode",
  "alignment",
  "computeHash",
  "outlierThreshold",
  "clusterTolerance",
];
export function normalizeOptions(o: NormalizeOptions, field = "options"): void {
  object(o, normalizeKeys, field);
  number(o.alphaThreshold, 0, 254, `${field}.alphaThreshold`);
  number(o.componentMinAreaPx, 1, 1_000_000, `${field}.componentMinAreaPx`);
  number(o.padding, 0, 64, `${field}.padding`);
  bool(o.trim, `${field}.trim`);
  bool(o.computeHash, `${field}.computeHash`);
  oneOf(o.canvasMode, ["per-frame", "uniform"], `${field}.canvasMode`);
  oneOf(o.alignment, ["top-left", "center"], `${field}.alignment`);
  number(o.outlierThreshold, 0, 1, `${field}.outlierThreshold`, false);
  number(o.clusterTolerance, 0, 1, `${field}.clusterTolerance`, false);
}
export function detectOptions(o: DetectOptions, bounds: Size, resources: ResourceLimits): void {
  object(
    o,
    [
      "mode",
      "quality",
      "alphaThreshold",
      "minAreaPx",
      "minAreaRatio",
      "dilationRadiusPx",
      "mergeDistancePx",
      "mergeDistanceRatio",
      "connectivity",
      "analysisMaxDimension",
      "componentConfidenceThreshold",
      "maxFrames",
      "grid",
      "manualGrid",
      "normalize",
    ],
    "options",
  );
  oneOf(o.mode, ["auto", "grid", "components", "manual-grid"], "options.mode");
  oneOf(o.quality, ["preview", "final"], "options.quality");
  number(o.alphaThreshold, 0, 254, "options.alphaThreshold");
  number(o.minAreaPx, 1, 1_000_000, "options.minAreaPx");
  number(o.minAreaRatio, 0, 0.1, "options.minAreaRatio", false);
  if (o.dilationRadiusPx !== null) number(o.dilationRadiusPx, 0, 128, "options.dilationRadiusPx");
  if (o.mergeDistancePx !== null) number(o.mergeDistancePx, 0, 512, "options.mergeDistancePx");
  number(o.mergeDistanceRatio, 0, 1, "options.mergeDistanceRatio", false);
  oneOf(o.connectivity, [8], "options.connectivity");
  number(o.analysisMaxDimension, 128, 1024, "options.analysisMaxDimension");
  number(o.maxFrames, 1, 2000, "options.maxFrames");
  number(o.componentConfidenceThreshold, 0, 1, "options.componentConfidenceThreshold", false);
  object(
    o.grid,
    [
      "gutterOccupancyThreshold",
      "minGutterPx",
      "minCellPx",
      "periodTolerance",
      "confidenceThreshold",
      "keepEmptyCells",
    ],
    "options.grid",
  );
  number(o.grid.gutterOccupancyThreshold, 0, 0.2, "options.grid.gutterOccupancyThreshold", false);
  number(o.grid.minGutterPx, 1, 64, "options.grid.minGutterPx");
  number(o.grid.minCellPx, 1, 1024, "options.grid.minCellPx");
  number(o.grid.periodTolerance, 0, 0.5, "options.grid.periodTolerance", false);
  number(o.grid.confidenceThreshold, 0, 1, "options.grid.confidenceThreshold", false);
  bool(o.grid.keepEmptyCells, "options.grid.keepEmptyCells");
  normalizeOptions(o.normalize, "options.normalize");
  if (o.normalize.alphaThreshold !== o.alphaThreshold) invalid("options.normalize.alphaThreshold");
  if (o.mode !== "manual-grid") {
    if (o.manualGrid !== null) invalid("options.manualGrid");
    return;
  }
  object(o.manualGrid, ["rows", "columns", "region", "keepEmptyCells"], "options.manualGrid");
  const m = o.manualGrid;
  number(m.rows, 1, 100, "options.manualGrid.rows");
  number(m.columns, 1, 100, "options.manualGrid.columns");
  bool(m.keepEmptyCells, "options.manualGrid.keepEmptyCells");
  if (m.region !== null) rect(m.region, bounds, "options.manualGrid.region");
  const area = m.region ?? bounds;
  if (
    m.rows > area.height ||
    m.columns > area.width ||
    m.rows * m.columns > Math.min(o.maxFrames, resources.maxFrames)
  )
    invalid("options.manualGrid");
}
export function packOptions(o: PackOptions, resources: ResourceLimits): void {
  object(
    o,
    [
      "maxWidth",
      "maxHeight",
      "sizeMode",
      "padding",
      "extrude",
      "border",
      "allowRotation",
      "maxPages",
      "heuristic",
    ],
    "options",
  );
  number(o.maxWidth, 64, Math.min(8192, resources.maxDimension), "options.maxWidth");
  number(o.maxHeight, 64, Math.min(8192, resources.maxDimension), "options.maxHeight");
  oneOf(o.sizeMode, ["auto", "pot"], "options.sizeMode");
  oneOf(o.heuristic, ["max-edge", "max-area"], "options.heuristic");
  number(o.padding, 0, 32, "options.padding");
  number(o.extrude, 0, 8, "options.extrude");
  number(o.border, 0, 32, "options.border");
  number(o.maxPages, 1, 16, "options.maxPages");
  bool(o.allowRotation, "options.allowRotation");
  if (
    o.sizeMode === "pot" &&
    (!Number.isInteger(Math.log2(o.maxWidth)) || !Number.isInteger(Math.log2(o.maxHeight)))
  )
    invalid("options.sizeMode");
}
export function frameCount(
  frames: unknown,
  resources: ResourceLimits,
): asserts frames is unknown[] {
  if (!Array.isArray(frames)) invalid("frames");
  if (frames.length > resources.maxFrames)
    fail(Code.InvalidArgument, Stage.Validate, {
      field: "frames",
      actual: frames.length,
      limit: resources.maxFrames,
    });
}
export function drafts(values: FrameDraft[], bounds: Size, resources: ResourceLimits): void {
  frameCount(values, resources);
  const seen = new Set<string>();
  for (const [index, d] of values.entries()) {
    const f = `drafts.${index}`;
    object(
      d,
      [
        "id",
        "name",
        "sourceRect",
        "origin",
        "sourceFrameIds",
        "edited",
        "included",
        "reviewStatus",
      ],
      f,
    );
    draftFields(d, bounds, f);
    if (seen.has(d.id)) invalid(`${f}.id`);
    seen.add(d.id);
  }
}
function draftFields(d: Omit<FrameDraft, "edited">, bounds: Size, f: string): void {
  id(d.id, `${f}.id`);
  if (typeof d.name !== "string") invalid(`${f}.name`);
  rect(d.sourceRect, bounds, `${f}.sourceRect`);
  oneOf(d.origin, ["grid", "components", "manual"], `${f}.origin`);
  oneOf(d.reviewStatus, ["pending", "accepted"], `${f}.reviewStatus`);
  bool(d.included, `${f}.included`);
  if ("edited" in d) bool(d.edited, `${f}.edited`);
  if (!Array.isArray(d.sourceFrameIds)) invalid(`${f}.sourceFrameIds`);
  for (const source of d.sourceFrameIds) id(source, `${f}.sourceFrameIds`);
}
export function frames(
  values: Frame[],
  assetRef: AssetRef,
  resources: ResourceLimits,
  bounds: Size = { width: 8192, height: 8192 },
): Frame[] {
  frameCount(values, resources);
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [i, frame] of values.entries()) {
    const f = `frames.${i}`;
    object(
      frame,
      [
        "id",
        "asset",
        "name",
        "sourceRect",
        "bbox",
        "canvas",
        "pHash",
        "clusterId",
        "flags",
        "origin",
        "sourceFrameIds",
        "included",
        "reviewStatus",
      ],
      f,
    );
    draftFields(frame, bounds, f);
    ref(frame.asset, `${f}.asset`);
    if (!sameRef(frame.asset, assetRef)) fail(Code.StaleResult);
    if (ids.has(frame.id)) invalid(`${f}.id`);
    ids.add(frame.id);
    object(frame.canvas, ["width", "height", "offset"], `${f}.canvas`);
    number(frame.canvas.width, 1, Number.MAX_SAFE_INTEGER, `${f}.canvas.width`);
    number(frame.canvas.height, 1, Number.MAX_SAFE_INTEGER, `${f}.canvas.height`);
    object(frame.canvas.offset, ["x", "y"], `${f}.canvas.offset`);
    number(frame.canvas.offset.x, 0, frame.canvas.width - 1, `${f}.canvas.offset.x`);
    number(frame.canvas.offset.y, 0, frame.canvas.height - 1, `${f}.canvas.offset.y`);
    object(
      frame.flags,
      ["outlier", "merged", "multipleComponents", "empty", "edited", "duplicateOf"],
      `${f}.flags`,
    );
    for (const key of ["outlier", "merged", "multipleComponents", "empty", "edited"] as const)
      bool(frame.flags[key], `${f}.flags.${key}`);
    if (frame.flags.duplicateOf !== null) invalid(`${f}.flags.duplicateOf`);
    if (
      frame.flags.empty !== (frame.bbox === null) ||
      frame.flags.merged !== frame.sourceFrameIds.length >= 2
    )
      invalid(`${f}.flags`);
    if (frame.bbox) {
      rect(frame.bbox, bounds, `${f}.bbox`);
      const b = frame.bbox,
        s = frame.sourceRect;
      if (
        b.x < s.x ||
        b.y < s.y ||
        b.x + b.width > s.x + s.width ||
        b.y + b.height > s.y + s.height ||
        b.width + frame.canvas.offset.x > frame.canvas.width ||
        b.height + frame.canvas.offset.y > frame.canvas.height
      )
        invalid(`${f}.bbox`);
    } else if (
      frame.canvas.offset.x ||
      frame.canvas.offset.y ||
      frame.pHash !== null ||
      frame.clusterId !== null ||
      frame.flags.outlier
    )
      invalid(f);
    if (frame.clusterId !== null) id(frame.clusterId, `${f}.clusterId`);
    if (frame.pHash !== null) {
      object(frame.pHash, ["algorithm", "hex"], `${f}.pHash`);
      if (frame.pHash.algorithm !== "dhash64-v1" || !/^[a-f0-9]{16}$/.test(frame.pHash.hex))
        invalid(`${f}.pHash`);
    }
    if (frame.included) {
      name(frame.name, `${f}.name`);
      if (names.has(frame.name.toLowerCase())) invalid(`${f}.name`);
      names.add(frame.name.toLowerCase());
    }
  }
  const included = values.filter((frame) => frame.included);
  if (!included.length) fail(Code.NoFrames);
  const pending = included.filter((frame) => frame.reviewStatus !== "accepted");
  if (pending.length)
    fail(Code.ReviewRequired, Stage.Validate, { frameIds: pending.map((frame) => frame.id) });
  return included;
}
