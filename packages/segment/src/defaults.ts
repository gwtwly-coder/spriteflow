// Contract constants (docs/interface-contract-v3.md section 1 line 71, section 2
// line 224 and section 4 line 461). Objects are frozen: limits/options must not
// change at runtime.
import type { CharacterLimits, SamRuntimeOptions, SegmentationOptions } from "./types.js";

export const V3_CONTRACT_VERSION = "3.0.0" as const;
export const V3_PROTOCOL_VERSION = 1 as const;

export const DEFAULT_CHARACTER_LIMITS: Readonly<CharacterLimits> = Object.freeze({
  maxWorkingDimension: 2048,
  maxWorkingPixels: 4_194_304,
  maxParts: 32,
  maxPromptsPerPart: 16,
  /** v3.5 reserved — no v3.0-alpha stage reads or enforces this limit. */
  maxMotionFrames: 120,
  /** v3.5 reserved — no v3.0-alpha stage reads or enforces this limit. */
  maxRenderPixels: 67_108_864,
  // r3: raised from 41,943,040 (40 MiB) to fit the measured SAM 2.1 Hiera-Tiny
  // fp16 encoder at 67,313,499 bytes
  // (docs/research/2026-09-30-sam2-onnx-model-sources.md, contract line 71).
  maxModelBytes: 83_886_080,
  maxLlmResponseBytes: 1_048_576,
  maxArchiveBytes: 268_435_456,
});

export const DEFAULT_SEGMENTATION_OPTIONS: Readonly<SegmentationOptions> = Object.freeze({
  maxParts: 32,
  minimumPartConfidence: 0.35,
  minimumMaskConfidence: 0.5,
  modelInputMaxDimension: 1024,
  preserveSmallParts: true,
});

export const DEFAULT_SAM_RUNTIME_OPTIONS: Readonly<SamRuntimeOptions> = Object.freeze({
  provider: "auto",
  wasmThreads: 1 as const,
  useModelCache: true,
});
