// Orchestration tests (contract section 5, :534-591): consent gate, LLM failure
// and non-humanoid click degradation, semantic success with PartAsset assembly
// and pixel-source checks, click prompt mode, progress monotonicity and
// cancellation.
import { describe, expect, it } from "vitest";
import { DEFAULT_SAM_RUNTIME_OPTIONS, DEFAULT_SEGMENTATION_OPTIONS } from "../src/defaults.js";
import { segmentByPrompts, segmentSemantically } from "../src/orchestration.js";
import { extractPartPixels } from "../src/partAsset.js";
import {
  type CharacterProgressEvent,
  type LlmChatResponse,
  type LlmImage,
  type LlmProviderConfig,
  type LlmTransport,
  PartKind,
  SegmentationDegradedReason,
} from "../src/types.js";
import { asset, cancellableContext, context, paint, value } from "./helpers.js";
import { fakeBackend, SAM_MANIFEST } from "./samHelpers.js";

const IMAGE: LlmImage = {
  mime: "image/png",
  dataUrl: "data:image/png;base64,QUJDREVG",
  width: 8,
  height: 8,
};

const PROVIDER: LlmProviderConfig = {
  endpoint: "https://llm.example.com/v1/chat/completions",
  model: "vision-model",
  apiKey: "sk-unit-test-key",
  timeoutMs: 4_000,
  maxResponseBytes: 65_536,
  maxOutputTokens: 1_024,
};

function document(
  parts: unknown[],
  humanoid = { isHumanoid: true, confidence: 0.9, reason: "humanoid" },
) {
  return JSON.stringify({
    schemaVersion: "spriteflow-parts/1",
    coordinateSpace: "working-pixels-top-left-half-open",
    humanoid,
    parts,
  });
}

const HAIR_PART = {
  kind: "hair",
  name: "hair",
  box: { x: 0, y: 0, width: 4, height: 4 },
  confidence: 0.8,
  occluded: false,
};
const TORSO_PART = {
  kind: "torso",
  name: "torso",
  box: { x: 2, y: 2, width: 5, height: 5 },
  confidence: 0.9,
  occluded: false,
};

function okResponse(body: unknown, status = 200): LlmChatResponse {
  return { status, retryAfterMs: null, body };
}

function semanticRequest(overrides?: { llmConsent?: boolean; llm?: LlmProviderConfig | null }) {
  return {
    asset: paint(asset(8, 8), { x: 0, y: 0, width: 4, height: 4 }, [255, 0, 0, 255]),
    image: IMAGE,
    llm: overrides?.llm === undefined ? PROVIDER : overrides.llm,
    llmConsent: overrides?.llmConsent ?? true,
    model: SAM_MANIFEST,
    options: { ...DEFAULT_SEGMENTATION_OPTIONS },
    runtime: { ...DEFAULT_SAM_RUNTIME_OPTIONS },
  };
}

describe("segmentSemantically consent and configuration gates", () => {
  it("never calls the transport without consent and degrades to LLM_UNAVAILABLE", async () => {
    const requests: unknown[] = [];
    const transport: LlmTransport = {
      async send(request) {
        requests.push(request);
        return okResponse(document([HAIR_PART]));
      },
    };
    const outcome = await segmentSemantically(
      semanticRequest({ llmConsent: false }),
      transport,
      fakeBackend().backend,
      context(),
    );
    expect(requests).toHaveLength(0);
    const result = value(outcome);
    expect(result.mode).toBe("click");
    expect(result.parts).toHaveLength(0);
    expect(result.degraded?.reason).toBe(SegmentationDegradedReason.LlmUnavailable);
    expect(result.humanoid).toBeNull();
  });

  it("degrades to LLM_UNAVAILABLE when no provider is configured", async () => {
    const outcome = await segmentSemantically(
      semanticRequest({ llm: null }),
      {
        async send() {
          throw new Error("must not be called");
        },
      },
      fakeBackend().backend,
      context(),
    );
    expect(value(outcome).degraded?.reason).toBe(SegmentationDegradedReason.LlmUnavailable);
  });
});

