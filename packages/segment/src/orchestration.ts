// Segmentation orchestration (docs/interface-contract-v3.md section 5, :534-591):
// consent gate → L1 locate → humanoid/confidence gates → L2 SAM refinement →
// PartAsset assembly, plus the click-prompt path. Root-entry-pure: transport and
// SAM backend are injected; no DOM/fetch/ORT appears here. Only this module emits
// progress so that overallProgress stays monotonic within the task.
import { countSetBits } from "./bitmask.js";
import { type CharacterErrorOptions, characterError, failure } from "./errors.js";
import { locatePartsWithLlm } from "./llm.js";
import type { AssetRef, InputAsset } from "./m1.js";
import { createPartAsset, isPartKind } from "./partAsset.js";
import {
  createSamSession,
  validateAssetShape,
  validateManifestShape,
  validateRuntimeOptions,
} from "./session.js";
import type {
  CharacterError,
  CharacterExecutionContext,
  CharacterOutcome,
  CharacterWarning,
  HumanoidAssessment,
  LlmTransport,
  PartAsset,
  PartKind,
  SamInferenceBackend,
  SamModelManifest,
  SamPrompt,
  SamRuntimeOptions,
  SamSession,
  SegmentationDegradedReason,
  SegmentationOptions,
  SegmentationResult,
} from "./types.js";
import {
  type CharacterStage,
  CharacterErrorCode as Code,
  SegmentationDegradedReason as DegradedReason,
  CharacterStage as Stage,
  CharacterWarningCode as WarningCode,
} from "./types.js";

const OPTIONS_MAX_PARTS_MAX = 32;
const OPTIONS_MODEL_DIMENSION_MIN = 256;
const OPTIONS_MODEL_DIMENSION_MAX = 1024;

// Coarse overall schedule (fractions of the whole task).
const OVERALL_VALIDATE = 0.02;
const OVERALL_LOCATE_END = 0.25;
const OVERALL_MODEL_END = 0.4;
const OVERALL_EMBED_END = 0.55;
const OVERALL_PROMPT_END = 0.95;

interface RequestedSemanticSegmentation {
  asset: InputAsset;
  image: Parameters<typeof locatePartsWithLlm>[0]["image"];
  llm: Parameters<typeof locatePartsWithLlm>[0]["provider"] | null;
  llmConsent: boolean;
  model: SamModelManifest;
  options: SegmentationOptions;
  runtime: SamRuntimeOptions;
}

interface RequestedClickSegmentation {
  asset: InputAsset;
  model: SamModelManifest;
  runtime: SamRuntimeOptions;
  initialPrompts: Array<{ kind: PartKind; name: string; prompt: SamPrompt }>;
}

/** Emits monotonic overall progress and a single terminal complete event. */
class ProgressReporter {
  private lastOverall = 0;
  private done = false;

  constructor(
    private readonly taskId: string,
    private readonly onProgress: CharacterExecutionContext["onProgress"],
  ) {}

  emit(
    stage: CharacterStage,
    stageProgress: number,
    overall: number,
    completedUnits = 0,
    totalUnits: number | null = null,
  ): void {
    if (this.done) return;
    this.lastOverall = Math.max(this.lastOverall, Math.min(1, Math.max(0, overall)));
    this.onProgress({
      protocolVersion: 1,
      taskId: this.taskId,
      stage,
      stageProgress: Math.min(1, Math.max(0, stageProgress)),
      overallProgress: this.lastOverall,
      completedUnits,
      totalUnits,
      cancellable: true,
    });
  }

  complete(completedUnits: number, totalUnits: number | null): void {
    if (this.done) return;
    this.done = true;
    this.onProgress({
      protocolVersion: 1,
      taskId: this.taskId,
      stage: Stage.Complete,
      stageProgress: 1,
      overallProgress: 1,
      completedUnits,
      totalUnits,
      cancellable: false,
    });
  }
}

function orchestrationError(
  code: Code,
  stage: CharacterStage,
  options: CharacterErrorOptions = {},
): CharacterError {
  return characterError(code, stage, options);
}

function cancelled(stage: CharacterStage): CharacterError {
  return orchestrationError(Code.Cancelled, stage, {});
}

function warning(code: WarningCode, partIds: string[]): CharacterWarning {
  return { code, messageKey: `character.warning.${code}`, partIds };
}

