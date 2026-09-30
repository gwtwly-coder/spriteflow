// Real-backend tests with an injected fake ORT module (contract section 4):
// provider fallback orchestration, admission gates, embed/infer tensor flow,
// mask mapping back to source coordinates and the cache diagnostics protocol.
import { describe, expect, it } from "vitest";
import { getMaskBit } from "../src/bitmask.js";
import {
  createOnnxSamBackendWithDeps,
  type OnnxSamBackendDeps,
  type OrtTensorLike,
} from "../src/browser/onnxBackend.js";
import { createSamSession } from "../src/session.js";
import { CharacterWarningCode, CharacterErrorCode as Code } from "../src/types.js";
import { asset, context, value } from "./helpers.js";
import {
  fakeBackend,
  fakeCache,
  fakeFetch,
  fakeOrt,
  SAM_MANIFEST,
  type SyntheticModel,
  syntheticModel,
} from "./samHelpers.js";

const HALF_POSITIVE_LOGITS = [1, 1, -1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, 1, -1, -1];

function backendDeps(
  model: SyntheticModel,
  ort: ReturnType<typeof fakeOrt>,
  cache: ReturnType<typeof fakeCache> | null = null,
  overrides: Partial<OnnxSamBackendDeps> = {},
): OnnxSamBackendDeps {
  const network = fakeFetch(model.bytes);
  return {
    loadOrtModule: async () => ort.module,
    fetchImpl: network.fetchImpl,
    openCache: async () => (cache === null ? null : cache.cache),
    subtle: globalThis.crypto.subtle,
    useModelCache: true,
    registry: model.registry,
    ...overrides,
  };
}

describe("OnnxSamBackend.create provider handling", () => {
  it("fails for an unsupported provider and succeeds for wasm", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({ failingProviders: ["webgpu"] });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await expect(backend.create(model.encoderManifest, "webgpu")).rejects.toMatchObject({
      characterError: { code: Code.ModelInitializationFailed },
    });
    await backend.create(model.encoderManifest, "wasm");
    expect(ort.created).toHaveLength(2);
    expect(ort.created.every((entry) => entry.providers[0] === "wasm")).toBe(true);
  });

  it("pins the WASM thread count to 1", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt();
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    expect(ort.created.map((entry) => entry.numThreads)).toEqual([1, 1]);
  });

  it("rejects a manifest that drifted from the audited entry before any fetch", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt();
    const deps = backendDeps(model, ort);
    const network = fakeFetch(model.bytes);
    const backend = createOnnxSamBackendWithDeps({ ...deps, fetchImpl: network.fetchImpl });
    await expect(
      backend.create({ ...model.encoderManifest, sha256: "0".repeat(64) }, "wasm"),
    ).rejects.toMatchObject({ characterError: { code: Code.ModelNotApproved } });
    expect(network.requestedUrls).toHaveLength(0);
  });

  it("propagates hash mismatches as MODEL_HASH_MISMATCH", async () => {
    const model = await syntheticModel();
    const wrong = new TextEncoder().encode("spriteflow-fake-encoder-weights-02");
    const ort = fakeOrt();
    const backend = createOnnxSamBackendWithDeps(
      backendDeps(model, ort, null, {
        fetchImpl: fakeFetch(new Map([[model.encoderManifest.artifactUrl, wrong]])).fetchImpl,
      }),
    );
    await expect(backend.create(model.encoderManifest, "wasm")).rejects.toMatchObject({
      characterError: { code: Code.ModelHashMismatch },
    });
  });

  it("rejects unfrozen or unlicensed registry entries", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt();
    const unfrozen = createOnnxSamBackendWithDeps(
      backendDeps(model, ort, null, {
        registry: [{ ...model.encoderEntry, frozen: false }],
      }),
    );
    await expect(unfrozen.create(model.encoderManifest, "wasm")).rejects.toMatchObject({
      characterError: { code: Code.ModelNotApproved },
    });
    const unlicensed = createOnnxSamBackendWithDeps(
      backendDeps(model, ort, null, {
        registry: [
          { ...model.encoderEntry, manifest: { ...model.encoderManifest, licenseId: "bogus" } },
        ],
      }),
    );
    await expect(unlicensed.create(model.encoderManifest, "wasm")).rejects.toMatchObject({
      characterError: { code: Code.ModelNotApproved },
    });
  });
});