describe("segmentSemantically LLM failure and humanoid gates", () => {
  it("returns a click-mode result when the provider rate-limits", async () => {
    const outcome = await segmentSemantically(
      semanticRequest(),
      {
        async send() {
          return okResponse({ error: "rate limited" }, 429);
        },
      },
      fakeBackend().backend,
      context(),
    );
    const result = value(outcome);
    expect(result.mode).toBe("click");
    expect(result.degraded?.reason).toBe(SegmentationDegradedReason.LlmFailed);
    expect(result.warnings.map((warning) => warning.code)).toContain("LLM_FALLBACK_TO_CLICK");
  });

  it("returns a click-mode result after an unrepairable LLM reply", async () => {
    const outcome = await segmentSemantically(
      semanticRequest(),
      {
        async send() {
          return okResponse("not json at all");
        },
      },
      fakeBackend().backend,
      context(),
    );
    const result = value(outcome);
    expect(result.degraded?.reason).toBe(SegmentationDegradedReason.LlmFailed);
    expect(result.parts).toHaveLength(0);
  });

  it("returns a click-mode result for explicit non-humanoid assessments", async () => {
    const nonHumanoid = { isHumanoid: false, confidence: 0.95, reason: "non-humanoid" };
    const outcome = await segmentSemantically(
      semanticRequest(),
      {
        async send() {
          return okResponse(document([HAIR_PART], nonHumanoid));
        },
      },
      fakeBackend().backend,
      context(),
    );
    const result = value(outcome);
    expect(result.mode).toBe("click");
    expect(result.humanoid).toEqual(nonHumanoid);
    expect(result.degraded?.reason).toBe(SegmentationDegradedReason.NonHumanoid);
    expect(result.warnings.map((warning) => warning.code)).toContain("NON_HUMANOID_CLICK_MODE");
  });

  it("returns a click-mode result when humanoid confidence is too low", async () => {
    const uncertain = { isHumanoid: true, confidence: 0.2, reason: "uncertain" };
    const outcome = await segmentSemantically(
      semanticRequest(),
      {
        async send() {
          return okResponse(document([HAIR_PART], uncertain));
        },
      },
      fakeBackend().backend,
      context(),
    );
    const result = value(outcome);
    expect(result.degraded?.reason).toBe(SegmentationDegradedReason.LowSemanticConfidence);
  });
});

