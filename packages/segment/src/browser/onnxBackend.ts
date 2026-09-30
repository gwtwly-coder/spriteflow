// Real SAM inference backend over ONNX Runtime Web (contract section 4, :491-533).
// Browser-only: onnxruntime-web is dynamically imported (lazy) inside the default
// deps factory and nowhere else in the package. Everything is injectable so unit
// tests can run with a fake ORT module, fake fetch and a fake Cache API; the real
// model smoke run belongs to a later dedicated increment.
import { createBitMask, setMaskBit } from "../bitmask.js";
import { characterError } from "../errors.js";
import type { InputAsset, Rect } from "../m1.js";
import type {
  CharacterError,
  CharacterExecutionContext,
  CharacterWarning,
  SamExecutionProvider,
  SamInferenceBackend,
  SamModelManifest,
  SamPrompt,
} from "../types.js";
import {
  CharacterWarningCode,
  CharacterErrorCode as Code,
  CharacterStage as Stage,
} from "../types.js";
import {
  loadVerifiedArtifact,
  manifestMatchesEntry,
  resolveApprovedEntry,
  SAM_MODEL_REGISTRY,
  type SamCacheLike,
  SamModelLoadError,
  type SamRegistryEntry,
} from "./manifest.js";

/** Structural subset of ORT tensors used by this backend. */
export interface OrtTensorLike {
  readonly dims: readonly number[];
  readonly data:
    | Float32Array
    | Float64Array
    | Int8Array
    | Int16Array
    | Int32Array
    | BigInt64Array
    | Uint8Array
    | Uint16Array
    | Uint32Array
    | BigUint64Array;
}

/** Structural subset of ORT InferenceSession used by this backend. */
export interface OrtSessionLike {
  run(feeds: Record<string, OrtTensorLike>): Promise<Record<string, OrtTensorLike>>;
  release?(): Promise<void>;
}

/** Structural subset of the onnxruntime-web module surface used here. */
export interface OrtModuleLike {
  InferenceSession: {
    create(
      model: Uint8Array,
      options?: { executionProviders: readonly string[]; numThreads?: number },
    ): Promise<OrtSessionLike>;
  };
  Tensor: new (type: string, data: OrtTensorLike["data"], dims: readonly number[]) => OrtTensorLike;
}

export interface OnnxSamBackendDeps {
  loadOrtModule: () => Promise<OrtModuleLike>;
  fetchImpl: typeof fetch;
  openCache: () => Promise<SamCacheLike | null>;
  subtle: SubtleCrypto;
  /** Overrides SamRuntimeOptions.useModelCache, which cannot reach create() per contract signatures. */
  useModelCache?: boolean;
  /** Test/ops seam: defaults to the compiled-in approved registry. */
  registry?: readonly SamRegistryEntry[];
}

interface LoadedArtifact {
  bytes: ArrayBuffer;
  cachedModel: boolean;
}

interface PreparedPair {
  encoder: { session: OrtSessionLike; manifest: SamModelManifest };
  decoder: { session: OrtSessionLike; manifest: SamModelManifest };
  cachedModel: boolean;
}

interface EmbeddingState {
  outputs: Record<string, OrtTensorLike>;
  assetWidth: number;
  assetHeight: number;
}

function loadError(code: Code, details: CharacterError["details"]): SamModelLoadError {
  return new SamModelLoadError(characterError(code, Stage.ModelInitialize, { details }));
}

function inferenceError(stage: Stage, details?: CharacterError["details"]): SamModelLoadError {
  return new SamModelLoadError(characterError(Code.InferenceUnavailable, stage, { details }));
}

function cancelledError(stage: Stage): SamModelLoadError {
  return new SamModelLoadError(characterError(Code.Cancelled, stage, {}));
}

function cacheUnavailableWarning(): CharacterWarning {
  return {
    code: CharacterWarningCode.ModelCacheUnavailable,
    messageKey: `character.warning.${CharacterWarningCode.ModelCacheUnavailable}`,
    partIds: [],
  };
}

/** Deterministic nearest-neighbor sample of the source RGBA at working coords. */
function sourceSample(asset: InputAsset, x: number, y: number): readonly [number, number, number] {
  const offset = (y * asset.pixels.width + x) * 4;
  const data = asset.pixels.data;
  return [(data[offset] ?? 0) / 255, (data[offset + 1] ?? 0) / 255, (data[offset + 2] ?? 0) / 255];
}

