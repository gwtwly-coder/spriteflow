// Character Worker：segment 编排全部跑在 Worker 内——createOnnxSamBackend +
// createFetchLlmTransport + locatePartsWithLlm/segmentSemantically/segmentByPrompts
// 经 @spriteflow/segment 公共 API 组合；key 仅在此处进 LLM 请求（契约 :333）；
// CharacterProgressEvent 各 stage 经 Comlink 回传主线程真实呈现；取消经
// 生成令牌联动（不用 AbortSignal，根入口契约）。

import type { InputAsset, Rect } from "@spriteflow/pipeline";
import type {
  BitMask,
  CharacterError,
  CharacterExecutionContext,
  CharacterProgressEvent,
  LlmImage,
  LlmTransport,
  PartExportResult,
  SamExecutionProvider,
  SamInferenceBackend,
  SamPrompt,
  SamSession,
} from "@spriteflow/segment";
import {
  createSamSession,
  DEFAULT_CHARACTER_LIMITS,
  DEFAULT_SAM_RUNTIME_OPTIONS,
  DEFAULT_SEGMENTATION_OPTIONS,
  exportPartAssets,
  segmentSemantically,
} from "@spriteflow/segment";
import {
  createFetchLlmTransport,
  createOnnxSamBackend,
  getApprovedSamManifest,
} from "@spriteflow/segment/browser";
import { expose } from "comlink";
import type {
  CharacterExportInput,
  CharacterExportOutput,
  CharacterLoadInput,
  CharacterLoadOutput,
  CharacterPrepareInput,
  CharacterPrepareOutput,
  CharacterRefineInput,
  CharacterRefineOutput,
  CharacterRunInput,
  CharacterRunOutput,
  CharacterWorkerApi,
  LlmFailureReason,
} from "../character/character-protocol";
import { createPartExportCodec } from "../character/part-codec";

// 审批清单（packages/segment 冻结注册表）中的产品模型档位 id（fp16 单档）。
const SAM_ENCODER_MODEL_ID = "sam2.1-hiera-tiny-encoder-fp16";
const SAM_DECODER_MODEL_ID = "sam2.1-hiera-tiny-decoder-fp16";
const LLM_IMAGE_MAX_DIMENSION = 1024;

let asset: InputAsset | null = null;
let backend: SamInferenceBackend | null = null;
let session: SamSession | null = null;
let activeToken: { cancelled: boolean } | null = null;
let lastLlmStatus = 0;
let lastLlmThrew = false;

function token(): { cancelled: boolean } {
  const entry = { cancelled: false };
  activeToken = entry;
  return entry;
}

function context(
  taskId: string,
  entry: { cancelled: boolean },
  onProgress?: (event: CharacterProgressEvent) => void,
): CharacterExecutionContext {
  return {
    taskId,
    isCancelled: () => entry.cancelled,
    yieldControl: async () => {},
    onProgress: onProgress ?? (() => {}),
    limits: DEFAULT_CHARACTER_LIMITS,
  };
}

function manifest(): ReturnType<typeof getApprovedSamManifest> {
  return getApprovedSamManifest(SAM_ENCODER_MODEL_ID);
}