describe("OnnxSamBackend embed and infer", () => {
  it("embeds through the encoder and infers through the decoder with scaled prompts", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({ decoderLogits: HALF_POSITIVE_LOGITS, scores: [0.7, 0.9] });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    const source = asset(8, 8);
    await backend.embed(source, model.encoderManifest, context());
    const result = await backend.infer(
      { type: "points", points: [{ point: { x: 6, y: 4 }, label: "positive" }], box: null },
      context(),
    );
    expect(result.predictedIou).toBeCloseTo(0.9);
    expect(result.sourceRect).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    expect(result.mask.width).toBe(8);
    expect(result.mask.height).toBe(8);
    // Logits are positive for grid columns 0-1 → source columns 0-3 after upscale.
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(getMaskBit(result.mask, x, y)).toBe(x < 4);
      }
    }
    const feeds = ort.decoderFeeds[0];
    expect(feeds).toBeDefined();
    // Measured decoder feed set: three passthrough embeddings + prompt tensors
    // + first-run mask memory.
    expect(Object.keys(feeds as Record<string, OrtTensorLike>).sort()).toEqual([
      "has_mask_input",
      "image_embeddings.0",
      "image_embeddings.1",
      "image_embeddings.2",
      "input_labels",
      "input_masks",
      "input_points",
    ]);
    const points = feeds?.input_points;
    expect(points?.data).toBeInstanceOf(Float32Array);
    expect(points?.dims).toEqual([1, 1, 1, 2]); // measured [1,1,N,2] grid coords
    expect(Array.from(points?.data as Float32Array)).toEqual([3, 2]); // (6,4) scaled to the 4x4 grid
    const labels = feeds?.input_labels;
    expect(labels?.dims).toEqual([1, 1, 1]);
    expect(Array.from(labels?.data as BigInt64Array)).toEqual([1n]); // int64 positive label
    const maskMemory = feeds?.input_masks;
    expect(maskMemory?.dims).toEqual([1, 1, 256, 256]);
    expect(Array.from(maskMemory?.data as Float32Array).every((v) => v === 0)).toBe(true);
    const hasMask = feeds?.has_mask_input;
    expect(hasMask?.dims).toEqual([1]);
    expect(Array.from(hasMask?.data as Float32Array)).toEqual([0]);
    // The encoder was fed through the measured pixel_values input.
    const encoderFeeds = ort.encoderFeeds[0];
    expect(Object.keys(encoderFeeds as Record<string, OrtTensorLike>)).toEqual(["pixel_values"]);
    expect(encoderFeeds?.pixel_values?.dims).toEqual([1, 3, 4, 4]);
    expect(encoderFeeds?.pixel_values?.data).toBeInstanceOf(Float32Array);
  });

  it("sends box corners with SAM labels 2/3 when a box prompt has no explicit points", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({ decoderLogits: HALF_POSITIVE_LOGITS, scores: [0.5] });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    await backend.infer(
      { type: "box", box: { x: 2, y: 2, width: 4, height: 4 }, points: [] },
      context(),
    );
    const feeds = ort.decoderFeeds[0];
    const points = feeds?.input_points;
    expect(points?.dims).toEqual([1, 1, 2, 2]);
    // Inclusive half-open corners (2,2)..(5,5) scaled to the 4x4 grid.
    expect(Array.from(points?.data as Float32Array)).toEqual([1, 1, 2.5, 2.5]);
    expect(Array.from(feeds?.input_labels?.data as BigInt64Array)).toEqual([2n, 3n]);
  });

  it("appends box corners after explicit points with labels 2/3", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({ decoderLogits: HALF_POSITIVE_LOGITS, scores: [0.9, 0.1] });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    await backend.infer(
      {
        type: "points",
        points: [
          { point: { x: 1, y: 1 }, label: "positive" },
          { point: { x: 6, y: 6 }, label: "negative" },
        ],
        box: { x: 2, y: 2, width: 4, height: 4 },
      },
      context(),
    );
    const feeds = ort.decoderFeeds[0];
    const points = feeds?.input_points;
    expect(points?.dims).toEqual([1, 1, 4, 2]);
    expect(Array.from(points?.data as Float32Array)).toEqual([0.5, 0.5, 3, 3, 1, 1, 2.5, 2.5]);
    expect(Array.from(feeds?.input_labels?.data as BigInt64Array)).toEqual([1n, 0n, 2n, 3n]);
  });

  it("maps decoder failures to INFERENCE_UNAVAILABLE", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({ decoderRunError: new Error("decoder exploded") });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    await expect(
      backend.infer(
        { type: "box", box: { x: 0, y: 0, width: 2, height: 2 }, points: [] },
        context(),
      ),
    ).rejects.toMatchObject({ characterError: { code: Code.InferenceUnavailable } });
  });

  it("reports cache provenance and MODEL_CACHE_UNAVAILABLE through diagnostics", async () => {
    const model = await syntheticModel();
    const coldOrt = fakeOrt();
    const coldBackend = createOnnxSamBackendWithDeps(backendDeps(model, coldOrt));
    await coldBackend.create(model.encoderManifest, "wasm");
    // No Cache API at all: the model still loads, but the session is told.
    const cold = coldBackend.describeModelLoad();
    expect(cold.cachedModel).toBe(false);
    expect(cold.warnings.map((warning) => warning.code)).toContain(
      CharacterWarningCode.ModelCacheUnavailable,
    );

    const cache = fakeCache();
    const warmOrt = fakeOrt();
    const warmBackend = createOnnxSamBackendWithDeps(backendDeps(model, warmOrt, cache));
    await warmBackend.create(model.encoderManifest, "wasm");
    const warmSecond = createOnnxSamBackendWithDeps(backendDeps(model, warmOrt, cache));
    await warmSecond.create(model.encoderManifest, "wasm");
    expect(warmSecond.describeModelLoad().cachedModel).toBe(true);

    const failingPut = fakeCache();
    failingPut.failPut = true;
    const degraded = createOnnxSamBackendWithDeps(backendDeps(model, fakeOrt(), failingPut));
    await degraded.create(model.encoderManifest, "wasm");
    const diagnostics = degraded.describeModelLoad();
    expect(diagnostics.warnings.map((warning) => warning.code)).toContain(
      CharacterWarningCode.ModelCacheUnavailable,
    );
  });

  it("releases both sessions on dispose and stays idempotent", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt();
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.dispose();
    expect(ort.released).toBe(2);
    await backend.dispose();
    expect(ort.released).toBe(2);
  });
});

