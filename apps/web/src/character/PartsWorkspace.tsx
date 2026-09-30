// v3 拆部位工作区（ui-spec §13）：W1 上传空状态 → W2 拆件过程 → W3 部位审校 →
// W4 导出抽屉。上传/预检复用 M1 管线（同规则同词条）；segment 编排跑在
// Character Worker 内；降级矩阵诚实呈现（AC-V06）；全部文案走 copy-v3 词条。

import {
  type PipelineClient,
  type PipelineError,
  PipelineErrorCode,
  type PixelBuffer,
} from "@spriteflow/pipeline";
import { createPipelineClient } from "@spriteflow/pipeline/browser";
import {
  type CharacterError,
  CharacterErrorCode,
  type CharacterProgressEvent,
  CharacterStage,
  createPartAsset,
  maskBounds,
  type PartExportResult,
  PartKind,
  type SegmentationDegradedReason,
  type SegmentationResult,
} from "@spriteflow/segment";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { errorCopy, ModeSwitch } from "../app/App";
import { type Locale, translate } from "../i18n";
import {
  clearKey,
  GLM_ENDPOINT,
  isValidEndpoint,
  loadByokState,
  presetEndpoint,
  saveByok,
} from "./byok";
import { getCharacterClient, resetCharacterClient } from "./character-client";
import type { CharacterPrepareOutput, LlmFailureReason } from "./character-protocol";
import { buildExportNames, partDisplayName } from "./kind-display";
import { llmFailureFromLlmCode } from "./llm-failure";
import { imageRectOfPart, PartsCanvas, partAtPoint } from "./PartsCanvas";
import { type ByokConfig, type PartsDegraded, usePartsStore } from "./parts-store";

type Modal =
  | "delete"
  | "rerun"
  | "consent"
  | "oversize"
  | "memory"
  | "byok"
  | "modelRetry"
  | "newFile"
  | "devVisual"
  | null;
type ExportDrawerState = "closed" | "form" | "processing" | "success" | "failure" | "invariant";
type Busy = "semantic" | "click" | "export" | null;
type ActiveTask = { cancel(): Promise<unknown> };

const WORKING_MAX_DIMENSION = 2048;

// 视觉调节面板仅开发构建可加载（§13.3：生产零入口——动态 import 分支被
// import.meta.env.DEV=false 消除后，该 chunk 不会进入生产包）。
const DevVisualPanel = import.meta.env.DEV ? lazy(() => import("./dev-visual-panel")) : null;

const t = (
  locale: Locale,
  key: Parameters<typeof translate>[1],
  values?: Record<string, string | number>,
) => translate(locale, key, values);

/**
 * Worker 调用在传输层意外拒绝（如 Comlink postMessage 失败）时的兜底错误。
 * 没有这个兜底，拒绝会变成未处理的 promise rejection：busy 永不清除，UI
 * 永久停留在假"进行中"（2026-09-30 RC P1 的渲染侧放大器）。
 */
function transportModelError(): CharacterError {
  return {
    code: CharacterErrorCode.InternalError,
    messageKey: "character.error.INTERNAL_ERROR",
    stage: CharacterStage.ModelInitialize,
    recoverable: true,
    recoveryActions: [],
    details: {},
  };
}

const DEGRADED_BANNER: Record<
  SegmentationDegradedReason,
  { title: Parameters<typeof translate>[1]; body: Parameters<typeof translate>[1] }
> = {
  NON_HUMANOID: { title: "parts.fallback.nonhuman.title", body: "parts.fallback.nonhuman.body" },
  LLM_FAILED: { title: "parts.fallback.llm_failed.title", body: "parts.fallback.llm_failed.body" },
  LLM_UNAVAILABLE: { title: "parts.fallback.nokey.title", body: "parts.fallback.nokey.body" },
  LOW_SEMANTIC_CONFIDENCE: {
    title: "parts.fallback.llm_failed.title",
    body: "parts.fallback.llm_failed.body",
  },
};

const DEGRADED_MAP: Record<SegmentationDegradedReason, PartsDegraded> = {
  NON_HUMANOID: "non-humanoid",
  LLM_FAILED: "llm-failed",
  LLM_UNAVAILABLE: "no-key",
  LOW_SEMANTIC_CONFIDENCE: "low-confidence",
};

const DEFAULT_MODELS: Record<ByokConfig["provider"], string> = {
  glm_4v: "glm-4v",
  cogvlm: "cogvlm-2",
  openai_gpt: "gpt-4o",
  custom: "",
};

/** L1 失败卡（AC-V02-C 四分类）的唯一映射：llm-failure.ts（错误码权威，status 兜底）。 */

