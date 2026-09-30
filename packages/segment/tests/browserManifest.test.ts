// Manifest admission and verified-loading tests (contract section 4, :427-432):
// allowlist access, frozen-hash gate, license gate, byte-count check, SHA-256
// verification, Cache API hit/miss behavior and the per-id URL override seam.
import { describe, expect, it } from "vitest";
import {
  clearSamModelArtifactUrlOverrides,
  getApprovedSamManifest,
  loadVerifiedArtifact,
  manifestMatchesEntry,
  resolveApprovedEntry,
  SAM_MODEL_REGISTRY,
  SamModelLoadError,
  type SamRegistryEntry,
  setSamModelArtifactUrlOverride,
} from "../src/browser/manifest.js";
import { CharacterErrorCode as Code } from "../src/types.js";
import { fakeCache, fakeFetch, syntheticManifest, syntheticModel } from "./samHelpers.js";

// Contract r4 ruling: fp16 single-tier serving. The fp32 artifacts are not in
// the registry (their records live in docs/research/2026-09-30-sam2-onnx-model-sources.md).
const RC_FROZEN_SHA256 = {
  "sam2.1-hiera-tiny-encoder-fp16":
    "f4ca896cf99816ad0cb7062e9ebef44a211e6f0d0a0656a7eb13349204cb6caa",
  "sam2.1-hiera-tiny-decoder-fp16":
    "f362ed5bbcfbece283ce970a2162486da9f018645a382b927755677b9d267e6d",
} as const;

const RC_FROZEN_BYTES = {
  "sam2.1-hiera-tiny-encoder-fp16": 67_313_499,
  "sam2.1-hiera-tiny-decoder-fp16": 8_755_200,
} as const;

function cacheKeyFor(manifest: { modelId: string; revision: string; sha256: string }): string {
  return `https://spriteflow-cache.spriteflow.invalid/sam/${manifest.modelId}/${manifest.revision}/${manifest.sha256.toLowerCase()}`;
}

function bytesOf(model: Awaited<ReturnType<typeof syntheticModel>>, url: string): Uint8Array {
  const payload = model.bytes.get(url);
  if (payload === undefined) throw new Error(`no fixture bytes for ${url}`);
  return payload;
}

function loaderDeps(
  fetchImpl: typeof fetch,
  cache: ReturnType<typeof fakeCache> | null,
  useModelCache = true,
) {
  return {
    fetchImpl,
    openCache: async () => (cache === null ? null : cache.cache),
    subtle: globalThis.crypto.subtle,
    useModelCache,
  };
}