export class OnnxSamBackend implements SamInferenceBackend {
  private prepared: PreparedPair | null = null;
  private embedding: EmbeddingState | null = null;
  private cacheWasUnavailable = false;
  private tensorFactory: OrtModuleLike["Tensor"] | null = null;
  private readonly registry: readonly SamRegistryEntry[];

  constructor(private readonly deps: OnnxSamBackendDeps) {
    this.registry = deps.registry ?? SAM_MODEL_REGISTRY;
  }

  async create(manifest: SamModelManifest, provider: SamExecutionProvider): Promise<void> {
    if (this.prepared !== null) {
      throw loadError(Code.InvalidState, { modelId: manifest.modelId });
    }
    const entry = resolveApprovedEntry(manifest.modelId, this.registry);
    if (entry === null || !manifestMatchesEntry(manifest, entry)) {
      throw loadError(Code.ModelNotApproved, { modelId: manifest.modelId });
    }
    const sibling = this.registry.find(
      (candidate) => candidate.family === entry.family && candidate.role !== entry.role,
    );
    const approvedSibling =
      sibling === undefined ? null : resolveApprovedEntry(sibling.manifest.modelId, this.registry);
    if (approvedSibling === null) {
      throw loadError(Code.ModelNotApproved, { modelId: manifest.modelId });
    }
    const encoderEntry = entry.role === "encoder" ? entry : approvedSibling;
    const decoderEntry = entry.role === "encoder" ? approvedSibling : entry;
    const useModelCache = this.deps.useModelCache ?? true;
    const loaderDeps = {
      fetchImpl: this.deps.fetchImpl,
      openCache: this.deps.openCache,
      subtle: this.deps.subtle,
      useModelCache,
    };
    const encoderLoad = await this.loadArtifact(encoderEntry.manifest, loaderDeps);
    const decoderLoad = await this.loadArtifact(decoderEntry.manifest, loaderDeps);
    const ort = await this.deps.loadOrtModule();
    try {
      const encoderSession = await this.createSession(ort, encoderLoad.bytes, provider);
      let decoderSession: OrtSessionLike;
      try {
        decoderSession = await this.createSession(ort, decoderLoad.bytes, provider);
      } catch (error: unknown) {
        try {
          await encoderSession.release?.();
        } catch {
          // Release failures must not mask the initialization failure.
        }
        throw error;
      }
      this.prepared = {
        encoder: { session: encoderSession, manifest: encoderEntry.manifest },
        decoder: { session: decoderSession, manifest: decoderEntry.manifest },
        cachedModel: encoderLoad.cachedModel && decoderLoad.cachedModel,
      };
    } catch (error: unknown) {
      if (error instanceof SamModelLoadError) throw error;
      throw loadError(Code.ModelInitializationFailed, { modelId: manifest.modelId });
    }
    this.embedding = null;
  }

  private async loadArtifact(
    manifest: SamModelManifest,
    loaderDeps: {
      fetchImpl: typeof fetch;
      openCache: () => Promise<SamCacheLike | null>;
      subtle: SubtleCrypto;
      useModelCache: boolean;
    },
  ): Promise<LoadedArtifact> {
    const load = await loadVerifiedArtifact(manifest, loaderDeps);
    if (!load.cacheAvailable) this.cacheWasUnavailable = true;
    return { bytes: load.bytes, cachedModel: load.cachedModel };
  }

  private async createSession(
    ort: OrtModuleLike,
    bytes: ArrayBuffer,
    provider: SamExecutionProvider,
  ): Promise<OrtSessionLike> {
    const options: { executionProviders: readonly string[]; numThreads?: number } = {
      executionProviders: [provider],
    };
    // v3.0-alpha pins the WASM thread count to 1 (:522).
    if (provider === "wasm") options.numThreads = 1;
    return ort.InferenceSession.create(new Uint8Array(bytes), options);
  }

