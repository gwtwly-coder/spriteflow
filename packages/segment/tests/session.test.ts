// SamSession tests (contract section 4, :429-529) over injected fake backends:
// single WebGPU→WASM retry, terminal admission failures, BUSY single-task lock,
// INVALID_STATE after dispose, embed-once per asset revision, prompt validation
// and point dedup, plus the inference-replay rules.
import { describe, expect, it } from "vitest";
import { createSamSession } from "../src/session.js";
import {
  type CharacterError,
  CharacterStage,
  CharacterWarningCode,
  CharacterErrorCode as Code,
} from "../src/types.js";
import { asset, cancellableContext, context, value } from "./helpers.js";
import { fakeBackend, SAM_MANIFEST } from "./samHelpers.js";

const RUNTIME = { provider: "auto", wasmThreads: 1, useModelCache: true } as const;

function codedError(code: Code): CharacterError {
  return {
    code,
    messageKey: `character.error.${code}`,
    stage: CharacterStage.ModelInitialize,
    recoverable: true,
    recoveryActions: [],
    details: {},
  };
}

function errorCodeOf(outcome: { ok: true } | { ok: false; error: CharacterError }): string | null {
  return outcome.ok ? null : outcome.error.code;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("initialize provider fallback", () => {
  it("retries WASM exactly once when WebGPU creation fails", async () => {
    const { backend, calls } = fakeBackend({
      createErrors: { webgpu: new Error("no webgpu device") },
    });
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    const info = value(await session.initialize(context()));
    expect(info.provider).toBe("wasm");
    expect(info.state).toBe("ready");
    expect(info.modelId).toBe(SAM_MANIFEST.modelId);
    expect(info.warnings.map((warning) => warning.code)).toEqual([
      CharacterWarningCode.WebGpuFallbackToWasm,
    ]);
    expect(calls.create).toEqual([
      { modelId: SAM_MANIFEST.modelId, provider: "webgpu" },
      { modelId: SAM_MANIFEST.modelId, provider: "wasm" },
    ]);
  });

  it("fails with MODEL_INITIALIZATION_FAILED when both providers fail", async () => {
    const { backend, calls } = fakeBackend({
      createErrors: { webgpu: new Error("no webgpu"), wasm: new Error("no wasm") },
    });
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    const outcome = await session.initialize(context());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe(Code.ModelInitializationFailed);
    expect(calls.create).toHaveLength(2);
  });

  it("does not retry when the requested provider is wasm", async () => {
    const { backend, calls } = fakeBackend({ createErrors: { wasm: new Error("boom") } });
    const session = createSamSession(SAM_MANIFEST, { ...RUNTIME, provider: "wasm" }, backend);
    const outcome = await session.initialize(context());
    expect(outcome.ok).toBe(false);
    expect(calls.create).toHaveLength(1);
  });

  it("never retries terminal admission failures (hash/license/allowlist)", async () => {
    for (const code of [Code.ModelNotApproved, Code.ModelHashMismatch, Code.ModelDownloadFailed]) {
      const { backend, calls } = fakeBackend({ createErrors: { webgpu: codedError(code) } });
      const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
      const outcome = await session.initialize(context());
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("unreachable");
      expect(outcome.error.code).toBe(code);
      expect(calls.create, code).toHaveLength(1);
    }
  });

  it("is idempotent once ready and reports backend diagnostics", async () => {
    const { backend, calls } = fakeBackend({
      diagnostics: {
        cachedModel: true,
        warnings: [
          {
            code: CharacterWarningCode.ModelCacheUnavailable,
            messageKey: "character.warning.MODEL_CACHE_UNAVAILABLE",
            partIds: [],
          },
        ],
      },
    });
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    const first = value(await session.initialize(context()));
    expect(first.cachedModel).toBe(true);
    expect(first.warnings.map((warning) => warning.code)).toEqual([
      CharacterWarningCode.ModelCacheUnavailable,
    ]);
    const second = value(await session.initialize(context()));
    expect(second.sessionId).toBe(first.sessionId);
    expect(calls.create).toHaveLength(1);
  });

  it("rejects malformed manifests and runtime options", async () => {
    const { backend } = fakeBackend();
    const session = createSamSession({ ...SAM_MANIFEST, sha256: "nothex" }, RUNTIME, backend);
    expect(errorCodeOf(await session.initialize(context()))).toBe(Code.InvalidArgument);
    const badThreads = createSamSession(
      SAM_MANIFEST,
      { ...RUNTIME, wasmThreads: 4 as unknown as 1 },
      backend,
    );
    expect(errorCodeOf(await badThreads.initialize(context()))).toBe(Code.InvalidArgument);
  });
});

describe("setImage", () => {
  it("rejects embedding before a successful initialize", async () => {
    const { backend } = fakeBackend();
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    expect(errorCodeOf(await session.setImage(asset(), context()))).toBe(Code.InvalidState);
  });

  it("embeds once per asset revision", async () => {
    const { backend, calls } = fakeBackend();
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    value(await session.initialize(context()));
    const source = asset(8, 8);
    value(await session.setImage(source, context()));
    value(await session.setImage(source, context()));
    expect(calls.embeds).toHaveLength(1);
    value(await session.setImage(asset(8, 8), context())); // same ref (fixture revision 1)
    expect(calls.embeds).toHaveLength(1);
  });

  it("rejects assets beyond the manifest max source dimension", async () => {
    const { backend } = fakeBackend();
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    value(await session.initialize(context()));
    const outcome = await session.setImage(asset(2_049, 8), context());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe(Code.ResourceLimit);
    expect(outcome.error.details.limit).toBe(SAM_MANIFEST.maxSourceDimension);
  });
});

describe("segment", () => {
  it("requires an embedded image", async () => {
    const { backend } = fakeBackend();
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    value(await session.initialize(context()));
    const outcome = await session.segment(
      { type: "box", box: { x: 0, y: 0, width: 4, height: 4 }, points: [] },
      context(),
    );
    expect(errorCodeOf(outcome)).toBe(Code.InvalidState);
  });

  it("validates box and point prompts against the embedded image", async () => {
    const { backend } = fakeBackend();
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    value(await session.initialize(context()));
    value(await session.setImage(asset(8, 8), context()));
    const cases: Parameters<typeof session.segment>[0][] = [
      { type: "box", box: { x: 6, y: 0, width: 4, height: 4 }, points: [] }, // outside
      { type: "box", box: { x: 0, y: 0, width: 0, height: 4 }, points: [] }, // empty
      { type: "box", box: { x: 0.5, y: 0, width: 2, height: 2 } as never, points: [] }, // non-integer
      { type: "points", points: [], box: null }, // no points
      { type: "points", points: [{ point: { x: 1, y: 1 }, label: "negative" }], box: null }, // no positive
      {
        type: "points",
        points: [
          { point: { x: 1, y: 1 }, label: "positive" },
          ...Array.from({ length: 17 }, (_, index) => ({
            point: { x: 2, y: index },
            label: "negative" as const,
          })),
        ],
        box: null,
      }, // too many negatives
      { type: "points", points: [{ point: { x: 8, y: 0 }, label: "positive" }], box: null }, // out of range
    ];
    for (const prompt of cases) {
      const outcome = await session.segment(prompt, context());
      expect(outcome.ok, JSON.stringify(prompt)).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.error.code).toBe(Code.InvalidPrompt);
      expect(outcome.error.stage).toBe(CharacterStage.PromptInference);
    }
  });

  it("deduplicates exactly identical points before calling the backend", async () => {
    const { backend, calls } = fakeBackend();
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    value(await session.initialize(context()));
    value(await session.setImage(asset(8, 8), context()));
    value(
      await session.segment(
        {
          type: "points",
          points: [
            { point: { x: 1, y: 1 }, label: "positive" },
            { point: { x: 1, y: 1 }, label: "positive" },
            { point: { x: 1, y: 1 }, label: "negative" },
            { point: { x: 3, y: 2 }, label: "negative" },
          ],
          box: null,
        },
        context(),
      ),
    );
    expect(calls.infer[0]?.points).toHaveLength(3);
  });

  it("returns the mask with the session provider and the current asset ref", async () => {
    const { backend } = fakeBackend({
      createErrors: { webgpu: new Error("no webgpu") },
    });
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    value(await session.initialize(context()));
    const source = asset(8, 8);
    value(await session.setImage(source, context()));
    const mask = value(
      await session.segment(
        { type: "box", box: { x: 1, y: 1, width: 3, height: 3 }, points: [] },
        context(),
      ),
    );
    expect(mask.asset).toEqual(source.ref);
    expect(mask.provider).toBe("wasm");
    expect(mask.sourceRect).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    expect(mask.mask.width).toBe(8);
  });

  it("returns BUSY while an inference is in flight", async () => {
    const gate = deferred<void>();
    const { backend } = fakeBackend({
      inferImpl: async () => {
        await gate.promise;
        return {
          mask: { width: 8, height: 8, encoding: "bitset-lsb0-row-major", data: new Uint8Array(8) },
          sourceRect: { x: 0, y: 0, width: 8, height: 8 },
          predictedIou: 0.5,
        };
      },
    });
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    value(await session.initialize(context()));
    value(await session.setImage(asset(8, 8), context()));
    const first = session.segment(
      { type: "box", box: { x: 0, y: 0, width: 4, height: 4 }, points: [] },
      context(),
    );
    const second = await session.segment(
      { type: "box", box: { x: 0, y: 0, width: 4, height: 4 }, points: [] },
      context(),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe(Code.Busy);
    gate.resolve();
    expect((await first).ok).toBe(true);
  });
});

describe("inference replay on WebGPU", () => {
  it("rebuilds with WASM, re-embeds and replays the prompt once", async () => {
    let inferCalls = 0;
    const { backend, calls } = fakeBackend({
      inferImpl: async () => {
        inferCalls += 1;
        if (inferCalls === 1) throw new Error("webgpu inference crashed");
        return {
          mask: { width: 8, height: 8, encoding: "bitset-lsb0-row-major", data: new Uint8Array(8) },
          sourceRect: { x: 0, y: 0, width: 8, height: 8 },
          predictedIou: 0.8,
        };
      },
    });
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    value(await session.initialize(context()));
    value(await session.setImage(asset(8, 8), context()));
    const mask = value(
      await session.segment(
        { type: "box", box: { x: 0, y: 0, width: 4, height: 4 }, points: [] },
        context(),
      ),
    );
    expect(mask.provider).toBe("wasm");
    expect(calls.create).toEqual([
      { modelId: SAM_MANIFEST.modelId, provider: "webgpu" },
      { modelId: SAM_MANIFEST.modelId, provider: "wasm" },
    ]);
    expect(calls.embeds).toHaveLength(2); // re-embedded after the rebuild
    expect(calls.dispose).toBe(1);
    const info = value(await session.setImage(asset(8, 8), context()));
    expect(info.warnings.map((warning) => warning.code)).toEqual([
      CharacterWarningCode.WebGpuFallbackToWasm,
    ]);
  });

  it("never replays when the context is cancelled", async () => {
    let inferCalls = 0;
    const cancellable = cancellableContext();
    const { backend, calls } = fakeBackend({
      inferImpl: async () => {
        inferCalls += 1;
        cancellable.cancel();
        throw new Error("crash before cancel");
      },
    });
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    value(await session.initialize(cancellable));
    value(await session.setImage(asset(8, 8), cancellable));
    const outcome = await session.segment(
      { type: "box", box: { x: 0, y: 0, width: 4, height: 4 }, points: [] },
      cancellable,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe(Code.Cancelled);
    expect(calls.create).toHaveLength(1);
    expect(inferCalls).toBe(1);
  });
});

describe("dispose", () => {
  it("is idempotent and invalidates every operation", async () => {
    const { backend, calls } = fakeBackend();
    const session = createSamSession(SAM_MANIFEST, RUNTIME, backend);
    value(await session.initialize(context()));
    await session.dispose();
    await session.dispose();
    expect(calls.dispose).toBe(1);
    expect(errorCodeOf(await session.initialize(context()))).toBe(Code.InvalidState);
    expect(errorCodeOf(await session.setImage(asset(), context()))).toBe(Code.InvalidState);
    expect(
      errorCodeOf(
        await session.segment(
          { type: "box", box: { x: 0, y: 0, width: 4, height: 4 }, points: [] },
          context(),
        ),
      ),
    ).toBe(Code.InvalidState);
  });
});