/** 工作图 → LlmImage（最长边 ≤1024 的 PNG dataUrl，供语义定位外发）。 */
async function buildLlmImage(source: InputAsset): Promise<LlmImage> {
  const { width, height } = source.pixels;
  const scale = Math.min(1, LLM_IMAGE_MAX_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const full = new OffscreenCanvas(width, height);
  const fullContext = full.getContext("2d");
  if (!fullContext) throw new Error("canvas unavailable");
  fullContext.putImageData(
    new ImageData(new Uint8ClampedArray(source.pixels.data), width, height),
    0,
    0,
  );
  const scaled = new OffscreenCanvas(targetWidth, targetHeight);
  const scaledContext = scaled.getContext("2d");
  if (!scaledContext) throw new Error("canvas unavailable");
  scaledContext.drawImage(full, 0, 0, targetWidth, targetHeight);
  const blob = await scaled.convertToBlob({ type: "image/png" });
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  return { mime: "image/png", dataUrl, width: targetWidth, height: targetHeight };
}

/** 记录 transport 层失败形态，供 LLM 失败原因分类（llm.error.*，AC-V02-C）。 */
function classifyingTransport(): LlmTransport {
  const inner = createFetchLlmTransport();
  return {
    async send(request, sendContext) {
      lastLlmThrew = false;
      try {
        const response = await inner.send(request, sendContext);
        lastLlmStatus = response.status;
        return response;
      } catch (error) {
        lastLlmThrew = true;
        throw error;
      }
    },
  };
}

function classifyLlmFailure(): LlmFailureReason {
  if (lastLlmThrew) return "network";
  if (lastLlmStatus === 401 || lastLlmStatus === 403) return "unauthorized";
  if (lastLlmStatus === 429) return "rate_limited";
  if (lastLlmStatus >= 500) return "network";
  return "bad_response";
}

const api: CharacterWorkerApi = {
  async load(input: CharacterLoadInput): Promise<CharacterLoadOutput> {
    const bitmap = await createImageBitmap(new Blob([input.bytes], { type: input.mime }));
    try {
      const scale =
        input.resizeTo === null ? 1 : input.resizeTo.width / Math.max(bitmap.width, bitmap.height);
      const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
      const targetHeight = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const drawContext = canvas.getContext("2d", { colorSpace: "srgb" });
      if (!drawContext) throw new Error("canvas unavailable");
      drawContext.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      const imageData = drawContext.getImageData(0, 0, targetWidth, targetHeight);
      asset = {
        ref: input.ref,
        name: input.name,
        sourceMime: input.mime,
        originalSize: { width: bitmap.width, height: bitmap.height },
        pixels: {
          width: targetWidth,
          height: targetHeight,
          format: "rgba8",
          colorSpace: "srgb",
          alphaMode: "straight",
          data: new Uint8ClampedArray(imageData.data),
        },
        scaleFromOriginal: { x: scale, y: scale },
      };
      return {
        ok: true,
        workingSize: { width: targetWidth, height: targetHeight },
        imageSource: { width: targetWidth, height: targetHeight },
      };
    } finally {
      bitmap.close();
    }
  },

  async run(input: CharacterRunInput): Promise<CharacterRunOutput> {
    if (asset === null) return { ok: false, error: busyError("INVALID_STATE") };
    if (activeToken !== null) return { ok: false, error: busyError("BUSY") };
    const currentManifest = manifest();
    if (currentManifest === null) return { ok: false, error: busyError("MODEL_NOT_APPROVED") };
    const entry = token();
    backend ??= createOnnxSamBackend();
    lastLlmStatus = 0;
    lastLlmThrew = false;
    try {
      const image = await buildLlmImage(asset);
      const located = await segmentSemantically(
        {
          asset,
          image,
          llm: input.llm,
          llmConsent: input.consent,
          model: currentManifest,
          options: { ...DEFAULT_SEGMENTATION_OPTIONS },
          runtime: { ...DEFAULT_SAM_RUNTIME_OPTIONS },
        },
        classifyingTransport(),
        backend,
        context("character-run", entry, input.onProgress),
      );
      if (!located.ok) {
        return { ok: false, error: located.error, llmFailure: classifyLlmFailure() };
      }
      const degradedLlm = located.value.degraded?.reason === "LLM_FAILED";
      return {
        ok: true,
        result: located.value,
        ...(degradedLlm ? { llmFailure: classifyLlmFailure() } : {}),
      };
    } catch {
      return { ok: false, error: busyError("INTERNAL_ERROR") };
    } finally {
      activeToken = null;
    }
  },

  async prepare(input: CharacterPrepareInput): Promise<CharacterPrepareOutput> {
    if (activeToken !== null) return { ok: false, error: busyError("BUSY") };
    const currentManifest = manifest();
    if (currentManifest === null) return { ok: false, error: busyError("MODEL_NOT_APPROVED") };
    const entry = token();
    backend ??= createOnnxSamBackend();
    session ??= createSamSession(currentManifest, { ...DEFAULT_SAM_RUNTIME_OPTIONS }, backend);
    try {
      const executionContext = context("character-prepare", entry, input.onProgress);
      const initialized = await session.initialize(executionContext);
      if (!initialized.ok) return { ok: false, error: initialized.error };
      if (asset !== null) {
        const embedded = await session.setImage(asset, executionContext);
        if (!embedded.ok) return { ok: false, error: embedded.error };
      }
      const webgpuFallback = initialized.value.warnings.some(
        (warning) => warning.code === "WEBGPU_FALLBACK_TO_WASM",
      );
      return {
        ok: true,
        provider: initialized.value.provider as SamExecutionProvider,
        cachedModel: initialized.value.cachedModel,
        webgpuFallback,
      };
    } finally {
      activeToken = null;
    }
  },

  async refine(input: CharacterRefineInput): Promise<CharacterRefineOutput> {
    if (session === null || asset === null) return { ok: false, error: busyError("INVALID_STATE") };
    if (activeToken !== null) return { ok: false, error: busyError("BUSY") };
    const entry = token();
    try {
      const prompt: SamPrompt =
        input.prompt.box !== null
          ? { type: "box", box: input.prompt.box, points: input.prompt.points }
          : { type: "points", points: input.prompt.points, box: null };
      const result = await session.segment(prompt, context("character-refine", entry));
      if (!result.ok) return { ok: false, error: result.error };
      const mask: BitMask = {
        width: result.value.mask.width,
        height: result.value.mask.height,
        encoding: result.value.mask.encoding,
        data: result.value.mask.data,
      };
      const sourceRect: Rect = { ...result.value.sourceRect };
      return { ok: true, mask, sourceRect, predictedIou: result.value.predictedIou };
    } finally {
      activeToken = null;
    }
  },

  async exportParts(input: CharacterExportInput): Promise<CharacterExportOutput> {
    if (asset === null) return { ok: false, error: busyError("INVALID_STATE") };
    if (activeToken !== null) return { ok: false, error: busyError("BUSY") };
    const entry = token();
    try {
      const outcome = await exportPartAssets(
        asset,
        input.parts,
        { names: input.names },
        createPartExportCodec(),
        context("character-export", entry, input.onProgress),
      );
      if (!outcome.ok) return { ok: false, error: outcome.error };
      const result: PartExportResult = outcome.value;
      return { ok: true, result };
    } finally {
      activeToken = null;
    }
  },

  cancel(): void {
    if (activeToken !== null) activeToken.cancelled = true;
  },

  modelBytes(): number {
    let total = 0;
    for (const id of [SAM_ENCODER_MODEL_ID, SAM_DECODER_MODEL_ID]) {
      const entry = getApprovedSamManifest(id);
      if (entry) total += entry.byteLength;
    }
    return total;
  },

  async dispose(): Promise<void> {
    if (activeToken !== null) activeToken.cancelled = true;
    asset = null;
    if (session) {
      await session.dispose();
      session = null;
    }
    if (backend) {
      await backend.dispose();
      backend = null;
    }
  },
};

function busyError(
  code: "BUSY" | "INVALID_STATE" | "MODEL_NOT_APPROVED" | "INTERNAL_ERROR",
): CharacterError {
  return {
    code,
    messageKey: `character.error.${code}`,
    stage: "validate",
    recoverable: code !== "MODEL_NOT_APPROVED",
    recoveryActions: [],
    details: {},
  } as CharacterError;
}

expose(api);
