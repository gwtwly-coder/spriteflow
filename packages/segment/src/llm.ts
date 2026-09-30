// L1 semantic locate over a BYOK Chat Completions transport
// (docs/interface-contract-v3.md section 3, :329-424). Pure Node-testable logic:
// the transport is injected, no fetch/DOM/AbortSignal appears here, and no real
// network request is ever made by this package.
import { characterError, failure } from "./errors.js";
import type { AssetRef } from "./m1.js";
import { isPartKind } from "./partAsset.js";
import type { LlmImage } from "./types.js";
import {
  type CharacterError,
  CharacterErrorCode,
  type CharacterExecutionContext,
  type CharacterLimits,
  type CharacterOutcome,
  type CharacterRecoveryAction,
  CharacterStage,
  type HumanoidAssessment,
  type LlmChatRequest,
  type LlmChatResponse,
  type LlmLocateDocument,
  type LlmLocateRequest,
  type LlmLocateResult,
  type LlmProviderConfig,
  type LlmTransport,
  PartKind,
  type SegmentationOptions,
} from "./types.js";

// --- Contract ranges (section 3, :421) ----------------------------------------

const TIMEOUT_MS_MIN = 1_000;
const TIMEOUT_MS_MAX = 8_000;
const MAX_RESPONSE_BYTES_MIN = 1;
const MAX_RESPONSE_BYTES_MAX = 1_048_576;
const MAX_OUTPUT_TOKENS_MIN = 128;
const MAX_OUTPUT_TOKENS_MAX = 4_096;
const ENDPOINT_MAX_LENGTH = 2_048;
const MODEL_MAX_LENGTH = 128;
const API_KEY_MAX_LENGTH = 4_096;
const OPTIONS_MAX_PARTS_MAX = 32;
const OPTIONS_MODEL_DIMENSION_MIN = 256;
const OPTIONS_MODEL_DIMENSION_MAX = 1024;

const PARTS_MIN_COUNT = 1;
const REPAIR_ORIGINAL_TEXT_MAX_CHARS = 2_000;
const MAX_SCHEMA_ERRORS = 20;
const SCHEMA_ERROR_MAX_CHARS = 200;

const SCHEMA_VERSION = "spriteflow-parts/1" as const;
const COORDINATE_SPACE = "working-pixels-top-left-half-open" as const;
const HUMANOID_REASONS: ReadonlySet<string> = new Set(["humanoid", "non-humanoid", "uncertain"]);
const MIME_PREFIXES: ReadonlyMap<string, string> = new Map([
  ["image/png", "data:image/png;base64,"],
  ["image/webp", "data:image/webp;base64,"],
]);

const PART_KIND_LIST = Object.values(PartKind).join(", ");
const LOCATE_SYSTEM_PROMPT = [
  "You detect character parts on a sprite image. Reply with exactly one JSON document and nothing else.",
  'Required shape: {"schemaVersion":"spriteflow-parts/1","coordinateSpace":"working-pixels-top-left-half-open",',
  '"humanoid":{"isHumanoid":boolean,"confidence":number,"reason":"humanoid"|"non-humanoid"|"uncertain"},',
  '"parts":[{"kind":PartKind,"name":string,"box":{"x":int,"y":int,"width":int,"height":int},"confidence":number,"occluded":boolean}]}',
  `PartKind is a closed enum, exactly one of: ${PART_KIND_LIST}.`,
  "Boxes are integer half-open working-pixel rects: 0<=x, 0<=y, width>=1, height>=1, x+width<=imageWidth, y+height<=imageHeight.",
  "confidence is a finite number in [0,1]. Provide 1..maxParts parts; kind+name pairs must be unique.",
  "Do not wrap the JSON in markdown fences and do not add commentary.",
].join("\n");

// --- Error helpers (stage is always semantic-locate here) ----------------------

type LocateErrorOptions = {
  recoveryActions?: CharacterRecoveryAction[];
  details?: CharacterError["details"];
};

