// Approved SAM model manifest registry and verified artifact loading
// (docs/interface-contract-v3.md section 4, :425-533; architecture-v3.md :94).
// Browser-only: fetch, Cache API and WebCrypto subtle appear here and in the rest
// of src/browser only. Gate order: allowlist/frozen/license admission → cache →
// network fetch → byte-length check → SHA-256 → (backend) ORT session creation.
// A hash that does not match is always discarded, and no gate can be skipped by
// cache availability, quota or CORS failures.
import { characterError } from "../errors.js";
import type { CharacterError, CharacterErrorCode, ModelId, SamModelManifest } from "../types.js";
import { CharacterErrorCode as Code, CharacterStage as Stage } from "../types.js";

/** A minimal structural subset of the Cache API used for model caching. */
export interface SamCacheLike {
  match(request: RequestInfo | URL): Promise<Response | undefined | null>;
  put(request: RequestInfo | URL, response: Response): Promise<void>;
}

/** Thrown by the loader; carries the contract CharacterError for the session. */
export class SamModelLoadError extends Error {
  readonly characterError: CharacterError;

  constructor(characterError: CharacterError) {
    super(characterError.messageKey);
    this.name = "SamModelLoadError";
    this.characterError = characterError;
  }
}

export type SamArtifactRole = "encoder" | "decoder";

/** Internal registry metadata layered on top of the contract manifest shape. */
export interface SamRegistryEntry {
  manifest: SamModelManifest;
  role: SamArtifactRole;
  family: string;
  /** A registry entry whose SHA-256 is not RC-frozen must never initialize. */
  frozen: boolean;
}

/** License IDs audited in docs/architecture-v3.md (SAM 2 checkpoints: Apache-2.0). */
export const APPROVED_SAM_LICENSE_IDS: ReadonlySet<string> = new Set(["apache-2.0"]);

// Tensor/input names must be verified against the actual ONNX graphs in the
// real-model smoke increment; a mismatch fails closed at session run time.
const SAM2_TINY_INPUT_SIZE = Object.freeze({ width: 1024, height: 1024 });
const SAM2_TINY_MAX_SOURCE_DIMENSION = 2048;
const SAM2_TINY_IMAGE_INPUT_NAME = "image";
const SAM2_TINY_PROMPT_INPUT_NAMES = Object.freeze({
  box: "box_coords",
  points: "point_coords",
  pointLabels: "point_labels",
});
const SAM2_TINY_OUTPUT_NAMES = Object.freeze({
  masks: "masks",
  scores: "iou_predictions",
});
const SAM2_TINY_REVISION = "v0";
const SAM2_TINY_LICENSE_ID = "apache-2.0";
const SAM2_TINY_BASE_URL =
  "https://hf-mirror.com/Geo-IA/evo-sam2.1-onnx/resolve/main/sam2.1_hiera_tiny";

function sam2TinyManifest(
  modelId: string,
  fileName: string,
  byteLength: number,
  sha256: string,
): SamModelManifest {
  return {
    modelId,
    revision: SAM2_TINY_REVISION,
    artifactUrl: `${SAM2_TINY_BASE_URL}/${fileName}`,
    sha256,
    byteLength,
    inputSize: { ...SAM2_TINY_INPUT_SIZE },
    maxSourceDimension: SAM2_TINY_MAX_SOURCE_DIMENSION,
    imageInputName: SAM2_TINY_IMAGE_INPUT_NAME,
    promptInputNames: { ...SAM2_TINY_PROMPT_INPUT_NAMES },
    outputNames: { ...SAM2_TINY_OUTPUT_NAMES },
    licenseId: SAM2_TINY_LICENSE_ID,
  };
}

/**
 * RC-frozen v0 registry, fp16 single tier (contract r4 ruling): both artifact
 * hashes are frozen, and the WASM fallback reuses the same fp16 artifacts —
 * PRD AC-V03-B only requires the fallback to be available, not fast, which also
 * spares fallback users a 128 MB download. The fp32 artifacts are NOT served;
 * their measured URL/byte-size/SHA-256 records live in
 * docs/research/2026-09-30-sam2-onnx-model-sources.md. Artifact URLs keep the
 * hf-mirror placeholder origin until the production R2 domain is configured
 * (see setSamModelArtifactUrlOverride).
 */