describe("SamSession over the real backend with a fake ORT (webgpu → wasm)", () => {
  it("falls back once, re-embeds on the WASM session and segments", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({
      failingProviders: ["webgpu"],
      decoderLogits: HALF_POSITIVE_LOGITS,
      scores: [0.9],
    });
    const network = fakeFetch(model.bytes);
    const cache = fakeCache();
    const backend = createOnnxSamBackendWithDeps({
      loadOrtModule: async () => ort.module,
      fetchImpl: network.fetchImpl,
      openCache: async () => cache.cache,
      subtle: globalThis.crypto.subtle,
      useModelCache: true,
      registry: model.registry,
    });
    const session = createSamSession(
      model.encoderManifest,
      {
        provider: "auto",
        wasmThreads: 1,
        useModelCache: true,
      },
      backend,
    );
    const info = value(await session.initialize(context()));
    expect(info.provider).toBe("wasm");
    expect(info.state).toBe("ready");
    expect(info.warnings.map((warning) => warning.code)).toEqual([
      CharacterWarningCode.WebGpuFallbackToWasm,
    ]);
    const embedded = value(await session.setImage(asset(8, 8), context()));
    expect(embedded.state).toBe("image-ready");
    const mask = value(
      await session.segment(
        { type: "box", box: { x: 1, y: 1, width: 4, height: 4 }, points: [] },
        context(),
      ),
    );
    expect(mask.provider).toBe("wasm");
    expect(mask.predictedIou).toBeCloseTo(0.9);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(getMaskBit(mask.mask, x, y)).toBe(x < 4);
      }
    }
    await session.dispose();
    // The artifacts were fetched once (first create) and served from the cache on
    // the WASM rebuild; only successful wasm session creations are recorded, and
    // the final dispose released both live sessions.
    expect(ort.created.map((entry) => entry.providers[0])).toEqual(["wasm", "wasm"]);
    expect(ort.released).toBe(2);
    expect(network.requestedUrls.length).toBe(2);
    expect(cache.puts.length).toBe(2);
  });
});

describe("fake backend sanity (used by session/orchestration tests)", () => {
  it("records create/embed/infer/dispose calls", async () => {
    const { backend, calls } = fakeBackend();
    await backend.create(SAM_MANIFEST, "webgpu");
    await backend.embed(asset(8, 8), SAM_MANIFEST, context());
    await backend.infer(
      { type: "box", box: { x: 0, y: 0, width: 2, height: 2 }, points: [] },
      context(),
    );
    await backend.dispose();
    expect(calls.create).toHaveLength(1);
    expect(calls.embeds).toHaveLength(1);
    expect(calls.infer).toHaveLength(1);
    expect(calls.dispose).toBe(1);
  });
});