function locateError(code: CharacterErrorCode, options: LocateErrorOptions = {}): CharacterError {
  return characterError(code, CharacterStage.SemanticLocate, options);
}

function providerHost(endpoint: string): string {
  const schemeIndex = endpoint.indexOf("://");
  const afterScheme = schemeIndex === -1 ? endpoint : endpoint.slice(schemeIndex + 3);
  const terminator = afterScheme.search(/[/?#]/);
  const authority = terminator === -1 ? afterScheme : afterScheme.slice(0, terminator);
  const at = authority.lastIndexOf("@");
  const host = at === -1 ? authority : authority.slice(at + 1);
  return host.slice(0, 128);
}

function isAuthorityLocalhost(authority: string): boolean {
  return (
    authority === "localhost" ||
    authority.startsWith("localhost:") ||
    authority === "127.0.0.1" ||
    authority.startsWith("127.0.0.1:") ||
    authority === "[::1]" ||
    authority.startsWith("[::1]:")
  );
}

// HTTPS is mandatory; plain http is tolerated only for development localhost.
function endpointShapeIsValid(endpoint: string): boolean {
  if (endpoint.length === 0 || endpoint.length > ENDPOINT_MAX_LENGTH) return false;
  const scheme = endpoint.startsWith("https://")
    ? "https"
    : endpoint.startsWith("http://")
      ? "http"
      : null;
  if (scheme === null) return false;
  if (endpoint.includes("#")) return false;
  const afterScheme = endpoint.slice(scheme.length + 3);
  const terminator = afterScheme.search(/[/?#]/);
  const authority = terminator === -1 ? afterScheme : afterScheme.slice(0, terminator);
  if (authority.includes("@")) return false;
  if (scheme === "http" && !isAuthorityLocalhost(authority)) return false;
  return true;
}

function validateProviderConfig(
  config: LlmProviderConfig,
  limits: CharacterLimits,
): CharacterError | null {
  const bad = (field: string, limit?: number, actual?: number) =>
    locateError(CharacterErrorCode.LlmConfigurationInvalid, {
      recoveryActions: ["configure-key", "continue-click-mode"],
      details: {
        field,
        ...(limit !== undefined ? { limit } : {}),
        ...(actual !== undefined ? { actual } : {}),
      },
    });
  if (typeof config.endpoint !== "string" || !endpointShapeIsValid(config.endpoint)) {
    return bad("provider.endpoint", ENDPOINT_MAX_LENGTH, config.endpoint?.length ?? 0);
  }
  if (
    typeof config.model !== "string" ||
    config.model.length === 0 ||
    config.model.length > MODEL_MAX_LENGTH
  ) {
    return bad("provider.model", MODEL_MAX_LENGTH, config.model?.length ?? 0);
  }
  if (
    typeof config.apiKey !== "string" ||
    config.apiKey.length === 0 ||
    config.apiKey.length > API_KEY_MAX_LENGTH
  ) {
    return bad("provider.apiKey", API_KEY_MAX_LENGTH, config.apiKey?.length ?? 0);
  }
  if (
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < TIMEOUT_MS_MIN ||
    config.timeoutMs > TIMEOUT_MS_MAX
  ) {
    return bad("provider.timeoutMs", TIMEOUT_MS_MAX, config.timeoutMs);
  }
  if (
    !Number.isInteger(config.maxResponseBytes) ||
    config.maxResponseBytes < MAX_RESPONSE_BYTES_MIN ||
    config.maxResponseBytes > MAX_RESPONSE_BYTES_MAX ||
    config.maxResponseBytes > limits.maxLlmResponseBytes
  ) {
    return bad(
      "provider.maxResponseBytes",
      Math.min(MAX_RESPONSE_BYTES_MAX, limits.maxLlmResponseBytes),
      config.maxResponseBytes,
    );
  }
  if (
    !Number.isInteger(config.maxOutputTokens) ||
    config.maxOutputTokens < MAX_OUTPUT_TOKENS_MIN ||
    config.maxOutputTokens > MAX_OUTPUT_TOKENS_MAX
  ) {
    return bad("provider.maxOutputTokens", MAX_OUTPUT_TOKENS_MAX, config.maxOutputTokens);
  }
  return null;
}

function validateImage(image: LlmImage, limits: CharacterLimits): CharacterError | null {
  if (typeof image.mime !== "string" || !MIME_PREFIXES.has(image.mime)) {
    return locateError(CharacterErrorCode.InvalidArgument, { details: { field: "image.mime" } });
  }
  const prefix = MIME_PREFIXES.get(image.mime) ?? "";
  if (
    typeof image.dataUrl !== "string" ||
    !image.dataUrl.startsWith(prefix) ||
    image.dataUrl.length <= prefix.length
  ) {
    return locateError(CharacterErrorCode.InvalidArgument, { details: { field: "image.dataUrl" } });
  }
  if (
    !Number.isInteger(image.width) ||
    image.width < 1 ||
    image.width > limits.maxWorkingDimension ||
    !Number.isInteger(image.height) ||
    image.height < 1 ||
    image.height > limits.maxWorkingDimension
  ) {
    return locateError(CharacterErrorCode.InvalidArgument, {
      details: { field: "image.size", limit: limits.maxWorkingDimension },
    });
  }
  if (image.width * image.height > limits.maxWorkingPixels) {
    return locateError(CharacterErrorCode.ResourceLimit, {
      recoveryActions: ["reduce-image-size"],
      details: {
        field: "image.size",
        limit: limits.maxWorkingPixels,
        actual: image.width * image.height,
      },
    });
  }
  return null;
}

function validateAssetRef(ref: AssetRef): CharacterError | null {
  if (
    typeof ref !== "object" ||
    ref === null ||
    typeof ref.assetId !== "string" ||
    ref.assetId.length === 0 ||
    !Number.isInteger(ref.revision) ||
    ref.revision < 0
  ) {
    return locateError(CharacterErrorCode.InvalidArgument, { details: { field: "asset" } });
  }
  return null;
}

function validateOptions(
  options: SegmentationOptions,
  limits: CharacterLimits,
): CharacterError | null {
  const bad = (field: string, limit?: number, actual?: number) =>
    locateError(CharacterErrorCode.InvalidArgument, {
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
    options.maxParts < PARTS_MIN_COUNT ||
    options.maxParts > OPTIONS_MAX_PARTS_MAX
  ) {
    return bad("options.maxParts", OPTIONS_MAX_PARTS_MAX, options?.maxParts);
  }
  if (options.maxParts > limits.maxParts) {
    return locateError(CharacterErrorCode.ResourceLimit, {
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
    return bad(
      "options.modelInputMaxDimension",
      OPTIONS_MODEL_DIMENSION_MAX,
      options.modelInputMaxDimension,
    );
  }
  if (typeof options.preserveSmallParts !== "boolean") {
    return bad("options.preserveSmallParts");
  }
  return null;
}

// --- Chat request building ------------------------------------------------------

type MessageContent = LlmChatRequest["body"]["messages"][number]["content"];

function buildChatRequest(
  config: LlmProviderConfig,
  userContent: MessageContent,
  systemPrompt: string,
): LlmChatRequest {
  // The API key only travels inside the outgoing request's authorization header;
  // it never appears in results, warnings, logs or error details.
  return {
    endpoint: config.endpoint,
    model: config.model,
    authorization: `Bearer ${config.apiKey}`,
    timeoutMs: config.timeoutMs,
    maxResponseBytes: config.maxResponseBytes,
    body: {
      model: config.model,
      temperature: 0,
      max_tokens: config.maxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    },
  };
}

// --- Strict JSON/schema parsing -------------------------------------------------

function stripSingleCodeFence(raw: string): string {
  let text = raw.trim();
  if (!text.startsWith("```")) return text;
  const firstBreak = text.indexOf("\n");
  if (firstBreak === -1) return text;
  text = text.slice(firstBreak + 1);
  const closing = text.lastIndexOf("```");
  if (closing === -1) return text;
  if (text.slice(closing + 3).trim() !== "") return text;
  return text.slice(0, closing).trim();
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

export type LocateDocumentParse =
  | { ok: true; document: LlmLocateDocument }
  | { ok: false; errors: string[] };

/**
 * Strict single-document parser: strips at most one leading+trailing markdown code
 * fence, then validates every schema item from section 3 (:419). Never guesses
 * fields from surrounding natural language.
 */
export function parseLocateDocument(
  text: string,
  imageWidth: number,
  imageHeight: number,
  options: SegmentationOptions,
): LocateDocumentParse {
  const stripped = stripSingleCodeFence(text);
  let value: unknown;
  try {
    value = JSON.parse(stripped);
  } catch {
    return { ok: false, errors: ["response is not a single JSON document"] };
  }
  if (!isObject(value)) {
    return { ok: false, errors: ["top-level value is not a JSON object"] };
  }
  const errors: string[] = [];
  const fail = (message: string) => {
    if (errors.length < MAX_SCHEMA_ERRORS) errors.push(message.slice(0, SCHEMA_ERROR_MAX_CHARS));
  };
  if (value.schemaVersion !== SCHEMA_VERSION) {
    fail(`schemaVersion: expected "${SCHEMA_VERSION}"`);
  }
  if (value.coordinateSpace !== COORDINATE_SPACE) {
    fail(`coordinateSpace: expected "${COORDINATE_SPACE}"`);
  }
  const humanoid: unknown = value.humanoid;
  if (!isObject(humanoid)) {
    fail("humanoid: expected object");
  } else {
    if (typeof humanoid.isHumanoid !== "boolean") fail("humanoid.isHumanoid: expected boolean");
    if (!isUnitInterval(humanoid.confidence)) fail("humanoid.confidence: expected number in [0,1]");
    if (typeof humanoid.reason !== "string" || !HUMANOID_REASONS.has(humanoid.reason)) {
      fail('humanoid.reason: expected "humanoid" | "non-humanoid" | "uncertain"');
    }
  }
  const parts: unknown = value.parts;
  if (!Array.isArray(parts)) {
    fail("parts: expected array");
  } else {
    if (parts.length < PARTS_MIN_COUNT || parts.length > options.maxParts) {
      fail(`parts: expected ${PARTS_MIN_COUNT}..${options.maxParts} parts, got ${parts.length}`);
    }
    const seenKinds = new Set<string>();
    parts.forEach((raw, index) => {
      if (!isObject(raw)) {
        fail(`parts[${index}]: expected object`);
        return;
      }
      if (!isPartKind(raw.kind)) fail(`parts[${index}].kind: unknown closed PartKind value`);
      if (typeof raw.name !== "string" || raw.name.length === 0) {
        fail(`parts[${index}].name: expected non-empty string`);
      }
      const box: unknown = raw.box;
      if (!isObject(box)) {
        fail(`parts[${index}].box: expected object`);
      } else {
        const { x, y, width, height } = box;
        if (!isInteger(x) || !isInteger(y) || !isInteger(width) || !isInteger(height)) {
          fail(`parts[${index}].box: x/y/width/height must be integers`);
        } else if (
          width < 1 ||
          height < 1 ||
          x < 0 ||
          y < 0 ||
          x + width > imageWidth ||
          y + height > imageHeight
        ) {
          fail(
            `parts[${index}].box: outside [0,${imageWidth}) x [0,${imageHeight}) half-open range`,
          );
        }
      }
      if (!isUnitInterval(raw.confidence))
        fail(`parts[${index}].confidence: expected number in [0,1]`);
      if (typeof raw.occluded !== "boolean") fail(`parts[${index}].occluded: expected boolean`);
      if (typeof raw.kind === "string" && typeof raw.name === "string") {
        const key = `${raw.kind}\n${raw.name}`;
        if (seenKinds.has(key)) fail(`parts[${index}]: duplicate kind+name combination`);
        seenKinds.add(key);
      }
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  const humanoidValue = value.humanoid as HumanoidAssessment;
  return {
    ok: true,
    document: {
      schemaVersion: SCHEMA_VERSION,
      coordinateSpace: COORDINATE_SPACE,
      humanoid: humanoidValue,
      parts: value.parts as LlmLocateDocument["parts"],
    },
  };
}

// --- Transport exchange ----------------------------------------------------------

type ExchangeOutcome =
  | { kind: "document"; document: LlmLocateDocument }
  | { kind: "invalid"; errors: string[]; originalText: string }
  | { kind: "error"; error: CharacterError };

function cancelledError(): CharacterError {
  return locateError(CharacterErrorCode.Cancelled, { recoveryActions: ["retry"] });
}

// Thrown transport failures are classified without ever embedding the error text:
// messages could carry endpoint URLs, query strings or SDK internals.
function classifyTransportFailure(error: unknown): CharacterErrorCode {
  const candidate = error as { name?: unknown; code?: unknown } | null;
  if (typeof candidate === "object" && candidate !== null) {
    if (candidate.code === "LLM_RESPONSE_TOO_LARGE") return CharacterErrorCode.LlmResponseTooLarge;
    if (
      candidate.code === "LLM_TIMEOUT" ||
      candidate.name === "TimeoutError" ||
      candidate.name === "AbortError"
    ) {
      return CharacterErrorCode.LlmTimeout;
    }
  }
  return CharacterErrorCode.LlmNetworkFailed;
}

function statusFailure(status: number, provider: string): CharacterError | null {
  const providerDetails = { provider };
  if (status === 401 || status === 403) {
    return locateError(CharacterErrorCode.LlmAuthenticationFailed, {
      recoveryActions: ["configure-key", "continue-click-mode"],
      details: providerDetails,
    });
  }
  if (status === 429) {
    return locateError(CharacterErrorCode.LlmRateLimited, {
      recoveryActions: ["retry", "continue-click-mode"],
      details: providerDetails,
    });
  }
  if (status < 200 || status >= 300) {
    return locateError(CharacterErrorCode.LlmNetworkFailed, {
      recoveryActions: ["retry", "continue-click-mode"],
      details: { ...providerDetails, actual: status },
    });
  }
  return null;
}

function extractBodyText(body: unknown): string | null {
  if (typeof body === "string") return body;
  if (isObject(body) || Array.isArray(body)) {
    try {
      return JSON.stringify(body);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Sends one chat request and returns either a validated document, a repairable
 * invalid-response record, or a terminal (non-repairable) error. 4xx/5xx, network,
 * timeout, cancellation and oversized responses never enter the JSON repair path.
 */
async function exchange(
  request: LlmChatRequest,
  config: LlmProviderConfig,
  provider: string,
  transport: LlmTransport,
  context: CharacterExecutionContext,
  imageWidth: number,
  imageHeight: number,
  options: SegmentationOptions,
): Promise<ExchangeOutcome> {
  await context.yieldControl();
  if (context.isCancelled()) return { kind: "error", error: cancelledError() };
  let response: LlmChatResponse;
  try {
    response = await transport.send(request, context);
  } catch (error: unknown) {
    return {
      kind: "error",
      error: locateError(classifyTransportFailure(error), {
        recoveryActions: ["retry", "continue-click-mode"],
        details: { provider },
      }),
    };
  }
  if (context.isCancelled()) return { kind: "error", error: cancelledError() };
  const statusError = statusFailure(response.status, provider);
  if (statusError !== null) return { kind: "error", error: statusError };
  const bodyText = extractBodyText(response.body);
  if (bodyText === null) {
    return {
      kind: "invalid",
      errors: ["response body: expected JSON text or object"],
      originalText: "",
    };
  }
  if (utf8ByteLength(bodyText) > config.maxResponseBytes) {
    return {
      kind: "error",
      error: locateError(CharacterErrorCode.LlmResponseTooLarge, {
        details: { provider, limit: config.maxResponseBytes },
      }),
    };
  }
  const parsed = parseLocateDocument(bodyText, imageWidth, imageHeight, options);
  if (parsed.ok) return { kind: "document", document: parsed.document };
  return { kind: "invalid", errors: parsed.errors, originalText: bodyText };
}

/**
 * Runs the L1 semantic locate exchange: at most one paid initial request plus at
 * most one schema-repair request (text only, no image). Returns the validated
 * document; the caller must not overwrite confirmed parts until this succeeds.
 */
export async function locatePartsWithLlm(
  request: LlmLocateRequest,
  transport: LlmTransport,
  context: CharacterExecutionContext,
): Promise<CharacterOutcome<LlmLocateResult>> {
  if (context.isCancelled()) {
    return failure(cancelledError());
  }
  if (request.userConsent !== true) {
    // Consent is checked at this entry point (:421); no request is ever sent
    // without the literal true.
    return failure(
      locateError(CharacterErrorCode.LlmConsentRequired, {
        recoveryActions: ["continue-click-mode"],
      }),
    );
  }
  const config = request.provider;
  const configError = validateProviderConfig(config, context.limits);
  if (configError !== null) return failure(configError);
  const assetError = validateAssetRef(request.asset);
  if (assetError !== null) return failure(assetError);
  const imageError = validateImage(request.image, context.limits);
  if (imageError !== null) return failure(imageError);
  const optionsError = validateOptions(request.options, context.limits);
  if (optionsError !== null) return failure(optionsError);

  const provider = providerHost(config.endpoint);
  const userText = `Detect the character parts in this ${request.image.width}x${request.image.height} working-pixel image. Reply with the JSON document only.`;
  const initialContent: MessageContent = [
    { type: "text", text: userText },
    { type: "image_url", image_url: { url: request.image.dataUrl, detail: "high" } },
  ];

  const first = await exchange(
    buildChatRequest(config, initialContent, LOCATE_SYSTEM_PROMPT),
    config,
    provider,
    transport,
    context,
    request.image.width,
    request.image.height,
    request.options,
  );
  if (first.kind === "document") {
    return { ok: true, value: { document: first.document, attempts: 1, repaired: false } };
  }
  if (first.kind === "error") return failure(first.error);

  // Single repair attempt: schema + truncated original text + field error summary;
  // never a second image, never a third request.
  if (context.isCancelled()) return failure(cancelledError());
  const repairUserText = [
    "Your previous reply failed JSON/schema validation. Field errors:",
    ...first.errors.map((error) => `- ${error}`),
    `Original reply (first ${REPAIR_ORIGINAL_TEXT_MAX_CHARS} characters):`,
    first.originalText.slice(0, REPAIR_ORIGINAL_TEXT_MAX_CHARS),
    "Return the corrected single JSON document only.",
  ].join("\n");
  const second = await exchange(
    buildChatRequest(config, repairUserText, LOCATE_SYSTEM_PROMPT),
    config,
    provider,
    transport,
    context,
    request.image.width,
    request.image.height,
    request.options,
  );
  if (second.kind === "document") {
    return { ok: true, value: { document: second.document, attempts: 2, repaired: true } };
  }
  if (second.kind === "error") return failure(second.error);
  return failure(
    locateError(CharacterErrorCode.LlmInvalidResponse, {
      recoveryActions: ["continue-click-mode"],
      details: { provider, field: "response", actual: 2 },
    }),
  );
}