  async embed(
    asset: InputAsset,
    manifest: SamModelManifest,
    context: CharacterExecutionContext,
  ): Promise<void> {
    const prepared = this.prepared;
    if (prepared === null) throw inferenceError(Stage.ImageEmbedding);
    if (context.isCancelled()) throw cancelledError(Stage.ImageEmbedding);
    await context.yieldControl();
    const { encoder } = prepared;
    const inputWidth = manifest.inputSize.width;
    const inputHeight = manifest.inputSize.height;
    const data = new Float32Array(3 * inputHeight * inputWidth);
    for (let y = 0; y < inputHeight; y++) {
      const sourceY = Math.min(
        asset.pixels.height - 1,
        Math.floor((y * asset.pixels.height) / inputHeight),
      );
      for (let x = 0; x < inputWidth; x++) {
        const sourceX = Math.min(
          asset.pixels.width - 1,
          Math.floor((x * asset.pixels.width) / inputWidth),
        );
        const [r, g, b] = sourceSample(asset, sourceX, sourceY);
        const plane = inputHeight * inputWidth;
        data[y * inputWidth + x] = r;
        data[plane + y * inputWidth + x] = g;
        data[2 * plane + y * inputWidth + x] = b;
      }
    }
    const makeTensor = await this.resolveTensorFactory();
    const tensor = new makeTensor("float32", data, [1, 3, inputHeight, inputWidth]);
    let outputs: Record<string, OrtTensorLike>;
    try {
      outputs = await encoder.session.run({ [manifest.imageInputName]: tensor });
    } catch {
      throw inferenceError(Stage.ImageEmbedding, { modelId: encoder.manifest.modelId });
    }
    if (context.isCancelled()) throw cancelledError(Stage.ImageEmbedding);
    this.embedding = {
      outputs,
      assetWidth: asset.pixels.width,
      assetHeight: asset.pixels.height,
    };
  }

  private async resolveTensorFactory(): Promise<OrtModuleLike["Tensor"]> {
    if (this.tensorFactory === null) {
      this.tensorFactory = (await this.deps.loadOrtModule()).Tensor;
    }
    return this.tensorFactory;
  }

  async infer(
    prompt: SamPrompt,
    context: CharacterExecutionContext,
  ): Promise<{ mask: ReturnType<typeof createBitMask>; sourceRect: Rect; predictedIou: number }> {
    const prepared = this.prepared;
    const embedding = this.embedding;
    if (prepared === null || embedding === null) throw inferenceError(Stage.PromptInference);
    if (context.isCancelled()) throw cancelledError(Stage.PromptInference);
    await context.yieldControl();
    const { decoder } = prepared;
    const makeTensor = await this.resolveTensorFactory();
    const feeds = await this.buildPromptFeeds(makeTensor, prompt, embedding, decoder.manifest);
    let results: Record<string, OrtTensorLike>;
    try {
      results = await decoder.session.run(feeds);
    } catch {
      throw inferenceError(Stage.PromptInference, { modelId: decoder.manifest.modelId });
    }
    if (context.isCancelled()) throw cancelledError(Stage.PromptInference);
    const masks = results[decoder.manifest.outputNames.masks];
    const scores = results[decoder.manifest.outputNames.scores];
    if (masks === undefined || scores === undefined || !(scores.data instanceof Float32Array)) {
      throw inferenceError(Stage.PromptInference, { modelId: decoder.manifest.modelId });
    }
    let bestIndex = 0;
    for (let index = 1; index < scores.data.length; index++) {
      if ((scores.data[index] ?? 0) > (scores.data[bestIndex] ?? 0)) bestIndex = index;
    }
    const predictedIou = scores.data[bestIndex] ?? 0;
    const mask = this.maskFromLogits(masks, bestIndex, embedding.assetWidth, embedding.assetHeight);
    return {
      mask,
      sourceRect: { x: 0, y: 0, width: embedding.assetWidth, height: embedding.assetHeight },
      predictedIou,
    };
  }