describe("segmentSemantically semantic success path", () => {
  it("assembles parts with package-generated IDs and source-exact pixels", async () => {
    const source = paint(asset(8, 8), { x: 0, y: 0, width: 4, height: 4 }, [10, 20, 30, 255]);
    const outcome = await segmentSemantically(
      { ...semanticRequest(), asset: source },
      {
        async send() {
          return okResponse(document([HAIR_PART, TORSO_PART]));
        },
      },
      fakeBackend().backend,
      context(),
    );
    const result = value(outcome);
    expect(result.mode).toBe("semantic");
    expect(result.degraded).toBeNull();
    expect(result.parts).toHaveLength(2);
    expect(result.humanoid?.isHumanoid).toBe(true);
    expect(new Set(result.parts.map((part) => part.id)).size).toBe(2);
    expect(result.parts.every((part) => part.id.startsWith("part_"))).toBe(true);
    expect(result.parts.map((part) => part.kind)).toEqual(["hair", "torso"]);
    expect(result.parts.every((part) => part.asset.assetId === source.ref.assetId)).toBe(true);
    expect(result.confidence).toBeCloseTo(0.9);
    // Pixel-source invariant: mask=1 pixels equal the source bytes, mask=0 are
    // fully transparent.
    const firstPart = result.parts[0];
    if (firstPart === undefined) throw new Error("unreachable");
    const extracted = value(extractPartPixels(source, firstPart));
    expect(extracted.width).toBe(8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const offset = (y * 8 + x) * 4;
        const sourceOffset = (y * source.pixels.width + x) * 4;
        if (x < 4) {
          expect(Array.from(extracted.data.slice(offset, offset + 4))).toEqual(
            Array.from(source.pixels.data.slice(sourceOffset, sourceOffset + 4)),
          );
        } else {
          expect(Array.from(extracted.data.slice(offset, offset + 4))).toEqual([0, 0, 0, 0]);
        }
      }
    }
  });

  it("keeps empty masks and low-confidence masks with warnings", async () => {
    const source = asset(8, 8);
    const { backend } = fakeBackend({
      inferImpl: async () => ({
        mask: { width: 8, height: 8, encoding: "bitset-lsb0-row-major", data: new Uint8Array(8) },
        sourceRect: { x: 0, y: 0, width: 8, height: 8 },
        predictedIou: 0.2,
      }),
    });
    const outcome = await segmentSemantically(
      { ...semanticRequest(), asset: source },
      {
        async send() {
          return okResponse(document([HAIR_PART]));
        },
      },
      backend,
      context(),
    );
    const result = value(outcome);
    expect(result.parts).toHaveLength(1); // not silently dropped
    expect(result.warnings.map((warning) => warning.code)).toContain("EMPTY_MASK");
    expect(result.warnings.map((warning) => warning.code)).toContain("LOW_MASK_CONFIDENCE");
  });

  it("propagates SAM initialization failures as errors", async () => {
    const { backend } = fakeBackend({
      createErrors: { webgpu: new Error("no webgpu"), wasm: new Error("no wasm") },
    });
    const outcome = await segmentSemantically(
      semanticRequest(),
      {
        async send() {
          return okResponse(document([HAIR_PART]));
        },
      },
      backend,
      context(),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("MODEL_INITIALIZATION_FAILED");
  });

  it("stops with CANCELLED between parts without emitting complete", async () => {
    const cancellable = cancellableContext();
    const events: CharacterProgressEvent[] = [];
    const observed = {
      ...cancellable,
      onProgress: (event: CharacterProgressEvent) => events.push(event),
    };
    const { backend } = fakeBackend({
      inferImpl: async () => {
        cancellable.cancel();
        return {
          mask: { width: 8, height: 8, encoding: "bitset-lsb0-row-major", data: new Uint8Array(8) },
          sourceRect: { x: 0, y: 0, width: 8, height: 8 },
          predictedIou: 0.9,
        };
      },
    });
    const outcome = await segmentSemantically(
      semanticRequest(),
      {
        async send() {
          return okResponse(document([HAIR_PART, TORSO_PART]));
        },
      },
      backend,
      observed,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("CANCELLED");
    expect(events.some((event) => event.stage === "complete")).toBe(false);
  });

  it("emits monotonic progress ending in a single complete event", async () => {
    const events: CharacterProgressEvent[] = [];
    const observed = {
      ...context(),
      onProgress: (event: CharacterProgressEvent) => events.push(event),
    };
    await segmentSemantically(
      semanticRequest(),
      {
        async send() {
          return okResponse(document([HAIR_PART, TORSO_PART]));
        },
      },
      fakeBackend().backend,
      observed,
    );
    expect(events.length).toBeGreaterThan(2);
    let last = 0;
    for (const event of events) {
      expect(event.overallProgress).toBeGreaterThanOrEqual(last);
      expect(event.overallProgress).toBeLessThanOrEqual(1);
      last = event.overallProgress;
    }
    const final = events[events.length - 1];
    expect(final?.stage).toBe("complete");
    expect(final?.overallProgress).toBe(1);
    expect(final?.cancellable).toBe(false);
    expect(events.filter((event) => event.stage === "complete")).toHaveLength(1);
  });

  it("validates options against context limits", async () => {
    const outcome = await segmentSemantically(
      {
        ...semanticRequest(),
        options: { ...DEFAULT_SEGMENTATION_OPTIONS, maxParts: 3 },
      },
      {
        async send() {
          return okResponse(document([HAIR_PART]));
        },
      },
      fakeBackend().backend,
      context({ maxParts: 2 }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("RESOURCE_LIMIT");
  });
});

describe("segmentByPrompts click mode", () => {
  it("creates anonymous parts from caller prompts", async () => {
    const source = paint(asset(8, 8), { x: 0, y: 0, width: 4, height: 4 }, [1, 2, 3, 255]);
    const events: CharacterProgressEvent[] = [];
    const observed = {
      ...context(),
      onProgress: (event: CharacterProgressEvent) => events.push(event),
    };
    const outcome = await segmentByPrompts(
      {
        asset: source,
        model: SAM_MANIFEST,
        runtime: { ...DEFAULT_SAM_RUNTIME_OPTIONS },
        initialPrompts: [
          {
            kind: PartKind.EyeLeft,
            name: "left eye",
            prompt: { type: "box", box: { x: 1, y: 1, width: 3, height: 3 }, points: [] },
          },
        ],
      },
      fakeBackend().backend,
      observed,
    );
    const result = value(outcome);
    expect(result.mode).toBe("click");
    expect(result.humanoid).toBeNull();
    expect(result.degraded).toBeNull();
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]?.kind).toBe("eye-left");
    expect(result.parts[0]?.name).toBe("left eye");
    expect(result.parts[0]?.id.startsWith("part_")).toBe(true);
    expect(events.some((event) => event.stage === "complete")).toBe(true);
  });

  it("succeeds with zero parts for an empty prompt list", async () => {
    const outcome = await segmentByPrompts(
      {
        asset: asset(8, 8),
        model: SAM_MANIFEST,
        runtime: { ...DEFAULT_SAM_RUNTIME_OPTIONS },
        initialPrompts: [],
      },
      fakeBackend().backend,
      context(),
    );
    const result = value(outcome);
    expect(result.parts).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it("rejects malformed prompt entries", async () => {
    const outcome = await segmentByPrompts(
      {
        asset: asset(8, 8),
        model: SAM_MANIFEST,
        runtime: { ...DEFAULT_SAM_RUNTIME_OPTIONS },
        initialPrompts: [
          {
            kind: "not-a-kind" as never,
            name: "x",
            prompt: { type: "box", box: { x: 0, y: 0, width: 1, height: 1 }, points: [] },
          },
        ],
      },
      fakeBackend().backend,
      context(),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("INVALID_ARGUMENT");
  });
});
