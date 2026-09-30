// SamSession orchestration (docs/interface-contract-v3.md section 4, :425-533).
// Root-entry-pure: the ORT backend is injected behind SamInferenceBackend, so this
// module stays ES2022/TypedArray only and is Node-testable with fake backends.
// Responsibilities: provider selection with a single WebGPU→WASM retry, one
// inference task at a time (BUSY), embed-once per asset revision, prompt
// validation/dedup, and INVALID_STATE after dispose.
import { validateBitMask } from "./bitmask.js";
import { type CharacterErrorOptions, characterError, failure } from "./errors.js";
import type { InputAsset, Rect } from "./m1.js";
import type {
  CharacterError,
  CharacterExecutionContext,
  CharacterOutcome,
  CharacterWarning,
  SamExecutionProvider,
  SamInferenceBackend,
  SamMaskResult,
  SamModelManifest,
  SamPoint,
  SamPrompt,
  SamRuntimeOptions,
  SamSession,
  SamSessionInfo,
} from "./types.js";
import { CharacterErrorCode, CharacterStage, CharacterWarningCode } from "./types.js";

const MAX_NEGATIVE_POINTS = 16;
const WARNING_FALLBACK_MESSAGE_KEY = "character.warning.WEBGPU_FALLBACK_TO_WASM";

let nextSessionSequence = 0;

function generateSessionId(): string {
  nextSessionSequence += 1;
  const sequence = nextSessionSequence.toString(36).padStart(3, "0");
  const random = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `sam_${sequence}_${random}`;
}

function sessionError(
  code: CharacterErrorCode,
  stage: CharacterStage,
  options: CharacterErrorOptions = {},
): CharacterError {
  return characterError(code, stage, options);
}

/** Structural guard: did the injected backend reject with a contract CharacterError? */
function asCharacterError(error: unknown): CharacterError | null {
  if (typeof error !== "object" || error === null) return null;
  const direct = error as { code?: unknown; stage?: unknown; messageKey?: unknown };
  const isShape = (value: unknown): value is CharacterError =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as CharacterError).code === "string" &&
    typeof (value as CharacterError).stage === "string" &&
    typeof (value as CharacterError).messageKey === "string";
  if (typeof direct.code === "string" && typeof direct.stage === "string") {
    if (isShape(error)) return error;
  }
  // Browser-layer failures wrap a CharacterError (e.g. SamModelLoadError).
  const wrapped = (error as { characterError?: unknown }).characterError;
  if (isShape(wrapped)) return wrapped;
  return null;
}

function fallbackWarning(): CharacterWarning {
  return {
    code: CharacterWarningCode.WebGpuFallbackToWasm,
    messageKey: WARNING_FALLBACK_MESSAGE_KEY,
    partIds: [],
  };
}

/** Optional non-contract protocol: a backend may report cache provenance/warnings. */
export interface SamBackendDiagnostics {
  describeModelLoad?(): { cachedModel: boolean; warnings: CharacterWarning[] };
}