  private async buildPromptFeeds(
    makeTensor: OrtModuleLike["Tensor"],
    prompt: SamPrompt,
    embedding: EmbeddingState,
    decoderManifest: SamModelManifest,
  ): Promise<Record<string, OrtTensorLike>> {
    const scaleX = decoderManifest.inputSize.width / embedding.assetWidth;
    const scaleY = decoderManifest.inputSize.height / embedding.assetHeight;
    const box: Rect | null = prompt.type === "box" ? prompt.box : prompt.box;
    const scaled = (value: number, scale: number) => value * scale;
    const rawPoints = [...prompt.points];
    if (box !== null && rawPoints.length === 0) {
      // SAM convention: a box prompt is the two corners (top-left, bottom-right)
      // when no explicit points accompany it.
      rawPoints.push(
        { point: { x: box.x, y: box.y }, label: "positive" },
        {
          point: { x: box.x + box.width - 1, y: box.y + box.height - 1 },
          label: "positive",
        },
      );
    }
    const count = Math.max(1, rawPoints.length);
    const pointData = new Float32Array(count * 2);
    const labelData = new BigInt64Array(count);
    for (let index = 0; index < rawPoints.length; index++) {
      const entry = rawPoints[index];
      if (entry === undefined) continue;
      pointData[index * 2] = scaled(entry.point.x, scaleX);
      pointData[index * 2 + 1] = scaled(entry.point.y, scaleY);
      labelData[index] = entry.label === "positive" ? 1n : 0n;
    }
    if (rawPoints.length === 0) {
      // No points and no box: feed the origin so the decoder sees a valid tensor.
      pointData[0] = 0;
      pointData[1] = 0;
      labelData[0] = 1n;
    }
    const boxData = new Float32Array(4);
    if (box !== null) {
      boxData[0] = scaled(box.x, scaleX);
      boxData[1] = scaled(box.y, scaleY);
      boxData[2] = scaled(box.x + box.width - 1, scaleX);
      boxData[3] = scaled(box.y + box.height - 1, scaleY);
    }
    const feeds: Record<string, OrtTensorLike> = { ...embedding.outputs };
    feeds[decoderManifest.promptInputNames.points] = new makeTensor("float32", pointData, [
      1,
      count,
      2,
    ]);
    feeds[decoderManifest.promptInputNames.pointLabels] = new makeTensor("int64", labelData, [
      1,
      count,
    ]);
    feeds[decoderManifest.promptInputNames.box] = new makeTensor("float32", boxData, [1, 4]);
    return feeds;
  }

  private maskFromLogits(
    masks: OrtTensorLike,
    bestIndex: number,
    assetWidth: number,
    assetHeight: number,
  ): ReturnType<typeof createBitMask> {
    const dims = masks.dims;
    const gridHeight = dims.length >= 2 ? (dims[dims.length - 2] ?? 1) : 1;
    const gridWidth = dims.length >= 1 ? (dims[dims.length - 1] ?? 1) : 1;
    const planeSize = gridHeight * gridWidth;
    const data = masks.data;
    const planeOffset =
      dims.length === 4 && (dims[1] ?? 1) > 1 && bestIndex > 0 ? bestIndex * planeSize : 0;
    const mask = createBitMask(assetWidth, assetHeight);
    if (!(data instanceof Float32Array)) return mask;
    for (let y = 0; y < assetHeight; y++) {
      const gridY = Math.min(gridHeight - 1, Math.floor((y * gridHeight) / assetHeight));
      for (let x = 0; x < assetWidth; x++) {
        const gridX = Math.min(gridWidth - 1, Math.floor((x * gridWidth) / assetWidth));
        const logit = data[planeOffset + gridY * gridWidth + gridX];
        if (logit !== undefined && logit > 0) setMaskBit(mask, x, y, true);
      }
    }
    return mask;
  }

  async dispose(): Promise<void> {
    const prepared = this.prepared;
    this.prepared = null;
    this.embedding = null;
    if (prepared !== null) {
      try {
        await prepared.encoder.session.release?.();
      } catch {
        // dispose() is idempotent and never rejects (:429).
      }
      try {
        await prepared.decoder.session.release?.();
      } catch {
        // dispose() is idempotent and never rejects (:429).
      }
    }
  }

  /** Optional diagnostics protocol consumed by SamSession (not in the contract). */
  describeModelLoad(): { cachedModel: boolean; warnings: CharacterWarning[] } {
    return {
      cachedModel: this.prepared?.cachedModel ?? false,
      warnings: this.cacheWasUnavailable ? [cacheUnavailableWarning()] : [],
    };
  }
}

/** Test/ops factory with injectable ORT module, fetch and Cache API. */
export function createOnnxSamBackendWithDeps(deps: OnnxSamBackendDeps): OnnxSamBackend {
  return new OnnxSamBackend(deps);
}

/**
 * Contract factory (:529): real browser deps. The ORT module is loaded lazily on
 * the first backend use — onnxruntime-web never appears in the root entry.
 */
export function createOnnxSamBackend(): SamInferenceBackend {
  return new OnnxSamBackend({
    loadOrtModule: async () => (await import("onnxruntime-web")) as unknown as OrtModuleLike,
    fetchImpl: (input, init) => fetch(input, init),
    openCache: async () =>
      typeof caches === "undefined" ? null : caches.open("spriteflow-sam-v1"),
    subtle: crypto.subtle,
  });
}
