// Shared fixtures for @spriteflow/segment tests (style follows packages/pipeline/tests).
import { expect } from "vitest";
import { DEFAULT_CHARACTER_LIMITS, DEFAULT_SEGMENTATION_OPTIONS } from "../src/defaults.js";
import type { InputAsset, Rect } from "../src/m1.js";
import type {
  CharacterExecutionContext,
  CharacterLimits,
  CharacterOutcome,
  LlmChatRequest,
  LlmChatResponse,
  LlmImage,
  LlmLocateRequest,
  LlmProviderConfig,
  LlmTransport,
  SegmentationOptions,
} from "../src/types.js";

/** Minimal valid InputAsset with zeroed RGBA pixels. */
export function asset(width = 32, height = 24): InputAsset {
  return {
    ref: { assetId: "fixture", revision: 1 },
    name: "fixture.png",
    sourceMime: "application/x-rgba8",
    originalSize: { width, height },
    scaleFromOriginal: { x: 1, y: 1 },
    pixels: {
      width,
      height,
      format: "rgba8",
      colorSpace: "srgb",
      alphaMode: "straight",
      data: new Uint8ClampedArray(width * height * 4),
    },
  };
}

/** Fills a rect with one RGBA color (mutates the asset, chainable like pipeline tests). */
export function paint(
  input: InputAsset,
  rect: Rect,
  rgba: readonly [number, number, number, number],
): InputAsset {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      input.pixels.data.set(rgba, (y * input.pixels.width + x) * 4);
    }
  }
  return input;
}

/** Deterministic per-pixel gradient so every working coordinate is distinguishable. */
export function paintGradient(input: InputAsset): InputAsset {
  for (let y = 0; y < input.pixels.height; y++) {
    for (let x = 0; x < input.pixels.width; x++) {
      const offset = (y * input.pixels.width + x) * 4;
      input.pixels.data[offset] = (x * 7) % 256;
      input.pixels.data[offset + 1] = (y * 11) % 256;
      input.pixels.data[offset + 2] = (x + y) % 256;
      input.pixels.data[offset + 3] = 255;
    }
  }
  return input;
}

/** Unwraps an outcome or fails the test with the full error JSON. */
export function value<T>(outcome: CharacterOutcome<T>): T {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  if (!outcome.ok) throw new Error(outcome.error.code);
  return outcome.value;
}

export function context(limits?: Partial<CharacterLimits>): CharacterExecutionContext {
  return {
    taskId: "task-1",
    isCancelled: () => false,
    yieldControl: async () => {},
    onProgress: () => {},
    limits: { ...DEFAULT_CHARACTER_LIMITS, ...limits },
  };
}

export function cancellableContext(): CharacterExecutionContext & { cancel(): void } {
  const state = { cancelled: false };
  return {
    taskId: "task-1",
    isCancelled: () => state.cancelled,
    cancel: () => {
      state.cancelled = true;
    },
    yieldControl: async () => {},
    onProgress: () => {},
    limits: { ...DEFAULT_CHARACTER_LIMITS },
  };
}

export type QueuedResponse = LlmChatResponse | Error;

/** Transport double that records every request and replays a scripted answer list. */
export function scriptedTransport(script: QueuedResponse[]) {
  const requests: LlmChatRequest[] = [];
  const transport: LlmTransport = {
    async send(request) {
      requests.push(request);
      const next = script.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error("transport received an unexpected extra request");
      return next;
    },
  };
  return { transport, requests };
}

export const LOCATE_IMAGE: LlmImage = {
  mime: "image/png",
  dataUrl: "data:image/png;base64,QUJDREVG",
  width: 64,
  height: 48,
};

export const PROVIDER: LlmProviderConfig = {
  endpoint: "https://llm.example.com/v1/chat/completions",
  model: "vision-model",
  apiKey: "sk-unit-test-key",
  timeoutMs: 4_000,
  maxResponseBytes: 65_536,
  maxOutputTokens: 1_024,
};

export function locateRequest(options?: Partial<SegmentationOptions>): LlmLocateRequest {
  return {
    asset: { assetId: "fixture", revision: 1 },
    image: LOCATE_IMAGE,
    provider: PROVIDER,
    userConsent: true,
    options: { ...DEFAULT_SEGMENTATION_OPTIONS, ...options },
  };
}

export const VALID_LOCATE_DOCUMENT = {
  schemaVersion: "spriteflow-parts/1",
  coordinateSpace: "working-pixels-top-left-half-open",
  humanoid: { isHumanoid: true, confidence: 0.9, reason: "humanoid" },
  parts: [
    {
      kind: "hair",
      name: "hair",
      box: { x: 4, y: 2, width: 20, height: 12 },
      confidence: 0.8,
      occluded: false,
    },
  ],
};

export function chatResponse(body: unknown, status = 200): LlmChatResponse {
  return { status, retryAfterMs: null, body };
}
