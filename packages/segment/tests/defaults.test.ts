// Contract constant tests (docs/interface-contract-v3.md :32-33, :71, :224) plus a
// Node root-entry import smoke check (section 11 regression list).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHARACTER_LIMITS,
  DEFAULT_SEGMENTATION_OPTIONS,
  V3_CONTRACT_VERSION,
  V3_PROTOCOL_VERSION,
} from "../src/defaults.js";
import * as segment from "../src/index.js";

describe("contract constants", () => {
  it("DEFAULT_CHARACTER_LIMITS matches contract line 71 value by value", () => {
    expect(DEFAULT_CHARACTER_LIMITS).toEqual({
      maxWorkingDimension: 2048,
      maxWorkingPixels: 4_194_304,
      maxParts: 32,
      maxPromptsPerPart: 16,
      maxMotionFrames: 120,
      maxRenderPixels: 67_108_864,
      // r3: 40 MiB → 80 MiB to fit the measured fp16 encoder (67,313,499 bytes).
      maxModelBytes: 83_886_080,
      maxLlmResponseBytes: 1_048_576,
      maxArchiveBytes: 268_435_456,
    });
  });

  it("DEFAULT_CHARACTER_LIMITS cannot change at runtime", () => {
    expect(Object.isFrozen(DEFAULT_CHARACTER_LIMITS)).toBe(true);
  });

  it("DEFAULT_SEGMENTATION_OPTIONS matches contract line 224 value by value", () => {
    expect(DEFAULT_SEGMENTATION_OPTIONS).toEqual({
      maxParts: 32,
      minimumPartConfidence: 0.35,
      minimumMaskConfidence: 0.5,
      modelInputMaxDimension: 1024,
      preserveSmallParts: true,
    });
    expect(Object.isFrozen(DEFAULT_SEGMENTATION_OPTIONS)).toBe(true);
  });

  it("exposes the v3 contract and protocol versions", () => {
    expect(V3_CONTRACT_VERSION).toBe("3.0.0");
    expect(V3_PROTOCOL_VERSION).toBe(1);
  });
});

describe("root entry (Node import, no DOM required)", () => {
  it("exposes the v3.0-alpha contract surface", () => {
    expect(typeof segment.locatePartsWithLlm).toBe("function");
    expect(typeof segment.validatePartAsset).toBe("function");
    expect(typeof segment.extractPartPixels).toBe("function");
    expect(typeof segment.createPartAsset).toBe("function");
    expect(typeof segment.removePartAsset).toBe("function");
    expect(typeof segment.applyMaskEdits).toBe("function");
    expect(typeof segment.maskBounds).toBe("function");
    expect(typeof segment.assertPartPixelInvariant).toBe("function");
    expect(typeof segment.exportPartAssets).toBe("function");
    expect(typeof segment.createSamSession).toBe("function");
    expect(typeof segment.segmentSemantically).toBe("function");
    expect(typeof segment.segmentByPrompts).toBe("function");
    expect(segment.V3_CONTRACT_VERSION).toBe("3.0.0");
    expect(segment.CharacterStage.Validate).toBe("validate");
    expect(segment.PartKind.Other).toBe("other");
    expect(segment.CharacterWarningCode.EmptyMask).toBe("EMPTY_MASK");
    expect(segment.SegmentationDegradedReason.LlmUnavailable).toBe("LLM_UNAVAILABLE");
  });
});