describe("getApprovedSamManifest", () => {
  it("exposes exactly the two RC-frozen fp16 artifacts", () => {
    for (const modelId of Object.keys(RC_FROZEN_SHA256)) {
      const manifest = getApprovedSamManifest(modelId);
      expect(manifest, modelId).not.toBeNull();
      expect(manifest?.sha256).toBe(RC_FROZEN_SHA256[modelId as keyof typeof RC_FROZEN_SHA256]);
      expect(manifest?.byteLength).toBe(RC_FROZEN_BYTES[modelId as keyof typeof RC_FROZEN_BYTES]);
      expect(manifest?.licenseId).toBe("apache-2.0");
      expect(manifest?.revision).toBe("v0");
      expect(manifest?.inputSize).toEqual({ width: 1024, height: 1024 });
      expect(manifest?.artifactUrl.startsWith("https://")).toBe(true);
    }
  });

  it("serves a single fp16 family that covers both roles (r4 fp16-only ruling)", () => {
    expect(SAM_MODEL_REGISTRY).toHaveLength(2);
    const families = new Set(SAM_MODEL_REGISTRY.map((entry) => entry.family));
    expect([...families]).toEqual(["sam2.1-hiera-tiny-fp16"]);
    expect(SAM_MODEL_REGISTRY.map((entry) => entry.role).sort()).toEqual(["decoder", "encoder"]);
    expect(SAM_MODEL_REGISTRY.every((entry) => entry.frozen)).toBe(true);
    // The WASM fallback reuses the fp16 artifacts: both providers resolve the
    // same two ids, and the fp32 tier is intentionally absent.
    expect(getApprovedSamManifest("sam2.1-hiera-tiny-encoder-fp32")).toBeNull();
    expect(getApprovedSamManifest("sam2.1-hiera-tiny-decoder-fp32")).toBeNull();
    expect(getApprovedSamManifest("sam2.1-hiera-tiny-encoder-fp16")).not.toBeNull();
    expect(getApprovedSamManifest("sam2.1-hiera-tiny-decoder-fp16")).not.toBeNull();
  });

  it("carries the RC-measured tensor names (2026-09-30, real fp16 artifacts)", () => {
    const encoder = getApprovedSamManifest("sam2.1-hiera-tiny-encoder-fp16");
    expect(encoder?.imageInputName).toBe("pixel_values");
    const decoder = getApprovedSamManifest("sam2.1-hiera-tiny-decoder-fp16");
    expect(decoder?.promptInputNames).toEqual({
      box: "input_points", // no dedicated box input: corners ride input_points
      points: "input_points",
      pointLabels: "input_labels",
    });
    expect(decoder?.outputNames).toEqual({ masks: "pred_masks", scores: "iou_scores" });
  });

  it("returns null for unknown model ids", () => {
    expect(getApprovedSamManifest("no-such-model")).toBeNull();
    expect(getApprovedSamManifest("")).toBeNull();
  });

  it("returns frozen defensive copies", () => {
    const manifest = getApprovedSamManifest("sam2.1-hiera-tiny-encoder-fp16");
    expect(manifest).not.toBeNull();
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest?.inputSize)).toBe(true);
    expect(Object.isFrozen(manifest?.promptInputNames)).toBe(true);
    expect(Object.isFrozen(manifest?.outputNames)).toBe(true);
    // A second call must yield an equal but independent copy.
    const again = getApprovedSamManifest("sam2.1-hiera-tiny-encoder-fp16");
    expect(again).toEqual(manifest);
    expect(again).not.toBe(manifest);
  });
});

describe("resolveApprovedEntry admission gate", () => {
  it("rejects unknown ids, unknown licenses and unfrozen entries", async () => {
    const model = await syntheticModel();
    expect(resolveApprovedEntry("test-encoder-fp16", model.registry)).not.toBeNull();
    expect(resolveApprovedEntry("unknown-id", model.registry)).toBeNull();
    const unlicensed: SamRegistryEntry[] = [
      { ...model.encoderEntry, manifest: { ...model.encoderManifest, licenseId: "gpl-3.0" } },
    ];
    expect(resolveApprovedEntry("test-encoder-fp16", unlicensed)).toBeNull();
    const unfrozen: SamRegistryEntry[] = [{ ...model.encoderEntry, frozen: false }];
    expect(resolveApprovedEntry("test-encoder-fp16", unfrozen)).toBeNull();
  });
});

