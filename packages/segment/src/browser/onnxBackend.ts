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
  type SamArtifactRole,
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

// RC-measured decoder details not expressible in the contract manifest shape
// (2026-09-30, real fp16 artifacts): the mask-refinement memory grid is fixed
// at 256×256; v3.0 never feeds a previous mask so input_masks is always zeros
// with has_mask_input=0. object_score_logits [1,1] is produced but unused.
const SAM_MASK_GRID = 256;
const SAM_DECODER_MASKS_INPUT = "input_masks";
const SAM_DECODER_HAS_MASK_INPUT = "has_mask_input";

// Mask decode pipeline (2026-10-04 fragmentation fix, measured headless on the
// real fp16 decoder over the tall-elf golden character): the decoder emits 4
// mask hypotheses per prompt and its self-reported iou_scores systematically
// favor sub-part fragments (torso → belt-only at cov 0.16). Selection therefore
// ranks candidates by grid-space IoU between their confident p50 masks and the
// prompt box — the geometric agreement we actually care about — with
// argmax(iou_scores) kept as the fallback for point-only prompts. Ranking must
// use p50, not the looser mask threshold: at p35 every hypothesis dilates past
// the box, the ranking collapses toward ties and the self-score tie-break
// re-selects the fragment (measured torso regression 59.5k→45.5k px). The
// winning plane is then thresholded at p≈0.35 (logit −0.62, picked by sweep:
// recall gains level off below), hole-filled, closed with a 3×3 structuring
// element (out-of-bounds counts as foreground so border-touching parts like
// hair are not eroded), reduced to its largest 4-connected component, then
// upsampled and clipped to the prompt box so a part mask can never bleed
// across neighboring part boxes. Evidence: apps/web/evidence/sam-quality/.
const SAM_MASK_LOGIT_THRESHOLD = -0.62;
const SAM_SELECT_LOGIT_THRESHOLD = 0;
const SAM_SELECT_TIE_EPSILON = 1e-9;

interface GridRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Maps an asset-space prompt box onto the decoder logits grid (inclusive). */
function gridRectForBox(
  box: Rect,
  gridWidth: number,
  gridHeight: number,
  assetWidth: number,
  assetHeight: number,
): GridRect {
  const clamp = (value: number, max: number) => Math.min(max - 1, Math.max(0, value));
  return {
    x0: clamp(Math.floor((box.x * gridWidth) / assetWidth), gridWidth),
    y0: clamp(Math.floor((box.y * gridHeight) / assetHeight), gridHeight),
    x1: clamp(Math.ceil(((box.x + box.width) * gridWidth) / assetWidth) - 1, gridWidth),
    y1: clamp(Math.ceil(((box.y + box.height) * gridHeight) / assetHeight) - 1, gridHeight),
  };
}

/** Grid-space IoU between one thresholded candidate plane and the prompt box. */
function candidateBoxIoU(cells: Uint8Array, rect: GridRect, gridWidth: number): number {
  let inter = 0;
  let area = 0;
  for (let y = 0; y < cells.length / gridWidth; y++) {
    const row = y * gridWidth;
    for (let x = 0; x < gridWidth; x++) {
      if (cells[row + x] === 0) continue;
      area += 1;
      if (x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1) inter += 1;
    }
  }
  const boxArea = Math.max(1, (rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1));
  const union = area + boxArea - inter;
  return union > 0 ? inter / union : 0;
}

/** Thresholds one candidate plane onto a 0/1 grid. */
function thresholdPlane(
  data: Float32Array,
  candidate: number,
  planeSize: number,
  threshold: number,
): Uint8Array {
  const cells = new Uint8Array(planeSize);
  const offset = candidate * planeSize;
  for (let cell = 0; cell < planeSize; cell++) {
    cells[cell] = (data[offset + cell] ?? 0) > threshold ? 1 : 0;
  }
  return cells;
}