export const SAM_MODEL_REGISTRY: readonly SamRegistryEntry[] = Object.freeze([
  {
    manifest: sam2TinyManifest(
      "sam2.1-hiera-tiny-encoder-fp16",
      "vision_encoder_fp16.onnx",
      67_313_499,
      "f4ca896cf99816ad0cb7062e9ebef44a211e6f0d0a0656a7eb13349204cb6caa",
    ),
    role: "encoder",
    family: "sam2.1-hiera-tiny-fp16",
    frozen: true,
  },
  {
    manifest: sam2TinyManifest(
      "sam2.1-hiera-tiny-decoder-fp16",
      "prompt_encoder_mask_decoder_fp16.onnx",
      8_755_200,
      "f362ed5bbcfbece283ce970a2162486da9f018645a382b927755677b9d267e6d",
    ),
    role: "decoder",
    family: "sam2.1-hiera-tiny-fp16",
    frozen: true,
  },
] as const);

// Operational seam for the upcoming R2 origin swap: per-model-id URL overrides,
// validated to stay HTTPS without userinfo/fragment. Not part of the public
// browser export list (the contract fixes it to three functions).
const artifactUrlOverrides = new Map<ModelId, string>();

function overrideUrlIsValid(url: string): boolean {
  if (url.length === 0 || url.length > 2048 || !url.startsWith("https://")) return false;
  if (url.includes("#")) return false;
  const afterScheme = url.slice("https://".length);
  const terminator = afterScheme.search(/[/?]/);
  const authority = terminator === -1 ? afterScheme : afterScheme.slice(0, terminator);
  return !authority.includes("@");
}

/** Registers an audited replacement origin for one model id (e.g. the R2 domain). */
export function setSamModelArtifactUrlOverride(modelId: ModelId, url: string): boolean {
  if (typeof modelId !== "string" || modelId.length === 0) return false;
  if (!overrideUrlIsValid(url)) return false;
  artifactUrlOverrides.set(modelId, url);
  return true;
}

export function clearSamModelArtifactUrlOverrides(): void {
  artifactUrlOverrides.clear();
}

function effectiveManifest(entry: SamRegistryEntry): SamModelManifest {
  const override = artifactUrlOverrides.get(entry.manifest.modelId);
  return override === undefined ? entry.manifest : { ...entry.manifest, artifactUrl: override };
}

/**
 * Admits a registry entry: known id, frozen hash, audited license. Unknown
 * license or unfrozen entries can never initialize (fail-closed, :427/:526).
 */
export function resolveApprovedEntry(
  modelId: ModelId,
  registry: readonly SamRegistryEntry[] = SAM_MODEL_REGISTRY,
): SamRegistryEntry | null {
  const entry = registry.find((candidate) => candidate.manifest.modelId === modelId);
  if (entry === undefined || !entry.frozen) return null;
  if (!APPROVED_SAM_LICENSE_IDS.has(entry.manifest.licenseId)) return null;
  return entry;
}

/**
 * Public read-only accessor for the compiled-in allowlist (:529-532). Returns a
 * defensive frozen copy, or null for unknown/unapproved/unfrozen model ids.
 */
export function getApprovedSamManifest(modelId: ModelId): SamModelManifest | null {
  const entry = resolveApprovedEntry(modelId);
  if (entry === null) return null;
  const manifest = effectiveManifest(entry);
  return Object.freeze({
    ...manifest,
    inputSize: Object.freeze({ ...manifest.inputSize }),
    promptInputNames: Object.freeze({ ...manifest.promptInputNames }),
    outputNames: Object.freeze({ ...manifest.outputNames }),
  });
}

/** Strict comparison against the audited entry: any drift is rejected. */
export function manifestMatchesEntry(manifest: SamModelManifest, entry: SamRegistryEntry): boolean {
  const approved = effectiveManifest(entry);
  return (
    manifest.modelId === approved.modelId &&
    manifest.revision === approved.revision &&
    manifest.artifactUrl === approved.artifactUrl &&
    manifest.sha256.toLowerCase() === approved.sha256.toLowerCase() &&
    manifest.byteLength === approved.byteLength &&
    manifest.inputSize.width === approved.inputSize.width &&
    manifest.inputSize.height === approved.inputSize.height &&
    manifest.maxSourceDimension === approved.maxSourceDimension &&
    manifest.imageInputName === approved.imageInputName &&
    manifest.promptInputNames.box === approved.promptInputNames.box &&
    manifest.promptInputNames.points === approved.promptInputNames.points &&
    manifest.promptInputNames.pointLabels === approved.promptInputNames.pointLabels &&
    manifest.outputNames.masks === approved.outputNames.masks &&
    manifest.outputNames.scores === approved.outputNames.scores &&
    manifest.licenseId === approved.licenseId
  );
}

