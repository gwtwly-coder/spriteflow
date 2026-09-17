import type { DetectOptions, NormalizeOptions, PackOptions, ResourceLimits } from "./types.js";

export const CONTRACT_VERSION = "3.0.0" as const;
export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_NORMALIZE_OPTIONS: Readonly<NormalizeOptions> = Object.freeze({
  alphaThreshold: 8,
  componentMinAreaPx: 4,
  trim: true,
  padding: 0,
  canvasMode: "uniform",
  alignment: "center",
  computeHash: true,
  outlierThreshold: 0.4,
  clusterTolerance: 0.3,
});
export const DEFAULT_DETECT_OPTIONS: Readonly<DetectOptions> = Object.freeze({
  mode: "auto",
  quality: "final",
  alphaThreshold: 8,
  minAreaPx: 4,
  minAreaRatio: 0.00001,
  dilationRadiusPx: null,
  mergeDistancePx: null,
  mergeDistanceRatio: 0.15,
  connectivity: 8,
  analysisMaxDimension: 1024,
  componentConfidenceThreshold: 0.75,
  maxFrames: 500,
  grid: Object.freeze({
    gutterOccupancyThreshold: 0.005,
    minGutterPx: 2,
    minCellPx: 4,
    periodTolerance: 0.08,
    confidenceThreshold: 0.9,
    keepEmptyCells: false,
  }),
  manualGrid: null,
  normalize: DEFAULT_NORMALIZE_OPTIONS,
});
export const DEFAULT_PACK_OPTIONS: Readonly<PackOptions> = Object.freeze({
  maxWidth: 2048,
  maxHeight: 2048,
  sizeMode: "auto",
  padding: 2,
  extrude: 1,
  border: 0,
  allowRotation: false,
  maxPages: 1,
  heuristic: "max-edge",
});
export const DESKTOP_LIMITS: Readonly<ResourceLimits> = Object.freeze({
  maxInputBytes: 52_428_800,
  maxDimension: 8192,
  maxPixels: 67_108_864,
  memoryBudgetBytes: 1_073_741_824,
  maxFrames: 2000,
  maxArchiveBytes: 268_435_456,
});
export const MOBILE_LIMITS: Readonly<ResourceLimits> = Object.freeze({
  maxInputBytes: 20_971_520,
  maxDimension: 4096,
  maxPixels: 16_777_216,
  memoryBudgetBytes: 268_435_456,
  maxFrames: 500,
  maxArchiveBytes: 67_108_864,
});