/** Dilates by a 3×3 square structuring element. */
function dilateGrid(cells: Uint8Array, gridWidth: number, gridHeight: number): Uint8Array {
  const out = new Uint8Array(cells.length);
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      if (cells[y * gridWidth + x] === 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= gridHeight) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < gridWidth) out[ny * gridWidth + nx] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * Erodes by a 3×3 square structuring element with out-of-bounds treated as
 * foreground: closing must bridge interior gaps without trimming masks that
 * legitimately touch the grid border (top-of-image hair).
 */
function erodeGrid(cells: Uint8Array, gridWidth: number, gridHeight: number): Uint8Array {
  const out = new Uint8Array(cells.length);
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      let keep = 1;
      for (let dy = -1; dy <= 1 && keep === 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= gridHeight || nx < 0 || nx >= gridWidth) continue;
          if (cells[ny * gridWidth + nx] === 0) {
            keep = 0;
            break;
          }
        }
      }
      out[y * gridWidth + x] = keep;
    }
  }
  return out;
}

/** Fills enclosed zero regions (holes) by flooding background from the border. */
function fillGridHoles(cells: Uint8Array, gridWidth: number, gridHeight: number): void {
  const seen = new Uint8Array(cells.length);
  const queue: number[] = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return;
    const index = y * gridWidth + x;
    if (seen[index] === 1 || cells[index] === 1) return;
    seen[index] = 1;
    queue.push(index);
  };
  for (let x = 0; x < gridWidth; x++) {
    visit(x, 0);
    visit(x, gridHeight - 1);
  }
  for (let y = 0; y < gridHeight; y++) {
    visit(0, y);
    visit(gridWidth - 1, y);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor] ?? 0;
    const x = index % gridWidth;
    const y = Math.floor(index / gridWidth);
    visit(x - 1, y);
    visit(x + 1, y);
    visit(x, y - 1);
    visit(x, y + 1);
  }
  for (let index = 0; index < cells.length; index++) {
    if (cells[index] === 0 && seen[index] === 0) cells[index] = 1;
  }
}

/** Zeroes every cell outside the largest 4-connected component (in place copy). */
function keepLargestComponent(
  cells: Uint8Array,
  gridWidth: number,
  gridHeight: number,
): Uint8Array {
  const labels = new Int32Array(cells.length).fill(-1);
  let bestSize = 0;
  let bestLabel = -1;
  let nextLabel = 0;
  const stack: number[] = [];
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] === 0 || labels[start] !== -1) continue;
    let size = 0;
    const label = nextLabel;
    nextLabel += 1;
    labels[start] = label;
    stack.push(start);
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      size += 1;
      const x = index % gridWidth;
      const y = Math.floor(index / gridWidth);
      if (x > 0 && cells[index - 1] === 1 && labels[index - 1] === -1) {
        labels[index - 1] = label;
        stack.push(index - 1);
      }
      if (x < gridWidth - 1 && cells[index + 1] === 1 && labels[index + 1] === -1) {
        labels[index + 1] = label;
        stack.push(index + 1);
      }
      if (y > 0 && cells[index - gridWidth] === 1 && labels[index - gridWidth] === -1) {
        labels[index - gridWidth] = label;
        stack.push(index - gridWidth);
      }
      if (
        y < gridHeight - 1 &&
        cells[index + gridWidth] === 1 &&
        labels[index + gridWidth] === -1
      ) {
        labels[index + gridWidth] = label;
        stack.push(index + gridWidth);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = label;
    }
  }
  if (bestLabel === -1) return cells;
  const out = new Uint8Array(cells.length);
  for (let index = 0; index < cells.length; index++) {
    out[index] = labels[index] === bestLabel ? 1 : 0;
  }
  return out;
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

/**
 * Byte-level download progress for one artifact, enriched with the registry
 * identity so a consumer can accumulate encoder+decoder into a single bar.
 * Non-contract protocol payload (stays inside the browser subentry).
 */
export interface SamModelDownloadProgress {
  modelId: string;
  role: SamArtifactRole;
  loadedBytes: number;
  totalBytes: number;
}