function modelStageError(
  code: CharacterErrorCode,
  details: CharacterError["details"],
): SamModelLoadError {
  return new SamModelLoadError(characterError(code, Stage.ModelInitialize, { details }));
}

async function sha256Hex(subtle: SubtleCrypto, bytes: ArrayBuffer): Promise<string> {
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyArtifactBytes(
  subtle: SubtleCrypto,
  bytes: ArrayBuffer,
  manifest: SamModelManifest,
): Promise<void> {
  if (bytes.byteLength !== manifest.byteLength) {
    throw modelStageError(Code.ModelDownloadFailed, {
      modelId: manifest.modelId,
      limit: manifest.byteLength,
      actual: bytes.byteLength,
    });
  }
  const hash = await sha256Hex(subtle, bytes);
  if (hash !== manifest.sha256.toLowerCase()) {
    throw modelStageError(Code.ModelHashMismatch, { modelId: manifest.modelId });
  }
}

export interface SamModelLoaderDeps {
  fetchImpl: typeof fetch;
  openCache: () => Promise<SamCacheLike | null>;
  subtle: SubtleCrypto;
  useModelCache: boolean;
}

export interface VerifiedArtifactLoad {
  bytes: ArrayBuffer;
  cachedModel: boolean;
  cacheAvailable: boolean;
}

function cacheKeyFor(manifest: SamModelManifest): string {
  // architecture-v3.md :94: cache key is composed of model id, revision and hash.
  return `https://spriteflow-cache.spriteflow.invalid/sam/${manifest.modelId}/${manifest.revision}/${manifest.sha256.toLowerCase()}`;
}

/**
 * Loads one model artifact with the mandatory gate order: Cache API first (a hit
 * is verified exactly like a network download), then network fetch, byte-length
 * check, and SHA-256. Cache read/write failures degrade to network and are
 * reported via cacheAvailable; hash mismatches are never tolerated.
 */
export async function loadVerifiedArtifact(
  manifest: SamModelManifest,
  deps: SamModelLoaderDeps,
): Promise<VerifiedArtifactLoad> {
  let cacheAvailable = true;
  let cache: SamCacheLike | null = null;
  if (deps.useModelCache) {
    try {
      cache = await deps.openCache();
    } catch {
      cache = null;
    }
    if (cache === null) cacheAvailable = false;
  }
  if (cache !== null) {
    try {
      const cached = await cache.match(cacheKeyFor(manifest));
      if (cached?.ok) {
        const bytes = await cached.arrayBuffer();
        // A cached artifact must pass the exact same verification as a network
        // download; any failure (length or hash) discards the copy and the
        // network fetch below proceeds (:427).
        await verifyArtifactBytes(deps.subtle, bytes, manifest);
        return { bytes, cachedModel: true, cacheAvailable };
      }
    } catch {
      cacheAvailable = false;
    }
  }

  let response: Response;
  try {
    response = await deps.fetchImpl(manifest.artifactUrl, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
    });
  } catch {
    throw modelStageError(Code.ModelDownloadFailed, { modelId: manifest.modelId });
  }
  if (!response.ok) {
    throw modelStageError(Code.ModelDownloadFailed, {
      modelId: manifest.modelId,
      actual: response.status,
    });
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number.parseInt(declaredLength, 10) !== manifest.byteLength) {
    throw modelStageError(Code.ModelDownloadFailed, {
      modelId: manifest.modelId,
      limit: manifest.byteLength,
      actual: Number.parseInt(declaredLength, 10),
    });
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    throw modelStageError(Code.ModelDownloadFailed, { modelId: manifest.modelId });
  }
  await verifyArtifactBytes(deps.subtle, bytes, manifest);

  if (cache !== null) {
    // Saving the cache is never a precondition for success (:94, architecture).
    try {
      await cache.put(cacheKeyFor(manifest), new Response(bytes.slice(0), { status: 200 }));
    } catch {
      cacheAvailable = false;
    }
  }
  return { bytes, cachedModel: false, cacheAvailable };
}