describe("loadVerifiedArtifact", () => {
  it("serves a verified Cache API hit without touching the network", async () => {
    const model = await syntheticModel();
    const cache = fakeCache(
      new Map([
        [cacheKeyFor(model.encoderManifest), bytesOf(model, model.encoderManifest.artifactUrl)],
      ]),
    );
    const network = fakeFetch(model.bytes);
    const load = await loadVerifiedArtifact(
      model.encoderManifest,
      loaderDeps(network.fetchImpl, cache),
    );
    expect(load.cachedModel).toBe(true);
    expect(load.cacheAvailable).toBe(true);
    expect(network.requestedUrls).toHaveLength(0);
    expect(cache.hits).toHaveLength(1);
  });

  it("falls back to the network on cache miss and stores the verified response", async () => {
    const model = await syntheticModel();
    const cache = fakeCache();
    const network = fakeFetch(model.bytes);
    const load = await loadVerifiedArtifact(
      model.encoderManifest,
      loaderDeps(network.fetchImpl, cache),
    );
    expect(load.cachedModel).toBe(false);
    expect(network.requestedUrls).toEqual([model.encoderManifest.artifactUrl]);
    expect(cache.puts).toEqual([cacheKeyFor(model.encoderManifest)]);
  });

  it("discards corrupted cache bytes and re-fetches from the network", async () => {
    const model = await syntheticModel();
    const poisoned = new TextEncoder().encode("poisoned-cache-payload");
    const cache = fakeCache(new Map([[cacheKeyFor(model.encoderManifest), poisoned]]));
    const network = fakeFetch(model.bytes);
    const load = await loadVerifiedArtifact(
      model.encoderManifest,
      loaderDeps(network.fetchImpl, cache),
    );
    expect(network.requestedUrls).toEqual([model.encoderManifest.artifactUrl]);
    expect(load.cachedModel).toBe(false);
    expect(new Uint8Array(load.bytes)).toEqual(bytesOf(model, model.encoderManifest.artifactUrl));
  });

  it("rejects a byte-count mismatch with MODEL_DOWNLOAD_FAILED", async () => {
    const model = await syntheticModel();
    const truncated = bytesOf(model, model.encoderManifest.artifactUrl).slice(0, 4);
    const network = fakeFetch(new Map([[model.encoderManifest.artifactUrl, truncated]]));
    const load = loadVerifiedArtifact(model.encoderManifest, loaderDeps(network.fetchImpl, null));
    await expect(load).rejects.toBeInstanceOf(SamModelLoadError);
    const error = (await load.catch((e: SamModelLoadError) => e)) as SamModelLoadError;
    expect(error.characterError.code).toBe(Code.ModelDownloadFailed);
    expect(error.characterError.details.limit).toBe(model.encoderManifest.byteLength);
    expect(error.characterError.details.actual).toBe(truncated.byteLength);
  });

  it("rejects a hash mismatch with MODEL_HASH_MISMATCH and never caches it", async () => {
    const model = await syntheticModel();
    const wrong = new TextEncoder().encode("spriteflow-fake-encoder-weights-02");
    const cache = fakeCache();
    const network = fakeFetch(new Map([[model.encoderManifest.artifactUrl, wrong]]));
    const load = loadVerifiedArtifact(model.encoderManifest, loaderDeps(network.fetchImpl, cache));
    await expect(load).rejects.toBeInstanceOf(SamModelLoadError);
    const error = (await load.catch((e: SamModelLoadError) => e)) as SamModelLoadError;
    expect(error.characterError.code).toBe(Code.ModelHashMismatch);
    expect(cache.puts).toHaveLength(0);
  });

  it("maps HTTP failures to MODEL_DOWNLOAD_FAILED", async () => {
    const model = await syntheticModel();
    const network = fakeFetch(new Map());
    const load = loadVerifiedArtifact(model.encoderManifest, loaderDeps(network.fetchImpl, null));
    const error = (await load.catch((e: SamModelLoadError) => e)) as SamModelLoadError;
    expect(error.characterError.code).toBe(Code.ModelDownloadFailed);
    expect(error.characterError.details.actual).toBe(404);
  });

  it("continues without the cache when it is unavailable or fails to store", async () => {
    const model = await syntheticModel();
    const network = fakeFetch(model.bytes);
    const unavailable = await loadVerifiedArtifact(model.encoderManifest, {
      ...loaderDeps(network.fetchImpl, null),
      useModelCache: true,
      openCache: async () => null,
    });
    expect(unavailable.cacheAvailable).toBe(false);
    expect(unavailable.cachedModel).toBe(false);
    expect(network.requestedUrls).toEqual([model.encoderManifest.artifactUrl]);

    const failingPut = fakeCache();
    failingPut.failPut = true;
    const secondNetwork = fakeFetch(model.bytes);
    const degraded = await loadVerifiedArtifact(
      model.encoderManifest,
      loaderDeps(secondNetwork.fetchImpl, failingPut),
    );
    expect(degraded.cacheAvailable).toBe(false);
    expect(new Uint8Array(degraded.bytes)).toEqual(
      bytesOf(model, model.encoderManifest.artifactUrl),
    );
  });

  it("skips the Cache API entirely when useModelCache is false", async () => {
    const model = await syntheticModel();
    const cache = fakeCache(
      new Map([
        [cacheKeyFor(model.encoderManifest), bytesOf(model, model.encoderManifest.artifactUrl)],
      ]),
    );
    const network = fakeFetch(model.bytes);
    const load = await loadVerifiedArtifact(
      model.encoderManifest,
      loaderDeps(network.fetchImpl, cache, false),
    );
    expect(cache.hits).toHaveLength(0);
    expect(cache.puts).toHaveLength(0);
    expect(load.cachedModel).toBe(false);
    expect(network.requestedUrls).toEqual([model.encoderManifest.artifactUrl]);
  });
});