function backendDiagnostics(backend: SamInferenceBackend): SamBackendDiagnostics {
  return backend as SamInferenceBackend & SamBackendDiagnostics;
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

interface SessionInternalState {
  backend: SamInferenceBackend;
  manifest: SamModelManifest;
  options: SamRuntimeOptions;
  sessionId: string;
  state: "new" | "ready" | "image-ready" | "disposed";
  provider: SamExecutionProvider | null;
  replayedToWasm: boolean;
  cachedModel: boolean;
  extraWarnings: CharacterWarning[];
  asset: InputAsset | null;
  busy: boolean;
}

export function validateManifestShape(manifest: SamModelManifest): CharacterError | null {
  const bad = (field: string) =>
    sessionError(CharacterErrorCode.InvalidArgument, CharacterStage.ModelInitialize, {
      details: { field },
    });
  if (typeof manifest !== "object" || manifest === null) return bad("manifest");
  if (typeof manifest.modelId !== "string" || manifest.modelId.length === 0) return bad("modelId");
  if (typeof manifest.revision !== "string" || manifest.revision.length === 0) {
    return bad("revision");
  }
  if (typeof manifest.sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(manifest.sha256)) {
    return bad("sha256");
  }
  if (!Number.isInteger(manifest.byteLength) || manifest.byteLength < 1) return bad("byteLength");
  if (
    typeof manifest.inputSize !== "object" ||
    manifest.inputSize === null ||
    !Number.isInteger(manifest.inputSize.width) ||
    !Number.isInteger(manifest.inputSize.height) ||
    manifest.inputSize.width < 1 ||
    manifest.inputSize.height < 1
  ) {
    return bad("inputSize");
  }
  if (!Number.isInteger(manifest.maxSourceDimension) || manifest.maxSourceDimension < 1) {
    return bad("maxSourceDimension");
  }
  for (const name of [
    manifest.imageInputName,
    manifest.promptInputNames?.box,
    manifest.promptInputNames?.points,
    manifest.promptInputNames?.pointLabels,
    manifest.outputNames?.masks,
    manifest.outputNames?.scores,
    manifest.licenseId,
  ]) {
    if (typeof name !== "string" || name.length === 0) return bad("manifest.names");
  }
  return null;
}

export function validateRuntimeOptions(options: SamRuntimeOptions): CharacterError | null {
  const bad = (field: string, actual: unknown) =>
    sessionError(CharacterErrorCode.InvalidArgument, CharacterStage.ModelInitialize, {
      details: { field, ...(typeof actual === "number" ? { actual } : {}) },
    });
  if (typeof options !== "object" || options === null) return bad("runtime", 0);
  if (options.provider !== "auto" && options.provider !== "webgpu" && options.provider !== "wasm") {
    return bad("runtime.provider", 0);
  }
  // v3.0-alpha pins the WASM thread count to 1 (:522).
  if (options.wasmThreads !== 1) return bad("runtime.wasmThreads", options.wasmThreads);
  if (typeof options.useModelCache !== "boolean") return bad("runtime.useModelCache", 0);
  return null;
}

export function validateAssetShape(asset: InputAsset): CharacterError | null {
  const bad = (field: string) =>
    sessionError(CharacterErrorCode.InvalidArgument, CharacterStage.ImageEmbedding, {
      details: { field },
    });
  if (typeof asset !== "object" || asset === null) return bad("asset");
  const ref = asset.ref;
  if (
    typeof ref !== "object" ||
    ref === null ||
    typeof ref.assetId !== "string" ||
    ref.assetId.length === 0 ||
    !Number.isInteger(ref.revision) ||
    ref.revision < 0
  ) {
    return bad("asset.ref");
  }
  const pixels = asset.pixels;
  if (
    typeof pixels !== "object" ||
    pixels === null ||
    !Number.isInteger(pixels.width) ||
    !Number.isInteger(pixels.height) ||
    pixels.width < 1 ||
    pixels.height < 1 ||
    !(pixels.data instanceof Uint8ClampedArray) ||
    pixels.data.length < pixels.width * pixels.height * 4
  ) {
    return bad("asset.pixels");
  }
  return null;
}

function refsEqual(
  a: { assetId: string; revision: number },
  b: { assetId: string; revision: number },
): boolean {
  return a.assetId === b.assetId && a.revision === b.revision;
}

/** Validates one prompt against the embedded working image (:524). */
function validatePrompt(
  prompt: SamPrompt,
  asset: InputAsset,
): { ok: true; canonical: SamPrompt } | { ok: false; error: CharacterError } {
  const badPrompt = (field: string): CharacterError =>
    sessionError(CharacterErrorCode.InvalidPrompt, CharacterStage.PromptInference, {
      details: { field },
      recoverable: false,
    });
  if (typeof prompt !== "object" || prompt === null) {
    return { ok: false, error: badPrompt("prompt") };
  }
  const width = asset.pixels.width;
  const height = asset.pixels.height;
  const validBox = (box: unknown): box is Rect =>
    typeof box === "object" &&
    box !== null &&
    Number.isInteger((box as Rect).x) &&
    Number.isInteger((box as Rect).y) &&
    Number.isInteger((box as Rect).width) &&
    Number.isInteger((box as Rect).height) &&
    (box as Rect).width >= 1 &&
    (box as Rect).height >= 1 &&
    (box as Rect).x >= 0 &&
    (box as Rect).y >= 0 &&
    (box as Rect).x + (box as Rect).width <= width &&
    (box as Rect).y + (box as Rect).height <= height;
  const validPoint = (point: unknown): point is { x: number; y: number } =>
    typeof point === "object" &&
    point !== null &&
    Number.isInteger((point as { x: unknown }).x) &&
    Number.isInteger((point as { y: unknown }).y) &&
    (point as { x: number }).x >= 0 &&
    (point as { x: number }).x <= width - 1 &&
    (point as { y: number }).y >= 0 &&
    (point as { y: number }).y <= height - 1;

  let box: Rect | null = null;
  let rawPoints: SamPoint[] = [];
  if (prompt.type === "box") {
    if (!validBox(prompt.box)) return { ok: false, error: badPrompt("prompt.box") };
    box = prompt.box;
    rawPoints = Array.isArray(prompt.points) ? prompt.points : [];
  } else if (prompt.type === "points") {
    if (prompt.box !== null) {
      if (!validBox(prompt.box)) return { ok: false, error: badPrompt("prompt.box") };
      box = prompt.box;
    }
    rawPoints = Array.isArray(prompt.points) ? prompt.points : [];
  } else {
    return { ok: false, error: badPrompt("prompt.type") };
  }

  // Deduplicate exactly identical (coordinate+label) points first (:524).
  const seen = new Set<string>();
  const points: SamPoint[] = [];
  for (const entry of rawPoints) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: badPrompt("prompt.points") };
    }
    if (!validPoint(entry.point) || (entry.label !== "positive" && entry.label !== "negative")) {
      return { ok: false, error: badPrompt("prompt.points") };
    }
    const key = `${entry.point.x},${entry.point.y},${entry.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ point: { x: entry.point.x, y: entry.point.y }, label: entry.label });
  }
  const positives = points.filter((entry) => entry.label === "positive").length;
  const negatives = points.length - positives;
  if (box === null && positives < 1) {
    return { ok: false, error: badPrompt("prompt.points.positive") };
  }
  if (negatives > MAX_NEGATIVE_POINTS) {
    return { ok: false, error: badPrompt("prompt.points.negative") };
  }
  const canonical: SamPrompt =
    box === null
      ? { type: "points", points, box: null }
      : prompt.type === "box"
        ? { type: "box", box, points }
        : { type: "points", points, box };
  return { ok: true, canonical };
}

function buildInfo(state: SessionInternalState): SamSessionInfo {
  return {
    sessionId: state.sessionId,
    modelId: state.manifest.modelId,
    revision: state.manifest.revision,
    provider: state.provider ?? "wasm",
    cachedModel: state.cachedModel,
    asset:
      state.asset === null
        ? null
        : { assetId: state.asset.ref.assetId, revision: state.asset.ref.revision },
    state: state.state === "new" ? "ready" : state.state,
    warnings: [...state.extraWarnings],
  };
}

class SessionController implements SamSession {
  constructor(private readonly state: SessionInternalState) {}

  async initialize(context: CharacterExecutionContext): Promise<CharacterOutcome<SamSessionInfo>> {
    const { state } = this;
    if (state.state === "disposed") {
      return failure(sessionError(CharacterErrorCode.InvalidState, CharacterStage.ModelInitialize));
    }
    if (state.busy) {
      return failure(sessionError(CharacterErrorCode.Busy, CharacterStage.ModelInitialize));
    }
    const runtimeError = validateRuntimeOptions(state.options);
    if (runtimeError !== null) return failure(runtimeError);
    const manifestError = validateManifestShape(state.manifest);
    if (manifestError !== null) return failure(manifestError);
    if (state.state !== "new") {
      // Model stage already succeeded; retrying initialize is a no-op (:522 retry
      // semantics apply to the failed model stage, not to a ready session).
      return { ok: true, value: buildInfo(state) };
    }
    state.busy = true;
    try {
      const requested: SamExecutionProvider =
        state.options.provider === "auto" ? "webgpu" : state.options.provider;
      let provider = requested;
      if (context.isCancelled()) {
        return failure(
          sessionError(CharacterErrorCode.Cancelled, CharacterStage.ModelInitialize, {}),
        );
      }
      try {
        await state.backend.create(state.manifest, requested);
      } catch (error: unknown) {
        if (context.isCancelled()) {
          return failure(
            sessionError(CharacterErrorCode.Cancelled, CharacterStage.ModelInitialize),
          );
        }
        const coded = asCharacterError(error);
        // Only provider-level failures (MODEL_INITIALIZATION_FAILED, or unknown
        // errors from injected backends) trigger the single WASM rebuild; hash,
        // license, admission and download failures are terminal (:526).
        if (coded !== null && coded.code !== CharacterErrorCode.ModelInitializationFailed) {
          return failure(coded);
        }
        if (requested === "wasm" || state.replayedToWasm) {
          return failure(
            coded ??
              sessionError(
                CharacterErrorCode.ModelInitializationFailed,
                CharacterStage.ModelInitialize,
                { details: { modelId: state.manifest.modelId } },
              ),
          );
        }
        // WebGPU session creation failed: release everything, rebuild with WASM,
        // retrying the model stage exactly once (:524, :526).
        state.replayedToWasm = true;
        try {
          await state.backend.dispose();
        } catch {
          // Dispose failures must not mask the fallback path.
        }
        if (context.isCancelled()) {
          return failure(
            sessionError(CharacterErrorCode.Cancelled, CharacterStage.ModelInitialize),
          );
        }
        try {
          await state.backend.create(state.manifest, "wasm");
        } catch (wasmError: unknown) {
          return failure(
            asCharacterError(wasmError) ??
              sessionError(
                CharacterErrorCode.ModelInitializationFailed,
                CharacterStage.ModelInitialize,
                { details: { modelId: state.manifest.modelId } },
              ),
          );
        }
        provider = "wasm";
        state.extraWarnings.push(fallbackWarning());
      }
      const diagnostics = backendDiagnostics(state.backend).describeModelLoad?.();
      state.cachedModel = diagnostics?.cachedModel ?? false;
      if (diagnostics) state.extraWarnings.push(...diagnostics.warnings);
      state.provider = provider;
      state.state = "ready";
      return { ok: true, value: buildInfo(state) };
    } finally {
      state.busy = false;
    }
  }

  async setImage(
    asset: InputAsset,
    context: CharacterExecutionContext,
  ): Promise<CharacterOutcome<SamSessionInfo>> {
    const { state } = this;
    if (state.state === "disposed") {
      return failure(sessionError(CharacterErrorCode.InvalidState, CharacterStage.ImageEmbedding));
    }
    if (state.busy) {
      return failure(sessionError(CharacterErrorCode.Busy, CharacterStage.ImageEmbedding));
    }
    if (state.state === "new") {
      // Embedding before a successful initialize is a caller sequencing error.
      return failure(sessionError(CharacterErrorCode.InvalidState, CharacterStage.ImageEmbedding));
    }
    const assetError = validateAssetShape(asset);
    if (assetError !== null) return failure(assetError);
    const longestEdge = Math.max(asset.pixels.width, asset.pixels.height);
    if (longestEdge > state.manifest.maxSourceDimension) {
      return failure(
        sessionError(CharacterErrorCode.ResourceLimit, CharacterStage.ImageEmbedding, {
          recoveryActions: ["reduce-image-size"],
          details: { limit: state.manifest.maxSourceDimension, actual: longestEdge },
        }),
      );
    }
    if (
      state.state === "image-ready" &&
      state.asset !== null &&
      refsEqual(state.asset.ref, asset.ref)
    ) {
      // One embedding per asset revision (:429).
      return { ok: true, value: buildInfo(state) };
    }
    state.busy = true;
    try {
      if (context.isCancelled()) {
        return failure(sessionError(CharacterErrorCode.Cancelled, CharacterStage.ImageEmbedding));
      }
      try {
        await state.backend.embed(asset, state.manifest, context);
      } catch (error: unknown) {
        if (context.isCancelled()) {
          return failure(sessionError(CharacterErrorCode.Cancelled, CharacterStage.ImageEmbedding));
        }
        return failure(
          asCharacterError(error) ??
            sessionError(CharacterErrorCode.InferenceUnavailable, CharacterStage.ImageEmbedding, {
              details: { modelId: state.manifest.modelId },
            }),
        );
      }
      state.asset = asset;
      state.state = "image-ready";
      return { ok: true, value: buildInfo(state) };
    } finally {
      state.busy = false;
    }
  }

  async segment(
    prompt: SamPrompt,
    context: CharacterExecutionContext,
  ): Promise<CharacterOutcome<SamMaskResult>> {
    const { state } = this;
    if (state.state === "disposed") {
      return failure(sessionError(CharacterErrorCode.InvalidState, CharacterStage.PromptInference));
    }
    if (state.busy) {
      return failure(sessionError(CharacterErrorCode.Busy, CharacterStage.PromptInference));
    }
    if (state.state !== "image-ready" || state.asset === null) {
      return failure(sessionError(CharacterErrorCode.InvalidState, CharacterStage.PromptInference));
    }
    const validated = validatePrompt(prompt, state.asset);
    if (!validated.ok) return failure(validated.error);
    state.busy = true;
    try {
      const result = await this.runInference(validated.canonical, context);
      return result;
    } finally {
      state.busy = false;
    }
  }

  private async runInference(
    prompt: SamPrompt,
    context: CharacterExecutionContext,
  ): Promise<CharacterOutcome<SamMaskResult>> {
    const { state } = this;
    if (context.isCancelled()) {
      return failure(sessionError(CharacterErrorCode.Cancelled, CharacterStage.PromptInference));
    }
    try {
      const result = await state.backend.infer(prompt, context);
      if (context.isCancelled()) {
        return failure(sessionError(CharacterErrorCode.Cancelled, CharacterStage.PromptInference));
      }
      const structure = validateBitMask(
        result.mask,
        result.sourceRect.width,
        result.sourceRect.height,
      );
      if (!structure.ok) {
        return failure(
          sessionError(CharacterErrorCode.InternalError, CharacterStage.MaskPostprocess, {}),
        );
      }
      const asset = state.asset;
      if (
        asset === null ||
        result.sourceRect.x < 0 ||
        result.sourceRect.y < 0 ||
        result.sourceRect.x + result.sourceRect.width > asset.pixels.width ||
        result.sourceRect.y + result.sourceRect.height > asset.pixels.height
      ) {
        return failure(
          sessionError(CharacterErrorCode.InternalError, CharacterStage.MaskPostprocess, {}),
        );
      }
      if (!isUnitInterval(result.predictedIou)) {
        return failure(
          sessionError(CharacterErrorCode.InternalError, CharacterStage.MaskPostprocess, {}),
        );
      }
      return {
        ok: true,
        value: {
          asset: { assetId: asset.ref.assetId, revision: asset.ref.revision },
          mask: result.mask,
          sourceRect: {
            x: result.sourceRect.x,
            y: result.sourceRect.y,
            width: result.sourceRect.width,
            height: result.sourceRect.height,
          },
          predictedIou: result.predictedIou,
          provider: state.provider ?? "wasm",
        },
      };
    } catch (error: unknown) {
      if (context.isCancelled()) {
        return failure(sessionError(CharacterErrorCode.Cancelled, CharacterStage.PromptInference));
      }
      const coded = asCharacterError(error);
      // Replay on WASM is only for provider-level inference failures; explicit
      // contract errors from the backend are terminal.
      if (coded !== null && coded.code !== CharacterErrorCode.InferenceUnavailable) {
        return failure(coded);
      }
      if (state.provider !== "webgpu" || state.replayedToWasm) {
        return failure(
          coded ??
            sessionError(CharacterErrorCode.InferenceUnavailable, CharacterStage.PromptInference, {
              details: { modelId: state.manifest.modelId },
            }),
        );
      }
      state.replayedToWasm = true;
      try {
        await state.backend.dispose();
      } catch {
        // Dispose failures must not mask the fallback path.
      }
      if (context.isCancelled()) {
        return failure(sessionError(CharacterErrorCode.Cancelled, CharacterStage.PromptInference));
      }
      try {
        await state.backend.create(state.manifest, "wasm");
      } catch (wasmError: unknown) {
        return failure(
          asCharacterError(wasmError) ??
            sessionError(
              CharacterErrorCode.ModelInitializationFailed,
              CharacterStage.ModelInitialize,
              { details: { modelId: state.manifest.modelId } },
            ),
        );
      }
      state.provider = "wasm";
      state.extraWarnings.push(fallbackWarning());
      const asset = state.asset;
      if (asset === null) {
        return failure(
          sessionError(CharacterErrorCode.InvalidState, CharacterStage.PromptInference),
        );
      }
      try {
        await state.backend.embed(asset, state.manifest, context);
        const result = await state.backend.infer(prompt, context);
        const structure = validateBitMask(
          result.mask,
          result.sourceRect.width,
          result.sourceRect.height,
        );
        if (!structure.ok) {
          return failure(
            sessionError(CharacterErrorCode.InternalError, CharacterStage.MaskPostprocess, {}),
          );
        }
        return {
          ok: true,
          value: {
            asset: { assetId: asset.ref.assetId, revision: asset.ref.revision },
            mask: result.mask,
            sourceRect: {
              x: result.sourceRect.x,
              y: result.sourceRect.y,
              width: result.sourceRect.width,
              height: result.sourceRect.height,
            },
            predictedIou: result.predictedIou,
            provider: "wasm",
          },
        };
      } catch (replayError: unknown) {
        if (context.isCancelled()) {
          return failure(
            sessionError(CharacterErrorCode.Cancelled, CharacterStage.PromptInference),
          );
        }
        return failure(
          asCharacterError(replayError) ??
            sessionError(CharacterErrorCode.InferenceUnavailable, CharacterStage.PromptInference, {
              details: { modelId: state.manifest.modelId },
            }),
        );
      }
    }
  }

  async dispose(): Promise<void> {
    const { state } = this;
    if (state.state === "disposed") return;
    state.state = "disposed";
    state.asset = null;
    state.provider = null;
    try {
      await state.backend.dispose();
    } catch {
      // dispose() is idempotent and must never reject (:429).
    }
  }
}

/**
 * Creates a SamSession over an injected backend. Model admission, download and
 * hash verification happen inside the backend's create(); the session owns the
 * provider fallback, the single-task lock and prompt validation.
 */
export function createSamSession(
  manifest: SamModelManifest,
  options: SamRuntimeOptions,
  backend: SamInferenceBackend,
): SamSession {
  return new SessionController({
    backend,
    manifest,
    options,
    sessionId: generateSessionId(),
    state: "new",
    provider: null,
    replayedToWasm: false,
    cachedModel: false,
    extraWarnings: [],
    asset: null,
    busy: false,
  });
}
