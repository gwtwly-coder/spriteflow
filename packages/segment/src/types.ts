// Public declarations transcribed from docs/interface-contract-v3.md (0.2.0-r2),
// sections 1-5 and 10. Only types/enums that the v3.0-alpha root entry needs are
// declared here; the root index exports exactly the contract surface.
import type { AssetRef, Point, Rect, Size } from "./m1.js";

// --- Section 1: shared rules and package entry -------------------------------

export type PartId = string;
export type BoneId = string;
export type MotionId = string;
export type ModelId = string;
export type SessionId = string;
export type V3TaskId = string;

export type CharacterOutcome<T> = { ok: true; value: T } | { ok: false; error: CharacterError };

export interface CharacterExecutionContext {
  taskId: V3TaskId;
  isCancelled(): boolean;
  yieldControl(): Promise<void>;
  onProgress(event: CharacterProgressEvent): void;
  limits: CharacterLimits;
}

export interface CharacterLimits {
  maxWorkingDimension: number;
  maxWorkingPixels: number;
  maxParts: number;
  maxPromptsPerPart: number;
  /** v3.5 reserved — no v3.0-alpha stage reads or enforces this limit. */
  maxMotionFrames: number;
  /** v3.5 reserved — no v3.0-alpha stage reads or enforces this limit. */
  maxRenderPixels: number;
  maxModelBytes: number;
  maxLlmResponseBytes: number;
  maxArchiveBytes: number;
}

export interface CharacterProgressEvent {
  protocolVersion: 1;
  taskId: V3TaskId;
  stage: CharacterStage;
  stageProgress: number;
  overallProgress: number;
  completedUnits: number;
  totalUnits: number | null;
  cancellable: boolean;
}

export enum CharacterStage {
  Validate = "validate",
  SemanticLocate = "semantic-locate",
  ModelDownload = "model-download",
  ModelVerify = "model-verify",
  ModelInitialize = "model-initialize",
  ImageEmbedding = "image-embedding",
  PromptInference = "prompt-inference",
  MaskPostprocess = "mask-postprocess",
  PartCrop = "part-crop",
  PixelAssert = "pixel-assert",
  PngEncode = "png-encode",
  Archive = "archive",
  // Reserved for the v3.5 rig extension; not emitted by v3.0-alpha.
  RigMapping = "rig-mapping",
  PoseSampling = "pose-sampling",
  Render = "render",
  Adapt = "adapt",
  Complete = "complete",
}

// --- Section 10: error model (needed by CharacterOutcome) ---------------------

export enum CharacterErrorCode {
  InvalidArgument = "INVALID_ARGUMENT",
  InvalidState = "INVALID_STATE",
  ResourceLimit = "RESOURCE_LIMIT",
  Cancelled = "CANCELLED",
  Busy = "BUSY",
  AssetMismatch = "ASSET_MISMATCH",
  LlmConsentRequired = "LLM_CONSENT_REQUIRED",
  LlmConfigurationInvalid = "LLM_CONFIGURATION_INVALID",
  LlmAuthenticationFailed = "LLM_AUTHENTICATION_FAILED",
  LlmRateLimited = "LLM_RATE_LIMITED",
  LlmNetworkFailed = "LLM_NETWORK_FAILED",
  LlmTimeout = "LLM_TIMEOUT",
  LlmResponseTooLarge = "LLM_RESPONSE_TOO_LARGE",
  LlmInvalidResponse = "LLM_INVALID_RESPONSE",
  ModelNotApproved = "MODEL_NOT_APPROVED",
  ModelDownloadFailed = "MODEL_DOWNLOAD_FAILED",
  ModelHashMismatch = "MODEL_HASH_MISMATCH",
  ModelInitializationFailed = "MODEL_INITIALIZATION_FAILED",
  InferenceUnavailable = "INFERENCE_UNAVAILABLE",
  InvalidPrompt = "INVALID_PROMPT",
  InvalidMask = "INVALID_MASK",
  NoParts = "NO_PARTS",
  PartExportInvalid = "PART_EXPORT_INVALID",
  PartPixelInvariantFailed = "PART_PIXEL_INVARIANT_FAILED",
  ArchiveLimit = "ARCHIVE_LIMIT",
  // v3.5 reserved errors; v3.0-alpha does not emit them.
  RigTemplateUnsupported = "RIG_TEMPLATE_UNSUPPORTED",
  InvalidRig = "INVALID_RIG",
  InvalidMotion = "INVALID_MOTION",
  RenderFailed = "RENDER_FAILED",
  CompletionNotImplemented = "NOT_IMPLEMENTED",
  InternalError = "INTERNAL_ERROR",
}

export type CharacterRecoveryAction =
  | "configure-key"
  | "retry"
  | "continue-click-mode"
  | "choose-points"
  | "reload-model"
  | "reduce-image-size"
  /** v3.5 reserved — rig/motion editor surface; unreachable in v3.0-alpha. */
  | "edit-rig"
  | "edit-motion"
  | "review-parts"
  | "restart-worker";

export interface CharacterError {
  code: CharacterErrorCode;
  messageKey: string;
  stage: CharacterStage;
  recoverable: boolean;
  recoveryActions: CharacterRecoveryAction[];
  details: {
    field?: string;
    provider?: string;
    modelId?: ModelId;
    limit?: number;
    actual?: number;
    partIds?: PartId[];
  };
}

// --- Section 2: parts, masks and segmentation results -------------------------