describe("manifest identity gate", () => {
  it("rejects any drift between the presented manifest and the audited entry", async () => {
    const model = await syntheticModel();
    expect(manifestMatchesEntry(model.encoderManifest, model.encoderEntry)).toBe(true);
    const tamperations: Array<Partial<typeof model.encoderManifest>> = [
      { sha256: "0".repeat(64) },
      { byteLength: model.encoderManifest.byteLength + 1 },
      { artifactUrl: "https://evil.example.com/encoder.onnx" },
      { licenseId: "proprietary" },
      { revision: "other" },
    ];
    for (const tamper of tamperations) {
      expect(
        manifestMatchesEntry({ ...model.encoderManifest, ...tamper }, model.encoderEntry),
        JSON.stringify(tamper),
      ).toBe(false);
    }
  });
});

describe("artifact URL override seam", () => {
  it("applies a validated per-id override to the real registry and rejects malformed URLs", async () => {
    const modelId = "sam2.1-hiera-tiny-encoder-fp16";
    const original = getApprovedSamManifest(modelId);
    expect(original).not.toBeNull();
    try {
      expect(setSamModelArtifactUrlOverride(modelId, "http://r2.example.com/e.onnx")).toBe(false);
      expect(setSamModelArtifactUrlOverride(modelId, "https://user@r2.example.com/e.onnx")).toBe(
        false,
      );
      expect(setSamModelArtifactUrlOverride(modelId, "https://r2.example.com/e.onnx#frag")).toBe(
        false,
      );
      expect(getApprovedSamManifest(modelId)?.artifactUrl).toBe(original?.artifactUrl);
      expect(
        setSamModelArtifactUrlOverride(modelId, "https://r2.example.com/sam/encoder.onnx"),
      ).toBe(true);
      const overridden = getApprovedSamManifest(modelId);
      expect(overridden?.artifactUrl).toBe("https://r2.example.com/sam/encoder.onnx");
      expect(overridden?.sha256).toBe(original?.sha256);
      expect(overridden?.byteLength).toBe(original?.byteLength);
    } finally {
      clearSamModelArtifactUrlOverrides();
    }
    expect(getApprovedSamManifest(modelId)?.artifactUrl).toBe(original?.artifactUrl);
  });

  it("keeps the synthetic helper manifests shape-valid for the identity gate", async () => {
    const model = await syntheticModel();
    expect(manifestMatchesEntry(model.decoderManifest, model.decoderEntry)).toBe(true);
    expect(
      syntheticManifest("x", "f.onnx", 1, "a".repeat(64)).artifactUrl.startsWith("https://"),
    ).toBe(true);
  });
});