function degradationMessageKey(reason: SegmentationDegradedReason): string {
  return `character.degradation.${reason}`;
}

function clickModeResult(
  asset: AssetRef,
  humanoid: HumanoidAssessment | null,
  reason: SegmentationDegradedReason,
  warnings: CharacterWarning[],
): SegmentationResult {
  return {
    asset,
    mode: "click",
    humanoid,
    parts: [],
    confidence: 0,
    degraded: {
      reason,
      nextMode: "click",
      messageKey: degradationMessageKey(reason),
    },
    warnings,
  };
}

function validateOrchestrationOptions(
  options: SegmentationOptions,
  limits: CharacterExecutionContext["limits"],
): CharacterError | null {
  const bad = (field: string, limit?: number, actual?: number) =>
    orchestrationError(Code.InvalidArgument, Stage.Validate, {
      details: {
        field,
        ...(limit !== undefined ? { limit } : {}),
        ...(actual !== undefined ? { actual } : {}),
      },
    });
  if (
    typeof options !== "object" ||
    options === null ||
    !Number.isInteger(options.maxParts) ||
    options.maxParts < 1 ||
    options.maxParts > OPTIONS_MAX_PARTS_MAX
  ) {
    return bad("options.maxParts", OPTIONS_MAX_PARTS_MAX, options?.maxParts);
  }
  if (options.maxParts > limits.maxParts) {
    return orchestrationError(Code.ResourceLimit, Stage.Validate, {
      details: { field: "options.maxParts", limit: limits.maxParts, actual: options.maxParts },
    });
  }
  if (
    typeof options.minimumPartConfidence !== "number" ||
    !Number.isFinite(options.minimumPartConfidence) ||
    options.minimumPartConfidence < 0 ||
    options.minimumPartConfidence > 1
  ) {
    return bad("options.minimumPartConfidence", 1, options?.minimumPartConfidence);
  }
  if (
    typeof options.minimumMaskConfidence !== "number" ||
    !Number.isFinite(options.minimumMaskConfidence) ||
    options.minimumMaskConfidence < 0 ||
    options.minimumMaskConfidence > 1
  ) {
    return bad("options.minimumMaskConfidence", 1, options?.minimumMaskConfidence);
  }
  if (
    !Number.isInteger(options.modelInputMaxDimension) ||
    options.modelInputMaxDimension < OPTIONS_MODEL_DIMENSION_MIN ||
    options.modelInputMaxDimension > OPTIONS_MODEL_DIMENSION_MAX
  ) {
    return bad("options.modelInputMaxDimension", OPTIONS_MODEL_DIMENSION_MAX);
  }
  if (typeof options.preserveSmallParts !== "boolean") return bad("options.preserveSmallParts");
  return null;
}

/** Initializes the model stage and embeds the asset, reporting coarse progress. */
async function prepareSession(
  session: SamSession,
  asset: InputAsset,
  reporter: ProgressReporter,
  context: CharacterExecutionContext,
): Promise<CharacterError | null> {
  reporter.emit(Stage.ModelInitialize, 0, OVERALL_LOCATE_END);
  const initialized = await session.initialize(context);
  if (!initialized.ok) return initialized.error;
  reporter.emit(Stage.ModelInitialize, 1, OVERALL_MODEL_END);
  reporter.emit(Stage.ImageEmbedding, 0, OVERALL_MODEL_END);
  const embedded = await session.setImage(asset, context);
  if (!embedded.ok) return embedded.error;
  reporter.emit(Stage.ImageEmbedding, 1, OVERALL_EMBED_END);
  return null;
}

interface PartSegmentOutcome {
  part: PartAsset;
  warnings: CharacterWarning[];
  confidence: number;
}

/** Runs one prompt through the session and wraps the mask into a PartAsset. */
async function segmentOnePart(
  session: SamSession,
  asset: InputAsset,
  kind: PartKind,
  name: string,
  prompt: SamPrompt,
  minimumMaskConfidence: number | null,
  context: CharacterExecutionContext,
): Promise<{ ok: true; value: PartSegmentOutcome } | { ok: false; error: CharacterError }> {
  const prompted = await session.segment(prompt, context);
  if (!prompted.ok) return { ok: false, error: prompted.error };
  const created = createPartAsset(asset, kind, name, prompted.value);
  if (!created.ok) return { ok: false, error: created.error };
  const warnings: CharacterWarning[] = [];
  // Empty masks stay editable parts with a warning; low predicted IoU is a
  // warning too and neither is silently dropped (:242, :524, :876).
  if (countSetBits(prompted.value.mask) === 0) {
    warnings.push(warning(WarningCode.EmptyMask, [created.value.id]));
  }
  if (minimumMaskConfidence !== null && prompted.value.predictedIou < minimumMaskConfidence) {
    warnings.push(warning(WarningCode.LowMaskConfidence, [created.value.id]));
  }
  return {
    ok: true,
    value: { part: created.value, warnings, confidence: prompted.value.predictedIou },
  };
}