export function PartsWorkspace({
  locale,
  setLocale,
  onSwitchRequest,
  onDirtyChange,
}: {
  locale: Locale;
  setLocale(locale: Locale): void;
  onSwitchRequest(target: "slicer" | "parts"): void;
  onDirtyChange(dirty: boolean): void;
}) {
  const store = usePartsStore();
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<CharacterProgressEvent | null>(null);
  const [refining, setRefining] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [modelError, setModelError] = useState<CharacterError | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PixelBuffer | null>(null);
  const [assetRef, setAssetRef] = useState<{ assetId: string; revision: number } | null>(null);
  const [preflight, setPreflight] = useState<"idle" | "preflight" | "decode" | "ready">("idle");
  const [pipelineError, setPipelineError] = useState<PipelineError | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [downscale, setDownscale] = useState(WORKING_MAX_DIMENSION);
  const [exportState, setExportState] = useState<ExportDrawerState>("closed");
  const [exportResult, setExportResult] = useState<PartExportResult | null>(null);
  const [modelSizeMb, setModelSizeMb] = useState(0);
  const taskRef = useRef<ActiveTask | null>(null);
  const clientRef = useRef<PipelineClient | null>(null);
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  };
  const dirty =
    store.parts.length > 0 || store.screen !== "upload" || file !== null || busy !== null;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  // 挂载：恢复 BYOK 配置（key 仅在显式勾选后于 sessionStorage，关闭即清）+ 模型体积。
  useEffect(() => {
    const stored = loadByokState();
    if (stored.config && stored.key) usePartsStore.getState().setByok(stored.config);
    void getCharacterClient()
      .modelBytes()
      .then((bytes) => setModelSizeMb(Math.round(bytes / 1_000_000)))
      .catch(() => setModelSizeMb(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 卸载（含工作区切换）：取消任务 + 清 key + 重置 v3 会话（AC-V01-C）。
  useEffect(
    () => () => {
      taskRef.current?.cancel();
      void clientRef.current?.dispose();
      void resetCharacterClient();
      clearKey();
      usePartsStore.getState().resetAll();
      usePartsStore.temporal.getState().clear();
    },
    [],
  );
  const pipeline = async () => {
    if (clientRef.current) return clientRef.current;
    const worker = new Worker(new URL("../workers/pipeline.worker.ts", import.meta.url), {
      type: "module",
    });
    const created = createPipelineClient(worker);
    const ready = await created.ready;
    if (!ready.ok) throw ready.error;
    clientRef.current = created;
    return created;
  };
  const pipelineSubmit = async (command: "load", payload: unknown): Promise<unknown> => {
    const pipelineClient = await pipeline();
    const invoke = pipelineClient.submit as unknown as (
      name: string,
      value: unknown,
      progress?: (event: never) => void,
    ) => {
      result: Promise<{ outcome: { ok: boolean; value?: unknown; error?: PipelineError } }>;
      cancel(): Promise<unknown>;
    };
    const task = invoke(command, payload);
    taskRef.current = task;
    try {
      const response = await task.result;
      if (!response.outcome.ok) throw response.outcome.error;
      return response.outcome.value;
    } finally {
      if (taskRef.current === task) taskRef.current = null;
    }
  };
  const character = () => getCharacterClient();
  const providerLabel = () =>
    store.byok ? t(locale, `llm.provider.${store.byok.provider}` as never) : "";
  const buildLlmConfig = () => {
    const stored = loadByokState();
    if (!store.byok || !stored.key) return null;
    return {
      endpoint: store.byok.endpoint,
      model: store.byok.model,
      apiKey: stored.key,
      timeoutMs: 8000,
      maxResponseBytes: 1_048_576,
      maxOutputTokens: 4096,
    };
  };
  const validateFile = async (files: FileList | File[]) => {
    setPipelineError(null);
    const list = Array.from(files);
    if (list.length !== 1) {
      setPipelineError({
        code: PipelineErrorCode.InvalidArgument,
        messageKey: "",
        stage: "validate" as never,
        recoverable: true,
        recoveryActions: ["choose-file"],
        details: {},
      });
      return;
    }
    const candidate = list[0];
    if (!candidate || !["image/png", "image/webp"].includes(candidate.type)) {
      setPipelineError({
        code: PipelineErrorCode.UnsupportedFormat,
        messageKey: "",
        stage: "validate" as never,
        recoverable: true,
        recoveryActions: ["choose-file"],
        details: {},
      });
      return;
    }
    setFile(candidate);
    setPreflight("preflight");
    try {
      const bitmap = await createImageBitmap(candidate);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      if (dimensions.width > 8192 || dimensions.height > 8192) {
        setDownscale(WORKING_MAX_DIMENSION);
        setModal("oversize");
        return;
      }
      if (
        candidate.size > 52_428_800 ||
        dimensions.width * dimensions.height * 16 + 16 * 1024 * 1024 > 1_073_741_824
      ) {
        setDownscale(
          Math.min(WORKING_MAX_DIMENSION, Math.max(dimensions.width, dimensions.height)),
        );
        setModal("memory");
        return;
      }
      await loadAndSegment(candidate, null);
    } catch {
      setPipelineError({
        code: PipelineErrorCode.DecodeFailed,
        messageKey: "",
        stage: "decode" as never,
        recoverable: true,
        recoveryActions: ["choose-file"],
        details: {},
      });
      setPreflight("idle");
    }
  };
  const loadAndSegment = async (
    candidate: File,
    resizeTo: { width: number; height: number } | null,
  ) => {
    setPreflight("decode");
    setLlmFailure(null);
    const nextAsset = { assetId: crypto.randomUUID().replaceAll("-", ""), revision: 1 };
    try {
      const loaded = (await pipelineSubmit("load", {
        kind: "encoded",
        ref: nextAsset,
        name: candidate.name,
        mimeHint: candidate.type,
        bytes: await candidate.arrayBuffer(),
        resizeTo,
      })) as { preview: PixelBuffer; asset: { workingSize: { width: number; height: number } } };
      // v3 工作边上限 2048（契约 §1 / 模型 maxSourceDimension）：超出须用户确认降采样。
      if (
        resizeTo === null &&
        Math.max(loaded.asset.workingSize.width, loaded.asset.workingSize.height) >
          WORKING_MAX_DIMENSION
      ) {
        setDownscale(WORKING_MAX_DIMENSION);
        setModal("oversize");
        setPreflight("idle");
        return;
      }
      const characterLoaded = await character().load({
        ref: nextAsset,
        name: candidate.name,
        mime: candidate.type === "image/webp" ? "image/webp" : "image/png",
        bytes: await candidate.arrayBuffer(),
        resizeTo,
      });
      if (!characterLoaded.ok) throw characterLoaded.error;
      setAssetRef(nextAsset);
      setPreview(loaded.preview);
      setPreflight("ready");
      setModelReady(false);
      setModelError(null);
      store.setFile({ file: candidate, size: loaded.asset.workingSize });
      // 工作图几何进 store（W3 画布 sourceSize / 顶栏尺寸都读 workingSize）。
      store.setAsset({
        asset: nextAsset,
        preview: loaded.preview,
        workingSize: loaded.asset.workingSize,
      });
      if (store.byok) {
        setModal("consent");
        setPreflight("idle");
      } else {
        store.setScreen("process");
      }
    } catch (caught) {
      const pipelineErrorLike = caught as PipelineError;
      if (pipelineErrorLike.code === PipelineErrorCode.MemoryLimit) {
        setPipelineError(pipelineErrorLike);
        setModal("memory");
      } else {
        setPipelineError(pipelineErrorLike);
        setPreflight("idle");
      }
    }
  };
  interface RunOutput {
    ok: boolean;
    result?: SegmentationResult;
    error?: CharacterError;
    llmFailure?: "network" | "unauthorized" | "rate_limited" | "bad_response";
  }
  /** W2 的 L1 失败卡（AC-V02-C）：按原因分类说明 + 重试/点击模式两条路径。 */
  const [llmFailure, setLlmFailure] = useState<LlmFailureReason | null>(null);
  const finishRun = (output: RunOutput) => {
    if (!output.ok || !output.result) {
      if (output.error?.code === "CANCELLED") {
        notify(t(locale, "parts.detect.cancelled"));
        store.setScreen("upload");
        setBusy(null);
        setProgress(null);
        return;
      }
      // LLM 失败（AC-V02-C）：原因匹配的失败说明 + 重试语义定位/使用点击模式，
      // 不进模型失败卡（模型与 LLM 是两类故障）；已上传图片与已有部位保留。
      // 权威来源是错误码（exchange 的 HTTP status 优先分类），worker 的
      // llmFailure（错误码优先、status 兜底）仅作补充——顺序不能反。
      const reason =
        (output.error ? llmFailureFromLlmCode(output.error.code) : null) ??
        output.llmFailure ??
        undefined;
      if (reason) {
        setLlmFailure(reason);
      } else {
        // 模型失败（AC-V03-D）：不重传图片，保留可重试状态；自动拆件与点击模式
        // 均标注不可用原因（二者依赖同一本地模型）。
        setModelError(output.error ?? null);
      }
      setBusy(null);
      setProgress(null);
      return;
    }
    const result = output.result;
    store.applySegmentResult(result);
    if (result.degraded) {
      // 显式传 null：低置信/非人形等非 LLM 失败不得沿用上一次运行的失败原因
      //（否则旧分类会串到新横幅上）。
      store.setDegraded(DEGRADED_MAP[result.degraded.reason], output.llmFailure ?? null);
      store.setScreen("review");
      setBusy(null);
      setProgress(null);
      void ensureInteractive();
      return;
    }
    store.setDegraded(null);
    store.setMode(result.mode);
    store.setScreen("review");
    notify(t(locale, "parts.detect.success", { count: result.parts.length }));
    setBusy(null);
    setProgress(null);
    void ensureInteractive();
  };
  const runSemantic = async () => {
    setModal(null);
    setBusy("semantic");
    store.setScreen("process");
    setProgress(null);
    setLlmFailure(null);
    const llm = buildLlmConfig();
    if (!llm || !store.byok) {
      // key 已被清除/未配置（AC-V06-B）：撤销 store 里的残留配置，让 W2 路径
      // 选择卡在本屏出现（两条明确路径），不发任何请求、不留在假进行中。
      store.setByok(null);
      store.setDegraded("no-key");
      store.setMode("click");
      setBusy(null);
      return;
    }
    // 传输层拒绝兜底（同 prepareClick）：失败卡 + busy 复位，不留假进行中。
    let output: RunOutput;
    try {
      output = await character().run({ llm, consent: true }, setProgress);
    } catch {
      setModelError(transportModelError());
      setBusy(null);
      setProgress(null);
      return;
    }
    finishRun(output);
  };
  const prepareClick = async () => {
    setModal(null);
    setBusy("click");
    store.setScreen("process");
    setProgress(null);
    setLlmFailure(null);
    // 传输层拒绝兜底：宁可展示模型失败卡，也不留下假进行中（P1 教训）。
    let output: CharacterPrepareOutput;
    try {
      output = await character().prepare({}, setProgress);
    } catch {
      setModelError(transportModelError());
      setBusy(null);
      setProgress(null);
      return;
    }
    if (!output.ok) {
      if (output.error === undefined) finishRun({ ok: false });
      else finishRun({ ok: false, error: output.error });
      return;
    }
    store.setModelInfo({
      backendWasm: output.webgpuFallback === true,
      modelCached: output.cachedModel === true,
    });
    store.setMode("click");
    store.setDegraded("no-key");
    store.setScreen("review");
    setModelReady(true);
    setBusy(null);
    setProgress(null);
  };
  const ensureInteractive = async () => {
    if (modelReady) return;
    let output: CharacterPrepareOutput;
    try {
      output = await character().prepare({}, () => {});
    } catch {
      setModelError(transportModelError());
      return;
    }
    if (output.ok) {
      store.setModelInfo({
        backendWasm: output.webgpuFallback === true,
        modelCached: output.cachedModel === true,
      });
      setModelReady(true);
      setModelError(null);
    } else if (output.error?.code !== "CANCELLED") {
      setModelError(output.error ?? null);
    }
  };
  /** W3 点击增删（V-04）：正/负点经 SamSession.segment 精修（整幅替换蒙版）。 */
  const onCanvasClick = async (point: { x: number; y: number }) => {
    if (refining || busy !== null || !modelReady || !assetRef) return;
    const tool = store.tool;
    if (tool === "select" || tool === "pan") {
      const hit = partAtPoint(store.parts, point);
      store.selectPart(hit?.id ?? null);
      return;
    }
    setRefining(true);
    try {
      const client = character();
      if (tool === "add-part") {
        const output = await client.refine({
          prompt: { box: null, points: [{ point, label: "positive" }] },
        });
        if (!output.ok || !output.mask || output.sourceRect === undefined) {
          handleRefineError(output.error);
          return;
        }
        const stub = {
          ref: assetRef,
          name: "parts",
          sourceMime: "application/x-rgba8" as const,
          originalSize: { width: 1, height: 1 },
          pixels: {
            width: store.workingSize?.width ?? 1,
            height: store.workingSize?.height ?? 1,
            format: "rgba8" as const,
            colorSpace: "srgb" as const,
            alphaMode: "straight" as const,
            data: new Uint8ClampedArray(0),
          },
          scaleFromOriginal: { x: 1, y: 1 },
        };
        const created = createPartAsset(
          stub,
          PartKind.Other,
          `part_${String(store.nextClickIndex).padStart(3, "0")}`,
          {
            asset: assetRef,
            mask: output.mask,
            sourceRect: output.sourceRect,
            predictedIou: output.predictedIou ?? 0,
            provider: "wasm",
          },
        );
        if (!created.ok) {
          handleRefineError(created.error);
          return;
        }
        store.addClickPart(created.value);
        notify(t(locale, "part.added"));
        return;
      }
      const partId = store.selectedPartId;
      const part = store.parts.find((entry) => entry.id === partId);
      if (!partId || !part) return;
      const bounds = maskBounds(part.mask);
      if (bounds === null && tool === "remove-region") return;
      const points = [
        ...(store.prompts[partId] ?? []),
        { point, label: tool === "add-region" ? ("positive" as const) : ("negative" as const) },
      ];
      const imageBounds = imageRectOfPart(part) ?? part.sourceRect;
      const output = await client.refine({
        prompt: {
          box:
            bounds === null
              ? null
              : {
                  x: part.sourceRect.x + bounds.x,
                  y: part.sourceRect.y + bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                },
          points,
        },
      });
      if (!output.ok || !output.mask || output.sourceRect === undefined) {
        handleRefineError(output.error);
        return;
      }
      void imageBounds;
      store.updatePartMask(partId, {
        mask: output.mask,
        sourceRect: output.sourceRect,
        predictedIou: output.predictedIou ?? part.confidence,
      });
      notify(t(locale, "part.region_updated"));
    } finally {
      setRefining(false);
    }
  };
  const handleRefineError = (error?: CharacterError) => {
    if (error?.code === "CANCELLED") return;
    if (
      error?.code === "MODEL_INITIALIZATION_FAILED" ||
      error?.code === "MODEL_DOWNLOAD_FAILED" ||
      error?.code === "MODEL_HASH_MISMATCH" ||
      error?.code === "INFERENCE_UNAVAILABLE"
    ) {
      setModelReady(false);
      setModelError(error);
      return;
    }
    setModelError(error ?? null);
  };
  const startExport = async () => {
    if (store.parts.length === 0 || !assetRef) return;
    setExportState("processing");
    setProgress(null);
    const output = await character().exportParts(
      { parts: store.parts, names: buildExportNames(store.parts) },
      setProgress,
    );
    if (!output.ok || !output.result) {
      if (output.error?.code === "CANCELLED") {
        setExportState("closed");
        setProgress(null);
        return;
      }
      setExportState(
        output.error?.code === "PART_PIXEL_INVARIANT_FAILED" ? "invariant" : "failure",
      );
      setProgress(null);
      return;
    }
    setExportResult(output.result);
    setExportState("success");
    download(output.result);
    setProgress(null);
  };
  const download = (result: PartExportResult) => {
    const url = URL.createObjectURL(new Blob([result.archive], { type: result.mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "parts.zip";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const selectedPart = store.parts.find((part) => part.id === store.selectedPartId) ?? null;
  const selectedName = selectedPart
    ? partDisplayName(
        selectedPart,
        locale,
        store.parts.findIndex((part) => part.id === selectedPart.id),
      )
    : "";
  const busyVisible = busy !== null || refining;
  return (
    <main className="app-shell parts-shell">
      <header className="topbar">
        <strong>SpriteFlow</strong>
        <ModeSwitch locale={locale} workspace="parts" onSwitchRequest={onSwitchRequest} />
        {store.screen === "review" && (
          <>
            <span className="mono muted">{file?.name}</span>
            <span className="mono muted">
              {store.workingSize?.width}×{store.workingSize?.height}
            </span>
          </>
        )}
        <span className="grow" />
        {store.screen === "review" && (
          <button type="button" className="ghost" onClick={() => setModal("newFile")}>
            {t(locale, "action.new_file")}
          </button>
        )}
        <button type="button" className="ghost" onClick={() => setModal("byok")}>
          {t(locale, "parts.upload.open_llm_settings")}
        </button>
        {import.meta.env.DEV && DevVisualPanel !== null && (
          <button
            type="button"
            className="ghost"
            onClick={() => setModal("devVisual")}
            aria-label={t(locale, "dev.visual.title")}
          >
            ▧
          </button>
        )}
        <label className="lang">
          <span className="sr-only">{t(locale, "language.label")}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
            aria-label={t(locale, "language.label")}
          >
            <option value="zh">{t(locale, "language.zh")}</option>
            <option value="en">{t(locale, "language.en")}</option>
          </select>
        </label>
      </header>
      <div aria-live="polite" className="sr-only">
        {busyVisible ? t(locale, "status.busy") : t(locale, "status.ready")}
      </div>
      {store.screen === "upload" && (
        <PartsUpload
          locale={locale}
          preflight={preflight}
          dragOver={dragOver}
          file={file}
          size={store.workingSize}
          error={pipelineError}
          onFiles={validateFile}
          onDrag={setDragOver}
          onBrowse={() => document.getElementById("spriteflow-parts-file")?.click()}
          onOpenByok={() => setModal("byok")}
        />
      )}
      {store.screen === "process" && (
        <PartsProcessing
          locale={locale}
          providerLabel={providerLabel()}
          modelSizeMb={modelSizeMb}
          progress={progress}
          busy={busy}
          modelError={modelError}
          llmFailure={llmFailure}
          semanticAvailable={store.byok !== null}
          backendWasm={store.backendWasm || store.wasmFallbackWarning}
          onCancel={() => character().cancel()}
          onChooseClick={prepareClick}
          onOpenByok={() => setModal("byok")}
          onRetryLlm={() => void runSemantic()}
          onRetryModel={() => {
            setModelError(null);
            if (busy === "semantic") void runSemantic();
            else if (busy === "click") void prepareClick();
            else void ensureInteractive();
          }}
        />
      )}
      {store.screen === "review" && (
        <PartsReview
          locale={locale}
          store={store}
          preview={preview}
          busy={busyVisible}
          modelReady={modelReady}
          modelError={modelError}
          selectedName={selectedName}
          providerLabel={providerLabel()}
          llmFailure={store.llmFailure}
          onCanvasClick={onCanvasClick}
          onExport={() => setExportState("form")}
          onRerun={() => setModal("rerun")}
          onDelete={() => setModal("delete")}
          onRetryModel={() => {
            setModelError(null);
            void ensureInteractive();
          }}
          onRetryLlm={() => setModal("rerun")}
          onUseClick={() => {
            store.setDegraded(null);
            void prepareClick();
          }}
          onOpenByok={() => setModal("byok")}
        />
      )}
      {exportState !== "closed" && (
        <PartsExportDrawer
          locale={locale}
          state={exportState}
          count={store.parts.length}
          result={exportResult}
          progress={progress}
          onClose={() => setExportState("closed")}
          onStart={() => void startExport()}
          onCancel={() => character().cancel()}
          onDownload={() => exportResult && download(exportResult)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
      {modal === "byok" && (
        <ByokPanel
          locale={locale}
          onClose={() => setModal(null)}
          onSaved={(config) => {
            store.setByok(config);
            setModal(null);
            notify(t(locale, "llm.saved"));
            // W2 路径卡上保存后直接交接外发告知（同意 → 拆件），
            // 不留在无任务的 W2 过程屏（P1-1 同源场景）。
            if (store.screen === "process" && file !== null) setModal("consent");
          }}
        />
      )}
      {modal === "devVisual" && DevVisualPanel !== null && (
        <Suspense fallback={null}>
          <DevVisualPanel locale={locale} onClose={() => setModal(null)} />
        </Suspense>
      )}
      {modal !== null && modal !== "byok" && modal !== "devVisual" && (
        <PartsModal
          locale={locale}
          kind={modal}
          providerLabel={providerLabel()}
          size={store.file?.size ?? null}
          downscale={downscale}
          setDownscale={setDownscale}
          onClose={() => {
            // 同意框取消且无任务在跑（路径卡保存后反悔）：回 W1 定义态，
            // 不留在无任务的 W2 过程屏。
            if (modal === "consent" && store.screen === "process" && busy === null)
              store.setScreen("upload");
            setModal(null);
          }}
          onConfirm={() => {
            if (modal === "oversize" || modal === "memory") {
              setModal(null);
              if (file && store.workingSize) {
                const largest = Math.max(store.workingSize.width, store.workingSize.height);
                const scale = Math.min(downscale / largest, 1);
                void loadAndSegment(file, {
                  width: Math.max(1, Math.round(store.workingSize.width * scale)),
                  height: Math.max(1, Math.round(store.workingSize.height * scale)),
                });
              }
            } else if (modal === "delete") {
              if (store.selectedPartId) store.removePart(store.selectedPartId);
              setModal(null);
              notify(t(locale, "part.deleted"));
            } else if (modal === "rerun") {
              setModal(null);
              // 重新拆件=替换当前部位（copy-v3 §25）：清空为一次撤销事务。
              store.clearParts();
              if (store.byok) setModal("consent");
              else void prepareClick();
            } else if (modal === "consent") {
              void runSemantic();
            } else if (modal === "newFile") {
              // 换一张图（§13.1）：取消任务 + 清空部位与历史 + 回 W1。
              setModal(null);
              character().cancel();
              store.resetAll();
              usePartsStore.temporal.getState().clear();
              clearKey();
              setFile(null);
              setPreview(null);
              setAssetRef(null);
              setPreflight("idle");
              setPipelineError(null);
              setModelError(null);
              setLlmFailure(null);
              setModelReady(false);
              setProgress(null);
              setBusy(null);
              setExportState("closed");
              setExportResult(null);
            } else setModal(null);
          }}
        />
      )}
    </main>
  );
}

function PartsUpload({
  locale,
  preflight,
  dragOver,
  file,
  size,
  error,
  onFiles,
  onDrag,
  onBrowse,
  onOpenByok,
}: {
  locale: Locale;
  preflight: string;
  dragOver: boolean;
  file: File | null;
  size: { width: number; height: number } | null;
  error: PipelineError | null;
  onFiles(files: FileList | File[]): void;
  onDrag(value: boolean): void;
  onBrowse(): void;
  onOpenByok(): void;
}) {
  const copy = error ? errorCopy(error, locale) : null;
  return (
    <section className="upload-stage">
      <input
        id="spriteflow-parts-file"
        hidden
        type="file"
        accept="image/png,image/webp"
        onChange={(event) => event.target.files && void onFiles(event.target.files)}
      />
      <div className="upload-col">
        <h1>{t(locale, "parts.workspace.tagline")}</h1>
        <p className="privacy">▣ {t(locale, "privacy.parts_notice")}</p>
        <button
          type="button"
          className={`dropzone ${dragOver ? "over" : ""}`}
          onClick={onBrowse}
          onDragEnter={(event) => {
            event.preventDefault();
            onDrag(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => onDrag(false)}
          onDrop={(event) => {
            event.preventDefault();
            onDrag(false);
            void onFiles(event.dataTransfer.files);
          }}
        >
          <strong>
            {dragOver ? t(locale, "upload.drop_active") : t(locale, "parts.upload.empty.title")}
          </strong>
          <span>{t(locale, "parts.upload.empty.hint")}</span>
        </button>
        <button type="button" className="primary" onClick={onBrowse}>
          {t(locale, "upload.browse")}
        </button>
        <p className="muted">{t(locale, "parts.upload.subject_hint")}</p>
        <div className="chips">
          <span>PNG</span>
          <span>WebP</span>
        </div>
        <button type="button" className="secondary" onClick={onOpenByok}>
          {t(locale, "parts.upload.open_llm_settings")}
        </button>
      </div>
      {preflight !== "idle" && file && (
        <div className="file-card">
          <div>
            <span>{t(locale, "upload.file_name")}</span>
            <b>{file.name}</b>
          </div>
          <div>
            <span>{t(locale, "upload.file_type")}</span>
            <b>{file.type}</b>
          </div>
          <div>
            <span>{t(locale, "upload.file_size")}</span>
            <b>{size ? `${size.width}×${size.height}` : "—"}</b>
          </div>
          <p>
            ◌ {preflight === "decode" ? t(locale, "upload.decode") : t(locale, "upload.preflight")}
          </p>
        </div>
      )}
      {copy && (
        <div className="error-card">
          <h2>{copy[0]}</h2>
          <p>{copy[1]}</p>
          <button type="button" className="danger-outline" onClick={onBrowse}>
            {t(locale, "error.choose_another")}
          </button>
        </div>
      )}
    </section>
  );
}

/** W2 拆件过程：CharacterProgressEvent 各 stage 真实呈现（无假进度）。 */
function PartsProcessing({
  locale,
  providerLabel,
  modelSizeMb,
  progress,
  busy,
  modelError,
  llmFailure,
  semanticAvailable,
  backendWasm,
  onCancel,
  onChooseClick,
  onOpenByok,
  onRetryLlm,
  onRetryModel,
}: {
  locale: Locale;
  providerLabel: string;
  modelSizeMb: number;
  progress: CharacterProgressEvent | null;
  busy: Busy;
  modelError: CharacterError | null;
  llmFailure: LlmFailureReason | null;
  semanticAvailable: boolean;
  backendWasm: boolean;
  onCancel(): void;
  onChooseClick(): void;
  onOpenByok(): void;
  onRetryLlm(): void;
  onRetryModel(): void;
}) {
  const stage = progress?.stage;
  const percent = Math.round((progress?.overallProgress ?? 0) * 100);
  const inModel =
    stage === CharacterStage.ModelInitialize || stage === CharacterStage.ModelDownload;
  const inLlm = stage === CharacterStage.SemanticLocate;
  const inMasks =
    stage === CharacterStage.ImageEmbedding ||
    stage === CharacterStage.PromptInference ||
    stage === CharacterStage.MaskPostprocess;
  const inFinal = stage === CharacterStage.Validate || stage === CharacterStage.Complete;
  const showPathCard =
    semanticAvailable === false && busy === null && modelError === null && llmFailure === null;
  // 点击模式 prepare 的字节级下载进度（Worker 端 ModelDownload 事件，单位字节）。
  const downloadMb =
    progress?.stage === CharacterStage.ModelDownload && progress.totalUnits !== null
      ? {
          completed: (progress.completedUnits / 1_000_000).toFixed(1),
          total: (progress.totalUnits / 1_000_000).toFixed(1),
        }
      : null;
  const masksLabel =
    progress?.stage === CharacterStage.PromptInference && progress.totalUnits !== null
      ? `${t(locale, "parts.detect.masks")} ${progress.completedUnits}/${progress.totalUnits}`
      : t(locale, "parts.detect.masks");
  return (
    <section className="detect-stage">
      <div className="detect-card">
        <h1>{t(locale, "parts.detect.title")}</h1>
        {showPathCard ? (
          <>
            <h2>{t(locale, "llm.not_configured.title")}</h2>
            <p>{t(locale, "llm.not_configured.body")}</p>
            <button type="button" className="primary" onClick={onOpenByok}>
              {t(locale, "parts.upload.open_llm_settings")}
            </button>
            <button type="button" className="secondary" onClick={onChooseClick}>
              {t(locale, "parts.fallback.use_click")}
            </button>
          </>
        ) : llmFailure ? (
          // AC-V02-C：原因匹配的失败说明 + 两条明确动作；不使用成功语气。
          <>
            <h2>{t(locale, "parts.fallback.llm_failed.title")}</h2>
            <p>{t(locale, `llm.error.${llmFailure}` as never)}</p>
            <button type="button" className="primary" onClick={onRetryLlm}>
              {t(locale, "parts.fallback.retry_llm")}
            </button>
            <button type="button" className="secondary" onClick={onChooseClick}>
              {t(locale, "parts.fallback.use_click")}
            </button>
          </>
        ) : modelError ? (
          <>
            <h2>{t(locale, "model.failed.title")}</h2>
            <p>{t(locale, "model.failed.body")}</p>
            <p className="muted">{t(locale, "model.required_hint")}</p>
            <button type="button" className="primary" onClick={onRetryModel}>
              {t(locale, "model.retry")}
            </button>
            <button type="button" className="secondary" onClick={onCancel}>
              {t(locale, "parts.detect.cancel")}
            </button>
          </>
        ) : (
          <>
            {semanticAvailable && (
              <p className={`phase ${inLlm ? "current" : ""}`}>
                {t(locale, "parts.detect.llm", { provider: providerLabel })}
              </p>
            )}
            <p className={`phase ${inModel ? "current" : ""}`}>
              {t(locale, "model.loading")}
              <span className="mono muted">
                {" "}
                · {t(locale, "model.downloading", { size: modelSizeMb })}
              </span>
              {downloadMb !== null && (
                <span className="mono muted">
                  {" "}
                  ·{" "}
                  {t(locale, "model.progress", {
                    completed: downloadMb.completed,
                    total: downloadMb.total,
                  })}
                </span>
              )}
            </p>
            <p className={`phase ${inMasks ? "current" : ""}`}>{masksLabel}</p>
            <p className={`phase ${inFinal ? "current" : ""}`}>
              {t(locale, "parts.detect.finalizing")}
            </p>
            {backendWasm && (
              // AC-V03-B：WebGPU 不可用回退须提示性能差异，不作为错误弹出。
              <p className="muted">{t(locale, "model.backend_wasm")}</p>
            )}
            <progress
              value={progress?.totalUnits === null ? undefined : percent}
              max="100"
              aria-label={t(locale, "parts.detect.progress", { percent })}
            />
            <span className="mono">{percent}%</span>
            <button type="button" className="secondary" disabled={busy === null} onClick={onCancel}>
              {t(locale, "parts.detect.cancel")}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** W3 部位审校：工具栏 + 主画布 + 部件列表卡（无时间轴，v3 无帧概念）。 */
function PartsReview({
  locale,
  store,
  preview,
  busy,
  modelReady,
  modelError,
  selectedName,
  providerLabel,
  llmFailure,
  onCanvasClick,
  onExport,
  onRerun,
  onDelete,
  onRetryModel,
  onRetryLlm,
  onUseClick,
  onOpenByok,
}: {
  locale: Locale;
  store: ReturnType<typeof usePartsStore.getState>;
  preview: PixelBuffer | null;
  busy: boolean;
  modelReady: boolean;
  modelError: CharacterError | null;
  selectedName: string;
  providerLabel: string;
  llmFailure: ReturnType<typeof usePartsStore.getState>["llmFailure"];
  onCanvasClick(point: { x: number; y: number }): void;
  onExport(): void;
  onRerun(): void;
  onDelete(): void;
  onRetryModel(): void;
  onRetryLlm(): void;
  onUseClick(): void;
  onOpenByok(): void;
}) {
  const temporal = usePartsStore.temporal;
  const canUndo = temporal.getState().pastStates.length > 0;
  const canRedo = temporal.getState().futureStates.length > 0;
  const degraded = store.degraded;
  const bannerKey =
    degraded === "non-humanoid"
      ? DEGRADED_BANNER.NON_HUMANOID
      : degraded === "no-key"
        ? DEGRADED_BANNER.LLM_UNAVAILABLE
        : degraded === "llm-failed" || degraded === "low-confidence"
          ? DEGRADED_BANNER.LLM_FAILED
          : null;
  // 四分类词条（copy-v3）：仅在确有分类时渲染 reason；null 不得兜底成
  // "无法解析的结果"（2026-09-30 RC P1 的 UI 侧根因之一），低置信降级
  // 用自己的中性文案（LLM 其实成功解析了）。
  const reasonText = llmFailure === null ? null : t(locale, `llm.error.${llmFailure}` as never);
  const toolButton = (
    tool: "add-region" | "remove-region" | "add-part" | "select" | "pan",
    key: Parameters<typeof translate>[1],
    hintKey: Parameters<typeof translate>[1],
  ) => (
    <button
      type="button"
      className={store.tool === tool ? "tool active" : "tool"}
      disabled={!modelReady}
      title={`${t(locale, key)} — ${t(locale, hintKey)}`}
      onClick={() => store.setTool(tool)}
    >
      {t(locale, key)}
    </button>
  );
  return (
    <section className="review parts-review">
      <nav className="toolbar">
        {toolButton("select", "tool.select", "parts.editor.add_region_hint")}
        {toolButton("pan", "tool.pan", "parts.editor.add_region_hint")}
        {toolButton("add-region", "tool.add_region", "parts.editor.add_region_hint")}
        {toolButton("remove-region", "tool.remove_region", "parts.editor.remove_region_hint")}
        {toolButton("add-part", "tool.add_part", "parts.editor.add_part_hint")}
        <i />
        <button
          type="button"
          className="tool"
          disabled={!store.selectedPartId || busy}
          onClick={onDelete}
        >
          {t(locale, "tool.delete_part")}
        </button>
        <i />
        <button
          type="button"
          className="tool"
          disabled={!canUndo}
          title={canUndo ? undefined : t(locale, "editor.nothing_to_undo")}
          onClick={() => usePartsStore.temporal.getState().undo()}
        >
          {t(locale, "tool.undo")}
        </button>
        <button
          type="button"
          className="tool"
          disabled={!canRedo}
          title={canRedo ? undefined : t(locale, "editor.nothing_to_redo")}
          onClick={() => usePartsStore.temporal.getState().redo()}
        >
          {t(locale, "tool.redo")}
        </button>
        <span className="grow" />
        <button type="button" className="secondary" onClick={onRerun}>
          {t(locale, "parts.rerun")}
        </button>
        <button
          type="button"
          className="primary"
          disabled={store.parts.length === 0}
          aria-describedby={store.parts.length === 0 ? "no-parts-help" : undefined}
          onClick={onExport}
        >
          {t(locale, "tool.export")}
        </button>
        <span id="no-parts-help" className="sr-only">
          {store.parts.length === 0 ? t(locale, "parts.export.disabled_no_parts") : ""}
        </span>
      </nav>
      <div className="workspace">
        <section className="canvas-wrap">
          {bannerKey && (
            <div className="warning-banner">
              <strong>{t(locale, bannerKey.title)}</strong>
              <span>
                {degraded === "llm-failed" || degraded === "low-confidence"
                  ? (reasonText ?? t(locale, "parts.fallback.low_confidence.body"))
                  : t(locale, bannerKey.body)}
              </span>
              {degraded === "llm-failed" && (
                <>
                  <button type="button" onClick={onRetryLlm}>
                    {t(locale, "parts.fallback.retry_llm")}
                  </button>
                  <button type="button" onClick={onUseClick}>
                    {t(locale, "parts.fallback.use_click")}
                  </button>
                </>
              )}
              {degraded === "no-key" && (
                <button type="button" onClick={onOpenByok}>
                  {t(locale, "parts.upload.open_llm_settings")}
                </button>
              )}
            </div>
          )}
          {modelError && (
            <div className="warning-banner">
              <strong>{t(locale, "model.failed.title")}</strong>
              <span>
                {t(locale, "model.failed.body")} {t(locale, "model.required_hint")}
              </span>
              <button type="button" onClick={onRetryModel}>
                {t(locale, "model.retry")}
              </button>
            </div>
          )}
          {(store.backendWasm || store.wasmFallbackWarning) && (
            // AC-V03-B：回退提示在审校屏持续在场（性能差异，非错误）。
            <div className="warning-banner">
              <span>{t(locale, "model.backend_wasm")}</span>
            </div>
          )}
          <PartsCanvas
            preview={preview}
            sourceSize={store.workingSize}
            tool={store.tool}
            busy={busy || !modelReady}
            canvasLabel={t(locale, "parts.editor.canvas")}
            canvasBackground="var(--parts-canvas-bg, var(--bg-0))"
            onImageClick={onCanvasClick}
          />
        </section>
        <aside className="sidebar parts-sidebar">
          <section>
            <h2>{t(locale, "parts.editor.title")}</h2>
            <p className="method-chip">
              {store.mode === "semantic"
                ? t(locale, "parts.mode.semantic")
                : t(locale, "parts.mode.click")}
            </p>
            <label className="field">
              <input
                type="checkbox"
                checked={store.maskHighlight}
                onChange={(event) => store.setMaskHighlight(event.target.checked)}
              />{" "}
              {t(locale, "parts.mask_highlight")}
            </label>
          </section>
          <section>
            <h2>{t(locale, "part.list.title")}</h2>
            {store.parts.length === 0 ? (
              <p className="muted">{t(locale, "parts.editor.no_parts")}</p>
            ) : (
              <ul className="part-list">
                {store.parts.map((part, index) => {
                  const active = part.id === store.selectedPartId;
                  return (
                    <li key={part.id}>
                      <button
                        type="button"
                        className={`part-card ${active ? "active" : ""}`}
                        aria-pressed={active}
                        aria-label={t(locale, "part.selected", {
                          part: partDisplayName(part, locale, index),
                        })}
                        onClick={() => store.selectPart(part.id)}
                      >
                        <span className="part-name">
                          {partDisplayName(part, locale, index)}
                          <em className="kind-badge">
                            {t(
                              locale,
                              `part.kind.${part.kind === "other" ? "other" : part.kind.split("-")[0]}` as never,
                            )}
                          </em>
                        </span>
                        <span className="mono muted">
                          {t(locale, "part.size", {
                            width: part.sourceRect.width,
                            height: part.sourceRect.height,
                          })}
                        </span>
                        <span className="muted">
                          {t(locale, "part.confidence_label", {
                            percent: Math.round(part.confidence * 100),
                          })}
                        </span>
                        {part.occluded && (
                          <span className="occluded" title={t(locale, "part.occluded_help")}>
                            {t(locale, "part.occluded_badge")}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
      <footer className="statusbar">
        <span className={busy ? "busy-dot" : "idle-dot"} />
        <span>{busy ? t(locale, "status.busy") : t(locale, "status.ready")}</span>
        <span className="grow" />
        <span className="mono">{Math.round(store.zoom * 100)}%</span>
        <span>
          {store.mode === "semantic"
            ? t(locale, "parts.mode.semantic", { provider: providerLabel })
            : t(locale, "parts.mode.click")}
        </span>
        <span>{t(locale, "parts.editor.summary", { count: store.parts.length })}</span>
        {selectedName && <span>{t(locale, "part.selected", { part: selectedName })}</span>}
      </footer>
    </section>
  );
}

/** W4 导出抽屉（复用 M1 抽屉样式）：像素校验 stage 单独呈现。 */
function PartsExportDrawer({
  locale,
  state,
  count,
  result,
  progress,
  onClose,
  onStart,
  onCancel,
  onDownload,
}: {
  locale: Locale;
  state: ExportDrawerState;
  count: number;
  result: PartExportResult | null;
  progress: CharacterProgressEvent | null;
  onClose(): void;
  onStart(): void;
  onCancel(): void;
  onDownload(): void;
}) {
  const percent = Math.round((progress?.overallProgress ?? 0) * 100);
  const stageKey =
    progress?.stage === CharacterStage.PixelAssert
      ? "parts.export.verifying"
      : progress?.stage === CharacterStage.Archive
        ? "parts.export.zipping"
        : "parts.export.preparing";
  return (
    <aside className="drawer" aria-label={t(locale, "parts.export.title")}>
      {state === "processing" ? (
        <div className="drawer-state">
          <h1>{t(locale, "parts.export.title")}</h1>
          <p>{t(locale, stageKey)}</p>
          <progress
            value={percent}
            max="100"
            aria-label={t(locale, "parts.export.progress", { percent })}
          />
          <span className="mono">{percent}%</span>
          <button type="button" className="secondary" onClick={onCancel}>
            {t(locale, "export.cancel")}
          </button>
        </div>
      ) : state === "success" && result ? (
        <div className="drawer-state">
          <h1>✓ {t(locale, "parts.export.success.title")}</h1>
          <p>{t(locale, "parts.export.success.body", { name: "parts.zip" })}</p>
          <button type="button" className="primary" onClick={onDownload}>
            {t(locale, "export.download")}
          </button>
          <button type="button" className="secondary" onClick={onStart}>
            {t(locale, "parts.export.again")}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            {t(locale, "parts.export.back")}
          </button>
        </div>
      ) : state === "failure" ? (
        <div className="drawer-state">
          <h1>{t(locale, "export.failed.title")}</h1>
          <p>{t(locale, "export.failed.body")}</p>
          <button type="button" className="primary" onClick={onStart}>
            {t(locale, "action.retry")}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            {t(locale, "parts.export.back")}
          </button>
        </div>
      ) : state === "invariant" ? (
        <div className="drawer-state">
          <h1>{t(locale, "parts.export.invariant_failed.title")}</h1>
          <p>{t(locale, "parts.export.invariant_failed.body")}</p>
          <button type="button" className="primary" onClick={onClose}>
            {t(locale, "parts.export.back")}
          </button>
        </div>
      ) : (
        <>
          <header>
            <h1>{t(locale, "parts.export.title")}</h1>
            <button type="button" className="tool" onClick={onClose}>
              ×
            </button>
          </header>
          <p>{t(locale, "parts.export.summary", { count })}</p>
          <p className="muted">{t(locale, "parts.export.format_hint")}</p>
          <footer>
            <button type="button" className="secondary" onClick={onClose}>
              {t(locale, "parts.export.back")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={count === 0}
              aria-describedby={count === 0 ? "parts-export-disabled" : undefined}
              onClick={onStart}
            >
              {t(locale, "parts.export.start")}
            </button>
            <span id="parts-export-disabled" className="sr-only">
              {count === 0 ? t(locale, "parts.export.disabled_no_parts") : ""}
            </span>
          </footer>
        </>
      )}
    </aside>
  );
}

/** BYOK 配置面板：key 只进 Worker；显式勾选后 sessionStorage 记住（关闭即清）。 */
function ByokPanel({
  locale,
  onClose,
  onSaved,
}: {
  locale: Locale;
  onClose(): void;
  onSaved(config: ByokConfig): void;
}) {
  const stored = loadByokState();
  const [provider, setProvider] = useState<ByokConfig["provider"]>(
    stored.config?.provider ?? "glm_4v",
  );
  const [endpoint, setEndpoint] = useState(stored.config?.endpoint ?? presetEndpoint("glm_4v"));
  const [model, setModel] = useState(stored.config?.model ?? DEFAULT_MODELS.glm_4v);
  const [key, setKey] = useState(stored.key ?? "");
  const [remember, setRemember] = useState(stored.remember);
  const [invalid, setInvalid] = useState(false);
  const isCustom = provider === "custom";
  return (
    <div className="modal-wrap">
      <dialog open className="modal" aria-modal="true" aria-label={t(locale, "llm.settings.title")}>
        <h1>{t(locale, "llm.settings.title")}</h1>
        <label className="field">
          <span>{t(locale, "llm.provider.label")}</span>
          <select
            value={provider}
            onChange={(event) => {
              const next = event.target.value as ByokConfig["provider"];
              setProvider(next);
              setEndpoint(next === "custom" ? "" : presetEndpoint(next));
              setModel(DEFAULT_MODELS[next]);
            }}
          >
            <option value="glm_4v">{t(locale, "llm.provider.glm_4v")}</option>
            <option value="cogvlm">{t(locale, "llm.provider.cogvlm")}</option>
            <option value="openai_gpt">{t(locale, "llm.provider.openai_gpt")}</option>
            <option value="custom">{t(locale, "llm.provider.custom")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t(locale, "llm.endpoint.label")}</span>
          <input
            type="text"
            value={endpoint}
            disabled={!isCustom}
            aria-invalid={invalid}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder={isCustom ? GLM_ENDPOINT : undefined}
          />
        </label>
        <label className="field">
          <span>{t(locale, "llm.model.label")}</span>
          <input type="text" value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <label className="field">
          <span>{t(locale, "llm.api_key.label")}</span>
          <input
            type="password"
            value={key}
            autoComplete="off"
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <small>{t(locale, "llm.api_key.help")}</small>
        <label className="field">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />{" "}
          {t(locale, "llm.remember_tab")}
        </label>
        {invalid && (
          <p role="alert" className="inline-error">
            {t(locale, "llm.invalid_endpoint")}
          </p>
        )}
        <footer>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              clearKey();
              setKey("");
              onClose();
            }}
          >
            {t(locale, "llm.clear")}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const finalEndpoint = isCustom ? endpoint : presetEndpoint(provider);
              if (!isValidEndpoint(finalEndpoint) || model.length === 0 || key.length === 0) {
                setInvalid(true);
                return;
              }
              saveByok({ provider, endpoint: finalEndpoint, model }, key, remember);
              onSaved({ provider, endpoint: finalEndpoint, model });
            }}
          >
            {t(locale, "llm.save")}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            {t(locale, "action.cancel")}
          </button>
        </footer>
      </dialog>
    </div>
  );
}

function PartsModal({
  locale,
  kind,
  providerLabel,
  size,
  downscale,
  setDownscale,
  onClose,
  onConfirm,
}: {
  locale: Locale;
  kind: Exclude<Modal, "byok" | "devVisual">;
  providerLabel: string;
  size: { width: number; height: number } | null;
  downscale: number;
  setDownscale(value: number): void;
  onClose(): void;
  onConfirm(): void;
}) {
  let title = "";
  let body = "";
  let confirm = "";
  let dangerous = false;
  if (kind === "delete") {
    title = t(locale, "confirm.delete_part.title");
    body = t(locale, "confirm.delete_part.body");
    confirm = t(locale, "confirm.delete_part.action");
    dangerous = true;
  } else if (kind === "rerun") {
    title = t(locale, "confirm.rerun_split.title");
    body = t(locale, "confirm.rerun_split.body");
    confirm = t(locale, "confirm.rerun_split.action");
  } else if (kind === "consent") {
    title = t(locale, "parts.detect.title");
    body = t(locale, "llm.privacy_notice", { provider: providerLabel });
    confirm = t(locale, "llm.consent.start");
  } else if (kind === "oversize") {
    title = t(locale, "oversize.title");
    body = t(locale, "oversize.body", size ?? {});
    confirm = t(locale, "oversize.continue");
  } else if (kind === "memory") {
    title = t(locale, "memory.precheck.title");
    body = t(locale, "memory.precheck.body");
    confirm = t(locale, "memory.downscale_retry");
  } else if (kind === "newFile") {
    title = t(locale, "confirm.new_file.title");
    body = t(locale, "confirm.new_file.body");
    confirm = t(locale, "confirm.new_file.action");
  } else {
    title = t(locale, "model.failed.title");
    body = t(locale, "model.failed.body");
    confirm = t(locale, "model.retry");
  }
  return (
    <div className="modal-wrap">
      <dialog open className="modal" aria-modal="true">
        <h1>{title}</h1>
        <p>{body}</p>
        {(kind === "oversize" || kind === "memory") && (
          <label className="field">
            <span>{t(locale, "oversize.target")}</span>
            <select
              value={downscale}
              onChange={(event) => setDownscale(Number(event.target.value))}
            >
              {[WORKING_MAX_DIMENSION, 1536, 1024, 768].map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
        )}
        <footer>
          <button type="button" className="secondary" onClick={onClose}>
            {kind === "oversize" ? t(locale, "oversize.cancel") : t(locale, "action.cancel")}
          </button>
          <button type="button" className={dangerous ? "danger" : "primary"} onClick={onConfirm}>
            {confirm}
          </button>
        </footer>
      </dialog>
    </div>
  );
}