/** Consumer-side sink for {@link SamModelDownloadProgress} events. */
export type SamModelDownloadSink = (progress: SamModelDownloadProgress) => void;

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
  private downloadSink: SamModelDownloadSink | null = null;
  private readonly registry: readonly SamRegistryEntry[];

  constructor(private readonly deps: OnnxSamBackendDeps) {
    this.registry = deps.registry ?? SAM_MODEL_REGISTRY;
  }

  /**
   * Optional non-contract protocol (same shape as describeModelLoad): subscribes
   * a byte-level download sink so a hosting Worker can forward real download
   * progress across the thread boundary. Pass null to unsubscribe.
   */
  setDownloadProgressSink(sink: SamModelDownloadSink | null): void {
    this.downloadSink = sink;
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
    const role: SamArtifactRole =
      this.registry.find((entry) => entry.manifest.modelId === manifest.modelId)?.role ?? "encoder";
    const sink = this.downloadSink;
    const load = await loadVerifiedArtifact(manifest, loaderDeps, (progress) => {
      sink?.({ modelId: manifest.modelId, role, ...progress });
    });
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
    // A points prompt may carry an optional accompanying box; both prompt
    // discriminants expose `.box` and clipping needs the raw rect (or null).
    const promptBox: Rect | null = prompt.type === "box" ? prompt.box : prompt.box;
    const decoded = this.decodeMask(
      masks,
      scores.data,
      promptBox,
      embedding.assetWidth,
      embedding.assetHeight,
    );
    return {
      mask: decoded.mask,
      sourceRect: { x: 0, y: 0, width: embedding.assetWidth, height: embedding.assetHeight },
      predictedIou: decoded.predictedIou,
    };
  }

  /**
   * Candidate selection + post-processing (see SAM_MASK_LOGIT_THRESHOLD block
   * comment): rank the decoder's 4 hypotheses by prompt-box IoU when a box is
   * available (argmax(iou_scores) otherwise), then threshold/fill/close/keep
   * the winning plane on the logits grid and upsample with an exact asset-space
   * clip to the prompt box.
   */
  private decodeMask(
    masks: OrtTensorLike,
    scores: Float32Array,
    promptBox: Rect | null,
    assetWidth: number,
    assetHeight: number,
  ): { mask: ReturnType<typeof createBitMask>; predictedIou: number } {
    const dims = masks.dims;
    const gridHeight = dims.length >= 2 ? (dims[dims.length - 2] ?? 1) : 1;
    const gridWidth = dims.length >= 1 ? (dims[dims.length - 1] ?? 1) : 1;
    const planeSize = gridHeight * gridWidth;
    const candidateCount =
      dims.length === 4 && Number.isInteger(dims[1]) && (dims[1] ?? 1) > 1
        ? (dims[1] as number)
        : 1;
    const mask = createBitMask(assetWidth, assetHeight);
    if (!(masks.data instanceof Float32Array)) {
      return { mask, predictedIou: 0 };
    }
    const logits = masks.data;

    let selected = 0;
    let bestScore = scores[0] ?? 0;
    for (let index = 1; index < candidateCount && index < scores.length; index++) {
      if ((scores[index] ?? 0) > bestScore) {
        bestScore = scores[index] ?? 0;
        selected = index;
      }
    }
    if (promptBox !== null && candidateCount > 1) {
      const rect = gridRectForBox(promptBox, gridWidth, gridHeight, assetWidth, assetHeight);
      let bestIoU = -1;
      for (let index = 0; index < candidateCount; index++) {
        const iou = candidateBoxIoU(
          thresholdPlane(logits, index, planeSize, SAM_SELECT_LOGIT_THRESHOLD),
          rect,
          gridWidth,
        );
        // Strictly better wins; an exact tie prefers the higher self-score
        // (stable and deterministic across the 4-hypothesis decoder output).
        const better =
          iou > bestIoU + SAM_SELECT_TIE_EPSILON ||
          (Math.abs(iou - bestIoU) <= SAM_SELECT_TIE_EPSILON &&
            (scores[index] ?? 0) > (scores[selected] ?? 0));
        if (better) {
          bestIoU = iou;
          selected = index;
        }
      }
    }

    let cells = thresholdPlane(logits, selected, planeSize, SAM_MASK_LOGIT_THRESHOLD);
    fillGridHoles(cells, gridWidth, gridHeight);
    cells = erodeGrid(dilateGrid(cells, gridWidth, gridHeight), gridWidth, gridHeight);
    cells = keepLargestComponent(cells, gridWidth, gridHeight);

    for (let y = 0; y < assetHeight; y++) {
      if (promptBox !== null && (y < promptBox.y || y >= promptBox.y + promptBox.height)) continue;
      const gridY = Math.min(gridHeight - 1, Math.floor((y * gridHeight) / assetHeight));
      for (let x = 0; x < assetWidth; x++) {
        if (promptBox !== null && (x < promptBox.x || x >= promptBox.x + promptBox.width)) {
          continue;
        }
        const gridX = Math.min(gridWidth - 1, Math.floor((x * gridWidth) / assetWidth));
        if (cells[gridY * gridWidth + gridX] === 1) setMaskBit(mask, x, y, true);
      }
    }
    return { mask, predictedIou: scores[selected] ?? 0 };
  }

  private async buildPromptFeeds(
    makeTensor: OrtModuleLike["Tensor"],
    prompt: SamPrompt,
    embedding: EmbeddingState,
    decoderManifest: SamModelManifest,
  ): Promise<Record<string, OrtTensorLike>> {
    // RC-measured decoder graph (2026-09-30, real fp16 artifacts): the prompt
    // travels entirely through input_points/input_labels — there is no
    // dedicated box input. A box is encoded as its two corners with SAM labels
    // 2 (top-left) and 3 (bottom-right). Coordinates are 1024-grid absolute
    // floats; labels are int64.
    const scaleX = decoderManifest.inputSize.width / embedding.assetWidth;
    const scaleY = decoderManifest.inputSize.height / embedding.assetHeight;
    // Both branches narrow the SamPrompt discriminant so `.box` is accessible on
    // every member; a points prompt may carry an optional accompanying box.
    const box: Rect | null = prompt.type === "box" ? prompt.box : prompt.box;
    const scaled = (value: number, scale: number) => value * scale;
    type PromptPoint = {
      point: { x: number; y: number };
      label: "positive" | "negative" | "boxTopLeft" | "boxBottomRight";
    };
    const rawPoints: PromptPoint[] = [...prompt.points];
    if (box !== null) {
      // Inclusive corners of the half-open rect: pixel indices run x..x+width-1,
      // so the bottom-right corner is conservative at x+width-1 (never exceeds
      // the box's true extent; the measured corner-point runs reached coverage
      // 1.000 on the synthetic square).
      rawPoints.push(
        { point: { x: box.x, y: box.y }, label: "boxTopLeft" },
        { point: { x: box.x + box.width - 1, y: box.y + box.height - 1 }, label: "boxBottomRight" },
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
      labelData[index] =
        entry.label === "positive"
          ? 1n
          : entry.label === "boxTopLeft"
            ? 2n
            : entry.label === "boxBottomRight"
              ? 3n
              : 0n;
    }
    if (rawPoints.length === 0) {
      // No points and no box: feed the origin so the decoder sees a valid tensor.
      pointData[0] = 0;
      pointData[1] = 0;
      labelData[0] = 1n;
    }
    const feeds: Record<string, OrtTensorLike> = { ...embedding.outputs };
    feeds[decoderManifest.promptInputNames.points] = new makeTensor("float32", pointData, [
      1,
      1,
      count,
      2,
    ]);
    feeds[decoderManifest.promptInputNames.pointLabels] = new makeTensor("int64", labelData, [
      1,
      1,
      count,
    ]);
    // Mask-refinement memory: v3.0 never feeds a previous mask, so every run
    // sends zeros together with has_mask_input=0 (measured first-run semantic).
    feeds[SAM_DECODER_MASKS_INPUT] = new makeTensor(
      "float32",
      new Float32Array(SAM_MASK_GRID * SAM_MASK_GRID),
      [1, 1, SAM_MASK_GRID, SAM_MASK_GRID],
    );
    feeds[SAM_DECODER_HAS_MASK_INPUT] = new makeTensor("float32", new Float32Array([0]), [1]);
    return feeds;
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