export enum PartKind {
  Hair = "hair",
  Head = "head",
  Face = "face",
  EyeLeft = "eye-left",
  EyeRight = "eye-right",
  EyebrowLeft = "eyebrow-left",
  EyebrowRight = "eyebrow-right",
  Mouth = "mouth",
  Neck = "neck",
  Torso = "torso",
  UpperArmLeft = "upper-arm-left",
  ForearmLeft = "forearm-left",
  HandLeft = "hand-left",
  UpperArmRight = "upper-arm-right",
  ForearmRight = "forearm-right",
  HandRight = "hand-right",
  ThighLeft = "thigh-left",
  ShinLeft = "shin-left",
  FootLeft = "foot-left",
  ThighRight = "thigh-right",
  ShinRight = "shin-right",
  FootRight = "foot-right",
  Accessory = "accessory",
  Other = "other",
}

export interface BitMask {
  width: number;
  height: number;
  encoding: "bitset-lsb0-row-major";
  data: Uint8Array;
}

export interface PartCanvas extends Size {
  offset: Point;
}

export interface PartAsset {
  id: PartId;
  asset: AssetRef;
  name: string;
  kind: PartKind;
  sourceRect: Rect;
  mask: BitMask;
  canvas: PartCanvas;
  confidence: number;
  occluded: boolean;
  visibleFraction: number;
}

export interface HumanoidAssessment {
  isHumanoid: boolean;
  confidence: number;
  reason: "humanoid" | "non-humanoid" | "uncertain";
}

export type SegmentationMode = "semantic" | "click";

export enum SegmentationDegradedReason {
  NonHumanoid = "NON_HUMANOID",
  LlmFailed = "LLM_FAILED",
  LlmUnavailable = "LLM_UNAVAILABLE",
  LowSemanticConfidence = "LOW_SEMANTIC_CONFIDENCE",
}

export interface SegmentationDegradation {
  reason: SegmentationDegradedReason;
  nextMode: "click";
  messageKey: string;
}

export enum CharacterWarningCode {
  LlmFallbackToClick = "LLM_FALLBACK_TO_CLICK",
  NonHumanoidClickMode = "NON_HUMANOID_CLICK_MODE",
  WebGpuFallbackToWasm = "WEBGPU_FALLBACK_TO_WASM",
  EmptyMask = "EMPTY_MASK",
  LowMaskConfidence = "LOW_MASK_CONFIDENCE",
  ModelCacheUnavailable = "MODEL_CACHE_UNAVAILABLE",
}

export interface CharacterWarning {
  code: CharacterWarningCode;
  messageKey: string;
  partIds: PartId[];
}

export interface SegmentationResult {
  asset: AssetRef;
  mode: SegmentationMode;
  humanoid: HumanoidAssessment | null;
  parts: PartAsset[];
  confidence: number;
  degraded: SegmentationDegradation | null;
  warnings: CharacterWarning[];
}

export interface SegmentationOptions {
  maxParts: number;
  minimumPartConfidence: number;
  minimumMaskConfidence: number;
  modelInputMaxDimension: number;
  preserveSmallParts: boolean;
}

// --- Section 2 (referenced from section 4): SAM mask result --------------------

export type SamExecutionProvider = "webgpu" | "wasm";

export interface SamMaskResult {
  asset: AssetRef;
  mask: BitMask;
  sourceRect: Rect;
  predictedIou: number;
  provider: SamExecutionProvider;
}

// --- Section 5 (referenced from section 2): mask edits -------------------------

export interface MaskEditPoint {
  // Integer pixel indices local to the BitMask.
  point: Point;
  label: "positive" | "negative";
}

export interface MaskEdit {
  points: MaskEditPoint[];
}

// --- Section 3: L1 semantic locate and BYOK API --------------------------------

export interface LlmProviderConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxResponseBytes: number;
  maxOutputTokens: number;
}

export interface LlmImage {
  mime: "image/png" | "image/webp";
  dataUrl: string;
  width: number;
  height: number;
}

export interface LlmLocateRequest {
  asset: AssetRef;
  image: LlmImage;
  provider: LlmProviderConfig;
  userConsent: true;
  options: SegmentationOptions;
}

export interface LlmChatRequest {
  endpoint: string;
  model: string;
  authorization: string;
  timeoutMs: number;
  maxResponseBytes: number;
  body: {
    model: string;
    temperature: 0;
    max_tokens: number;
    response_format: { type: "json_object" };
    messages: Array<{
      role: "system" | "user";
      content:
        | string
        | Array<
            | { type: "text"; text: string }
            | { type: "image_url"; image_url: { url: string; detail: "high" } }
          >;
    }>;
  };
}

export interface LlmChatResponse {
  status: number;
  retryAfterMs: number | null;
  body: unknown;
}

export interface LlmTransport {
  send(request: LlmChatRequest, context: CharacterExecutionContext): Promise<LlmChatResponse>;
}

export interface PartProposal {
  kind: PartKind;
  name: string;
  box: Rect;
  confidence: number;
  occluded: boolean;
}

export interface LlmLocateDocument {
  schemaVersion: "spriteflow-parts/1";
  coordinateSpace: "working-pixels-top-left-half-open";
  humanoid: HumanoidAssessment;
  parts: PartProposal[];
}

export interface LlmLocateResult {
  document: LlmLocateDocument;
  attempts: 1 | 2;
  repaired: boolean;
}