function meanConfidence(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Semantic segmentation entry point: validates the complete LLM document before
 * any SAM work; LLM failure or non-humanoid results return a successful editable
 * click-mode result with zero semantic parts (never a transport error).
 */
export async function segmentSemantically(
  request: RequestedSemanticSegmentation,
  llmTransport: LlmTransport,
  samBackend: SamInferenceBackend,
  context: CharacterExecutionContext,
): Promise<CharacterOutcome<SegmentationResult>> {
  if (context.isCancelled()) return failure(cancelled(Stage.Validate));
  const assetError = validateAssetShape(request.asset);
  if (assetError !== null) return failure(assetError);
  const modelError =
    validateManifestShape(request.model) ?? validateRuntimeOptions(request.runtime);
  if (modelError !== null) return failure(modelError);
  const optionsError = validateOrchestrationOptions(request.options, context.limits);
  if (optionsError !== null) return failure(optionsError);
  const reporter = new ProgressReporter(context.taskId, context.onProgress);
  reporter.emit(Stage.Validate, 1, OVERALL_VALIDATE);

  const assetRef: AssetRef = {
    assetId: request.asset.ref.assetId,
    revision: request.asset.ref.revision,
  };

  // Consent gate (:421): llmConsent=false or a missing provider configuration
  // must not send any request; the call degrades straight into click mode.
  if (!request.llmConsent || request.llm === null) {
    reporter.complete(0, 0);
    return { ok: true, value: clickModeResult(assetRef, null, DegradedReason.LlmUnavailable, []) };
  }

  // L1 semantic locate with consent; the whole LLM stage may fail into click mode.
  reporter.emit(Stage.SemanticLocate, 0, OVERALL_VALIDATE);
  const located = await locatePartsWithLlm(
    {
      asset: assetRef,
      image: request.image,
      provider: request.llm,
      userConsent: true,
      options: request.options,
    },
    llmTransport,
    context,
  );
  if (context.isCancelled()) return failure(cancelled(Stage.SemanticLocate));
  if (!located.ok) {
    reporter.complete(0, 0);
    return {
      ok: true,
      value: clickModeResult(assetRef, null, DegradedReason.LlmFailed, [
        warning(WarningCode.LlmFallbackToClick, []),
      ]),
    };
  }
  reporter.emit(Stage.SemanticLocate, 1, OVERALL_LOCATE_END);

  const document = located.value.document;
  if (!document.humanoid.isHumanoid) {
    reporter.complete(0, 0);
    return {
      ok: true,
      value: clickModeResult(assetRef, document.humanoid, DegradedReason.NonHumanoid, [
        warning(WarningCode.NonHumanoidClickMode, []),
      ]),
    };
  }
  if (document.humanoid.confidence < request.options.minimumPartConfidence) {
    reporter.complete(0, 0);
    return {
      ok: true,
      value: clickModeResult(assetRef, document.humanoid, DegradedReason.LowSemanticConfidence, [
        warning(WarningCode.LlmFallbackToClick, []),
      ]),
    };
  }

  // L2 SAM refinement of the validated proposals.
  const session = createSamSession(request.model, request.runtime, samBackend);
  const prepared = await prepareSession(session, request.asset, reporter, context);
  if (prepared !== null) return failure(prepared);
  const parts: PartAsset[] = [];
  const warnings: CharacterWarning[] = [];
  const confidences: number[] = [];
  const proposals = document.parts;
  for (let index = 0; index < proposals.length; index++) {
    const proposal = proposals[index];
    if (proposal === undefined) break;
    if (context.isCancelled()) return failure(cancelled(Stage.PromptInference));
    const overall =
      OVERALL_EMBED_END +
      (OVERALL_PROMPT_END - OVERALL_EMBED_END) * ((index + 1) / Math.max(1, proposals.length));
    reporter.emit(
      Stage.PromptInference,
      (index + 1) / Math.max(1, proposals.length),
      overall,
      index,
      proposals.length,
    );
    const outcome = await segmentOnePart(
      session,
      request.asset,
      proposal.kind,
      proposal.name,
      { type: "box", box: proposal.box, points: [] },
      request.options.minimumMaskConfidence,
      context,
    );
    if (!outcome.ok) return failure(outcome.error);
    parts.push(outcome.value.part);
    warnings.push(...outcome.value.warnings);
    confidences.push(outcome.value.confidence);
  }
  reporter.emit(Stage.MaskPostprocess, 1, OVERALL_PROMPT_END, parts.length, proposals.length);
  reporter.complete(parts.length, proposals.length);
  return {
    ok: true,
    value: {
      asset: assetRef,
      mode: "semantic",
      humanoid: document.humanoid,
      parts,
      confidence: meanConfidence(confidences),
      degraded: null,
      warnings,
    },
  };
}

/**
 * Click segmentation: creates anonymous parts from caller prompts via the SAM
 * session; part IDs are generated inside the package (never by the caller).
 */
export async function segmentByPrompts(
  request: RequestedClickSegmentation,
  samBackend: SamInferenceBackend,
  context: CharacterExecutionContext,
): Promise<CharacterOutcome<SegmentationResult>> {
  if (context.isCancelled()) return failure(cancelled(Stage.Validate));
  const assetError = validateAssetShape(request.asset);
  if (assetError !== null) return failure(assetError);
  const modelError =
    validateManifestShape(request.model) ?? validateRuntimeOptions(request.runtime);
  if (modelError !== null) return failure(modelError);
  const prompts = request.initialPrompts;
  if (!Array.isArray(prompts)) {
    return failure(
      orchestrationError(Code.InvalidArgument, Stage.Validate, {
        details: { field: "initialPrompts" },
      }),
    );
  }
  for (let index = 0; index < prompts.length; index++) {
    const entry = prompts[index];
    if (
      typeof entry !== "object" ||
      entry === null ||
      !isPartKind(entry.kind) ||
      typeof entry.name !== "string" ||
      entry.name.length === 0 ||
      typeof entry.prompt !== "object" ||
      entry.prompt === null
    ) {
      return failure(
        orchestrationError(Code.InvalidArgument, Stage.Validate, {
          details: { field: `initialPrompts[${index}]` },
        }),
      );
    }
  }
  const reporter = new ProgressReporter(context.taskId, context.onProgress);
  reporter.emit(Stage.Validate, 1, OVERALL_VALIDATE);
  const assetRef: AssetRef = {
    assetId: request.asset.ref.assetId,
    revision: request.asset.ref.revision,
  };

  const session = createSamSession(request.model, request.runtime, samBackend);
  const prepared = await prepareSession(session, request.asset, reporter, context);
  if (prepared !== null) return failure(prepared);
  const parts: PartAsset[] = [];
  const warnings: CharacterWarning[] = [];
  const confidences: number[] = [];
  for (let index = 0; index < prompts.length; index++) {
    const entry = prompts[index];
    if (entry === undefined) break;
    if (context.isCancelled()) return failure(cancelled(Stage.PromptInference));
    const overall =
      OVERALL_EMBED_END +
      (OVERALL_PROMPT_END - OVERALL_EMBED_END) * ((index + 1) / Math.max(1, prompts.length));
    reporter.emit(
      Stage.PromptInference,
      (index + 1) / Math.max(1, prompts.length),
      overall,
      index,
      prompts.length,
    );
    const outcome = await segmentOnePart(
      session,
      request.asset,
      entry.kind,
      entry.name,
      entry.prompt,
      null,
      context,
    );
    if (!outcome.ok) return failure(outcome.error);
    parts.push(outcome.value.part);
    warnings.push(...outcome.value.warnings);
    confidences.push(outcome.value.confidence);
  }
  reporter.emit(Stage.MaskPostprocess, 1, OVERALL_PROMPT_END, parts.length, prompts.length);
  reporter.complete(parts.length, prompts.length);
  return {
    ok: true,
    value: {
      asset: assetRef,
      mode: "click",
      humanoid: null,
      parts,
      confidence: meanConfidence(confidences),
      degraded: null,
      warnings,
    },
  };
}
