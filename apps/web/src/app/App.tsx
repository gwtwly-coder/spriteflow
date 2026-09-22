import {
  DEFAULT_DETECT_OPTIONS,
  DEFAULT_PACK_OPTIONS,
  type DetectOptions,
  ExportFormat,
  type ExportResult,
  type Frame,
  type PipelineClient,
  type PipelineError,
  type PackOptions,
  PipelineErrorCode,
  type PixelBuffer,
  type ProgressEvent,
} from "@spriteflow/pipeline";
import { createPipelineClient } from "@spriteflow/pipeline/browser";
import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasEditor } from "../editor/CanvasEditor";
import { type Locale, translate } from "../i18n";
import { type Store, useEditorStore } from "../store/editor-store";

type Screen = "upload" | "detect" | "review";
type Modal =
  | "oversize"
  | "memory"
  | "delete"
  | "reset"
  | "shortcuts"
  | "review"
  | "newFile"
  | "error"
  | null;
type ExportState = "closed" | "form" | "processing" | "success" | "failure";
const COPY = (
  locale: Locale,
  key: Parameters<typeof translate>[1],
  values?: Record<string, string | number>,
) => translate(locale, key, values);
const deepDetect = (): DetectOptions => structuredClone(DEFAULT_DETECT_OPTIONS);
const errorCopy = (error: PipelineError, locale: Locale) =>
  error.code === PipelineErrorCode.OpaqueInput
    ? [COPY(locale, "error.opaque.title"), COPY(locale, "error.opaque.body")]
    : error.code === PipelineErrorCode.DecodeFailed
      ? [COPY(locale, "error.decode.title"), COPY(locale, "error.decode.body")]
      : error.code === PipelineErrorCode.UnsupportedFormat ||
          error.code === PipelineErrorCode.AnimatedInputUnsupported
        ? [
            COPY(locale, "error.unsupported_type.title"),
            COPY(locale, "error.unsupported_type.body"),
          ]
        : error.code === PipelineErrorCode.MemoryLimit ||
            error.code === PipelineErrorCode.DimensionLimit
          ? [COPY(locale, "memory.runtime.title"), COPY(locale, "memory.runtime.body")]
          : [COPY(locale, "error.unknown.title"), COPY(locale, "error.unknown.body")];

export function App() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [screen, setScreen] = useState<Screen>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [asset, setAsset] = useState<{ assetId: string; revision: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [preview, setPreview] = useState<PixelBuffer | null>(null);
  const [preflight, setPreflight] = useState<"idle" | "preflight" | "decode" | "ready">("idle");
  const [dragOver, setDragOver] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState<PipelineError | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [currentTask, setCurrentTask] = useState<{ cancel(): Promise<unknown> } | null>(null);
  const [downscale, setDownscale] = useState(8192);
  const [exportState, setExportState] = useState<ExportState>("closed");
  const [exportFormat, setExportFormat] = useState<ExportFormat>(ExportFormat.PhaserJsonHash);
  const [packOptions, setPackOptions] = useState<PackOptions>(() => ({ ...DEFAULT_PACK_OPTIONS }));
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [manualRows, setManualRows] = useState(1);
  const [manualColumns, setManualColumns] = useState(1);
  const [degraded, setDegraded] = useState(false);
  const [pendingSettings, setPendingSettings] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const temporaryTool = useRef<Store["tool"] | null>(null);
  const clientRef = useRef<PipelineClient | null>(null);
  const store = useEditorStore();
  const included = store.drafts.filter((frame) => frame.included);
  const pending = included.filter((frame) => frame.reviewStatus === "pending");
  const maxGrid = manualRows * manualColumns > 500;
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    COPY(locale, key, values);
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  };
  const client = async () => {
    if (clientRef.current) return clientRef.current;
    const worker = new Worker(new URL("../workers/pipeline.worker.ts", import.meta.url), {
      type: "module",
    });
    const created = createPipelineClient(worker);
    const ready = await created.ready;
    if (!ready.ok) {
      setError(ready.error);
      setModal("error");
      throw ready.error;
    }
    clientRef.current = created;
    return created;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void clientRef.current?.dispose();
    },
    [],
  );
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  const submit = async (
    command: "load" | "detect" | "normalize" | "pack" | "export",
    payload: unknown,
  ): Promise<unknown> => {
    const pipeline = await client();
    const invoke = pipeline.submit as unknown as (
      name: string,
      value: unknown,
      progress: (event: ProgressEvent) => void,
    ) => {
      result: Promise<{ outcome: { ok: boolean; value?: unknown; error?: PipelineError } }>;
      cancel(): Promise<unknown>;
    };
    const task = invoke(command, payload, (event) => setProgress(event));
    setCurrentTask(task);
    const response = await task.result;
    setCurrentTask(null);
    if (!response.outcome.ok) throw response.outcome.error;
    return response.outcome.value;
  };
  const validateFile = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length !== 1) {
      setError({
        code: PipelineErrorCode.InvalidArgument,
        messageKey: "",
        stage: "validate" as never,
        recoverable: true,
        recoveryActions: ["choose-file"],
        details: {},
      });
      setPreflight("idle");
      return;
    }
    const candidate = list[0];
    if (!candidate || !["image/png", "image/webp"].includes(candidate.type)) {
      setError({
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
      setSize(dimensions);
      if (dimensions.width > 8192 || dimensions.height > 8192) {
        setDownscale(8192);
        setModal("oversize");
        return;
      }
      if (
        candidate.size > 52_428_800 ||
        dimensions.width * dimensions.height * 16 + 16 * 1024 * 1024 > 1_073_741_824
      ) {
        setDownscale(Math.min(4096, Math.max(dimensions.width, dimensions.height)));
        setModal("memory");
        return;
      }
      await loadAndDetect(candidate, null);
    } catch {
      setError({
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
  const loadAndDetect = async (
    candidate: File,
    resizeTo: { width: number; height: number } | null,
  ) => {
    setPreflight("decode");
    const nextAsset = { assetId: crypto.randomUUID().replaceAll("-", ""), revision: 1 };
    try {
      const pipeline = await client();
      if (asset) await pipeline.submit("release", { asset }).result;
      const result = (await submit("load", {
        kind: "encoded",
        ref: nextAsset,
        name: candidate.name,
        mimeHint: candidate.type,
        bytes: await candidate.arrayBuffer(),
        resizeTo,
      })) as { preview: PixelBuffer; asset: { workingSize: { width: number; height: number } } };
      setAsset(nextAsset);
      setPreview(result.preview);
      setSize(result.asset.workingSize);
      setPreflight("ready");
      await detect(nextAsset, deepDetect());
    } catch (caught) {
      const pipelineError = caught as PipelineError;
      if (pipelineError.code === PipelineErrorCode.MemoryLimit) {
        setError(pipelineError);
        setModal("memory");
      } else {
        setError(pipelineError);
        setPreflight("idle");
      }
    }
  };
  const detect = async (
    ref: { assetId: string; revision: number },
    options: DetectOptions,
    keepReviewVisible = false,
  ) => {
    if (!keepReviewVisible) setScreen("detect");
    setProgress(null);
    try {
      const result = (await submit("detect", { asset: ref, options })) as {
        frames: Frame[];
        options: DetectOptions;
        degraded: { suggestedGrid: { rows: number; columns: number } } | null;
        strategy: string;
      };
      store.setDocument(result.frames, result.options);
      setDegraded(result.degraded !== null);
      if (result.degraded) {
        setManualRows(result.degraded.suggestedGrid.rows);
        setManualColumns(result.degraded.suggestedGrid.columns);
      }
      setScreen("review");
      if (!result.degraded)
        notify(
          result.strategy === "grid"
            ? t("detect.success.grid", { count: result.frames.length })
            : t("detect.success.components", { count: result.frames.length }),
        );
    } catch (caught) {
      const pipelineError = caught as PipelineError;
      if (pipelineError.code === PipelineErrorCode.Cancelled) {
        if (!keepReviewVisible) setScreen("upload");
        notify(t("detect.cancelled"));
      } else {
        setError(pipelineError);
        if (!keepReviewVisible) setScreen("upload");
      }
    }
  };
  const applyManual = () => {
    if (!asset || maxGrid) return;
    setModal("reset");
  };
  const confirmManual = () => {
    setModal(null);
    if (!asset) return;
    const options = deepDetect();
    options.mode = "manual-grid";
    options.manualGrid = {
      rows: manualRows,
      columns: manualColumns,
      region: null,
      keepEmptyCells: true,
    };
    void detect(asset, options);
  };
  const normalize = async () => {
    if (!asset) return null;
    const result = (await submit("normalize", {
      asset,
      drafts: store.drafts,
      options: store.normalization,
    })) as { normalizationId: string; frames: Frame[] };
    store.setDocument(result.frames, store.detection);
    return result;
  };
  const startExport = async () => {
    if (included.length === 0) return;
    if (pending.length > 0) {
      setModal("review");
      return;
    }
    if (!asset) return;
    setExportState("processing");
    try {
      const normalized = await normalize();
      if (!normalized) return;
      let packId: string | null = null;
      if (exportFormat !== ExportFormat.GodotFramesZip) {
        const pack = (await submit("pack", {
          asset,
          normalizationId: normalized.normalizationId,
          options: packOptions,
        })) as { packId: string };
        packId = pack.packId;
      }
      const result = (await submit("export", {
        asset,
        normalizationId: normalized.normalizationId,
        packId,
        task: {
          format: exportFormat,
          baseName: "atlas",
          animations: [
            {
              name: "default",
              frameIds: store.drafts.filter((frame) => frame.included).map((frame) => frame.id),
              fps: store.fps,
              loop: true,
            },
          ],
        },
      })) as ExportResult;
      setExportResult(result);
      setExportState("success");
      download(result);
    } catch (caught) {
      setError(caught as PipelineError);
      setExportState("failure");
    }
  };
  const download = (result: ExportResult) => {
    const url = URL.createObjectURL(new Blob([result.archive], { type: result.mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const scheduleSettings = (
    name: "alphaThreshold" | "minAreaPx" | "dilationRadiusPx" | "mergeDistancePx",
    value: number,
  ) => {
    const detection = structuredClone(store.detection);
    if (name === "alphaThreshold") {
      detection.alphaThreshold = value;
      detection.normalize.alphaThreshold = value;
    } else detection[name] = value as never;
    setPendingSettings(true);
    if (asset) void detect(asset, { ...detection, quality: "preview" }, true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!asset) {
        setPendingSettings(false);
        return;
      }
      void detect(asset, { ...detection, quality: "final" }, true).finally(() =>
        setPendingSettings(false),
      );
    }, 300);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA"
      )
        return;
      if (event.key === "?") {
        event.preventDefault();
        setModal("shortcuts");
        return;
      }
      if (screen !== "review") return;
      if (event.ctrlKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        store.setSelection(store.drafts.filter((frame) => frame.included).map((frame) => frame.id));
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey
          ? useEditorStore.temporal.getState().redo()
          : useEditorStore.temporal.getState().undo();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        useEditorStore.temporal.getState().redo();
        return;
      }
      if (event.key === "Escape") {
        store.setSelection([]);
        setModal(null);
        return;
      }
      if (event.key === "v" || event.key === "V") store.setTool("select");
      if (event.key === "h" || event.key === "H") store.setTool("pan");
      if (event.key === "a" || event.key === "A") store.setTool("add");
      if (event.key === "s" || event.key === "S") store.setTool("split");
      if (event.key === "m" || event.key === "M") store.mergeSelected();
      if (event.code === "Space" && temporaryTool.current === null) {
        event.preventDefault();
        temporaryTool.current = store.tool;
        store.setTool("pan");
      }
      if (event.key === "+" || event.key === "=")
        store.setViewport(Math.min(32, store.zoom * 1.1), store.pan);
      if (event.key === "-") store.setViewport(Math.max(1 / 32, store.zoom / 1.1), store.pan);
      if (event.key === "0") window.dispatchEvent(new Event("spriteflow-fit"));
      if (event.key === "1") store.setViewport(1, store.pan);
      if (event.key === "2") store.setViewport(2, store.pan);
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        const delta = event.shiftKey ? 10 : 1;
        const dx = event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0;
        const dy = event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
        const rects = Object.fromEntries(
          store.drafts
            .filter((frame) => store.selected.includes(frame.id))
            .map((frame) => [
              frame.id,
              {
                ...frame.sourceRect,
                x: Math.max(0, frame.sourceRect.x + dx),
                y: Math.max(0, frame.sourceRect.y + dy),
              },
            ]),
        );
        if (Object.keys(rects).length) {
          event.preventDefault();
          store.updateRects(rects);
        }
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (store.selected.length) setModal("delete");
      }
      if (event.key === "Enter") store.setPreview(store.fps, store.onion, !store.playing);
      if (event.key === "o" || event.key === "O")
        store.setPreview(store.fps, !store.onion, store.playing);
      if (event.key === ",") {
        const activeIndex = store.drafts.findIndex((frame) => frame.id === store.selected[0]);
        const previous = store.drafts[Math.max(0, activeIndex - 1)];
        store.setSelection(previous ? [previous.id] : []);
      }
      if (event.key === ".") {
        const i = Math.min(
          store.drafts.length - 1,
          store.drafts.findIndex((frame) => frame.id === store.selected[0]) + 1,
        );
        if (store.drafts[i]) store.setSelection([store.drafts[i].id]);
      }
    };
    window.addEventListener("keydown", onKey);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && temporaryTool.current !== null) {
        store.setTool(temporaryTool.current);
        temporaryTool.current = null;
      }
    };
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [screen, store]);
  const activeFrames = useMemo(
    () =>
      store.drafts.map((draft, index) => ({
        draft,
        index,
        frame: store.normalized.find((frame) => frame.id === draft.id),
      })),
    [store.drafts, store.normalized],
  );
  return (
    <main className="app-shell">
      <header className="topbar">
        <strong>SpriteFlow</strong>
        {screen === "review" && (
          <>
            <span className="mono muted">{file?.name}</span>
            <span className="mono muted">
              {size?.width}×{size?.height}
            </span>
          </>
        )}
        <span className="grow" />
        <button className="ghost" onClick={() => setModal("shortcuts")}>
          {t("action.learn_shortcuts")}
        </button>
        {screen === "review" && (
          <button className="ghost" onClick={() => setModal("newFile")}>
            {t("action.new_file")}
          </button>
        )}
        <label className="lang">
          <span className="sr-only">{t("language.label")}</span>
          <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
            <option value="zh">{t("language.zh")}</option>
            <option value="en">{t("language.en")}</option>
          </select>
        </label>
      </header>
      <div aria-live="polite" className="sr-only">
        {progress ? t("status.busy") : t("status.ready")}
      </div>
      {screen === "upload" && (
        <Upload
          locale={locale}
          preflight={preflight}
          dragOver={dragOver}
          file={file}
          size={size}
          error={error}
          onFiles={validateFile}
          onDrag={setDragOver}
          onBrowse={() => document.getElementById("spriteflow-file")?.click()}
        />
      )}
      {screen === "detect" && (
        <Detect locale={locale} progress={progress} onCancel={() => void currentTask?.cancel()} />
      )}
      {screen === "review" && (
        <section className="review">
          <Toolbar
            locale={locale}
            pending={pending.length}
            included={included.length}
            disabled={pendingSettings}
            onExport={() => setExportState("form")}
            onConfirm={() => {
              store.confirm();
              notify(t("review.confirmed"));
            }}
            onDelete={() => setModal("delete")}
            onMerge={() => {
              store.mergeSelected();
              notify(t("editor.frames_merged", { count: store.selected.length }));
            }}
            onSplit={() => store.setTool("split")}
          />
          <div className="workspace">
            <section className="canvas-wrap">
              {store.detection.manualGrid === null && pendingSettings && (
                <div className="warning-banner">
                  {t("detect.recalculating")}{" "}
                  <button onClick={() => void currentTask?.cancel()}>{t("detect.cancel")}</button>
                </div>
              )}
              {degraded && (
                <div className="warning-banner">
                  <strong>{t("fallback.title")}</strong>
                  <span>{t("fallback.body")}</span>
                  <button onClick={applyManual}>{t("fallback.use_manual")}</button>
                </div>
              )}
              <CanvasEditor preview={preview} sourceSize={size} disabled={pendingSettings} />
            </section>
            <Sidebar
              locale={locale}
              store={store}
              maxGrid={maxGrid}
              rows={manualRows}
              columns={manualColumns}
              setRows={setManualRows}
              setColumns={setManualColumns}
              applyManual={applyManual}
              schedule={scheduleSettings}
            />
          </div>
          <Timeline locale={locale} frames={activeFrames} store={store} />
          <footer className="statusbar">
            <span className={progress ? "busy-dot" : "idle-dot"} />
            <span>{progress ? t("status.busy") : t("status.ready")}</span>
            <span className="grow" />
            <span className="mono">{Math.round(store.zoom * 100)}%</span>
            <span>
              {t(
                `detect.method.${store.detection.mode === "components" ? "components" : store.detection.mode === "manual-grid" ? "manual" : "grid"}` as never,
              )}
            </span>
            <span>{t("editor.summary", { count: included.length })}</span>
            {store.selected.length > 1 && (
              <span>{t("editor.selection_count", { count: store.selected.length })}</span>
            )}
          </footer>
        </section>
      )}
      {exportState !== "closed" && (
        <ExportDrawer
          locale={locale}
          state={exportState}
          format={exportFormat}
          setFormat={setExportFormat}
          packOptions={packOptions}
          setPackOptions={setPackOptions}
          included={included.length}
          result={exportResult}
          progress={progress}
          onClose={() => setExportState("closed")}
          onStart={() => void startExport()}
          onCancel={() => void currentTask?.cancel()}
          onDownload={() => exportResult && download(exportResult)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
      {modal && (
        <Modal
          locale={locale}
          kind={modal}
          size={size}
          downscale={downscale}
          setDownscale={setDownscale}
          selected={store.selected.length}
          onClose={() => setModal(null)}
          onConfirm={() => {
            if (modal === "oversize" || modal === "memory") {
              setModal(null);
              if (file && size) {
                const largest = Math.max(size.width, size.height);
                const scale = downscale / largest;
                void loadAndDetect(file, {
                  width: Math.max(1, Math.round(size.width * scale)),
                  height: Math.max(1, Math.round(size.height * scale)),
                });
              }
            } else if (modal === "delete") {
              store.removeSelected();
              setModal(null);
              notify(t("editor.frame_deleted"));
            } else if (modal === "reset") confirmManual();
            else if (modal === "newFile") {
              setScreen("upload");
              setFile(null);
              setAsset(null);
              setPreview(null);
              setDegraded(false);
              store.setDocument([], deepDetect());
              setModal(null);
            } else setModal(null);
          }}
          error={error}
        />
      )}
    </main>
  );
}

function Upload({
  locale,
  preflight,
  dragOver,
  file,
  size,
  error,
  onFiles,
  onDrag,
  onBrowse,
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
}) {
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    COPY(locale, key, values);
  const copy = error ? errorCopy(error, locale) : null;
  return (
    <section className="upload-stage">
      <input
        id="spriteflow-file"
        hidden
        type="file"
        accept="image/png,image/webp"
        onChange={(event) => event.target.files && void onFiles(event.target.files)}
      />
      <div className="upload-col">
        <h1>{t("app.tagline")}</h1>
        <p className="privacy">▣ {t("privacy.local_only")}</p>
        <button
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
          <strong>{dragOver ? t("upload.drop_active") : t("upload.empty.title")}</strong>
          <span>{t("upload.empty.hint")}</span>
        </button>
        <button className="primary" onClick={onBrowse}>
          {t("upload.browse")}
        </button>
        <div className="chips">
          <span>PNG</span>
          <span>WebP</span>
        </div>
      </div>
      {preflight !== "idle" && file && (
        <div className="file-card">
          <div>
            <span>{t("upload.file_name")}</span>
            <b>{file.name}</b>
          </div>
          <div>
            <span>{t("upload.file_type")}</span>
            <b>{file.type}</b>
          </div>
          <div>
            <span>{t("upload.file_size")}</span>
            <b>{size ? `${size.width}×${size.height}` : "—"}</b>
          </div>
          <p>◌ {preflight === "decode" ? t("upload.decode") : t("upload.preflight")}</p>
        </div>
      )}
      {copy && (
        <div className="error-card">
          <h2>{copy[0]}</h2>
          <p>{copy[1]}</p>
          <button className="danger-outline" onClick={onBrowse}>
            {t("error.choose_another")}
          </button>
        </div>
      )}
    </section>
  );
}
function Detect({
  locale,
  progress,
  onCancel,
}: {
  locale: Locale;
  progress: ProgressEvent | null;
  onCancel(): void;
}) {
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    COPY(locale, key, values);
  const percent = Math.round((progress?.overallProgress ?? 0) * 100);
  return (
    <section className="detect-stage">
      <div className="detect-card">
        <h1>{t("detect.title")}</h1>
        {[
          "detect.preparing",
          "detect.grid",
          "detect.components",
          "detect.comparing",
          "detect.finalizing",
        ].map((key) => (
          <p key={key} className="phase">
            {t(key as never)}
          </p>
        ))}
        <progress
          value={progress?.totalUnits === null ? undefined : percent}
          max="100"
          aria-label={t("detect.progress", { percent })}
        />
        <span className="mono">{percent}%</span>
        <button className="secondary" disabled={!progress?.cancellable} onClick={onCancel}>
          {t("detect.cancel")}
        </button>
      </div>
    </section>
  );
}

function Toolbar({
  locale,
  pending,
  included,
  disabled,
  onExport,
  onConfirm,
  onDelete,
  onMerge,
  onSplit,
}: {
  locale: Locale;
  pending: number;
  included: number;
  disabled: boolean;
  onExport(): void;
  onConfirm(): void;
  onDelete(): void;
  onMerge(): void;
  onSplit(): void;
}) {
  const store = useEditorStore();
  const t = (key: Parameters<typeof translate>[1]) => COPY(locale, key);
  const toolButton = (
    tool: typeof store.tool,
    key: Parameters<typeof translate>[1],
    shortcut: string,
  ) => (
    <button
      className={store.tool === tool ? "tool active" : "tool"}
      disabled={disabled && tool !== "select" && tool !== "pan"}
      title={`${t(key)} (${shortcut})`}
      onClick={() => store.setTool(tool)}
    >
      {t(key)} <kbd>{shortcut}</kbd>
    </button>
  );
  return (
    <nav className="toolbar">
      {toolButton("select", "tool.select", "V")}
      {toolButton("pan", "tool.pan", "H")}
      {toolButton("add", "tool.add_frame", "A")}
      {toolButton("split", "tool.split_frame", "S")}
      <i />
      <button className="tool" disabled={!store.selected.length || disabled} onClick={onDelete}>
        {t("tool.delete_frame")}
      </button>
      <button
        className="tool"
        disabled={store.selected.length < 2 || disabled}
        title={store.selected.length < 2 ? t("editor.select_to_merge") : undefined}
        onClick={onMerge}
      >
        {t("tool.merge_frames")} <kbd>M</kbd>
      </button>
      <button
        className="tool"
        disabled={store.selected.length !== 1 || disabled}
        title={store.selected.length !== 1 ? t("editor.select_one_to_split") : undefined}
        onClick={onSplit}
      >
        {t("tool.split_frame")}
      </button>
      <i />
      <button
        className="tool"
        disabled={!useEditorStore.temporal.getState().pastStates.length || disabled}
        onClick={() => useEditorStore.temporal.getState().undo()}
      >
        {t("tool.undo")}
      </button>
      <button
        className="tool"
        disabled={!useEditorStore.temporal.getState().futureStates.length || disabled}
        onClick={() => useEditorStore.temporal.getState().redo()}
      >
        {t("tool.redo")}
      </button>
      <span className="grow" />
      <button
        className={pending ? "primary" : "confirmed"}
        disabled={!included || !pending || disabled}
        onClick={onConfirm}
      >
        ✓ {t("tool.confirm_review")}
      </button>
      <button
        className={pending ? "secondary" : "primary"}
        disabled={!included || disabled}
        aria-describedby={!included ? "no-frames-help" : undefined}
        onClick={onExport}
      >
        {t("tool.export")}
      </button>
      <span id="no-frames-help" className="sr-only">
        {!included ? t("export.disabled_no_frames") : ""}
      </span>
    </nav>
  );
}

function Sidebar({
  locale,
  store,
  maxGrid,
  rows,
  columns,
  setRows,
  setColumns,
  applyManual,
  schedule,
}: {
  locale: Locale;
  store: Store;
  maxGrid: boolean;
  rows: number;
  columns: number;
  setRows(value: number): void;
  setColumns(value: number): void;
  applyManual(): void;
  schedule(
    name: "alphaThreshold" | "minAreaPx" | "dilationRadiusPx" | "mergeDistancePx",
    value: number,
  ): void;
}) {
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    COPY(locale, key, values);
  const manual = store.detection.mode === "manual-grid";
  const selected = store.normalized.find((frame) => frame.id === store.selected[0]);
  const slider = (
    name: "alphaThreshold" | "minAreaPx" | "dilationRadiusPx" | "mergeDistancePx",
    key: Parameters<typeof translate>[1],
    help: Parameters<typeof translate>[1],
    max: number,
    value: number | null,
  ) => (
    <label className="field">
      <span>
        {t(key)} <b className="mono">{value ?? "Auto"}</b>
      </span>
      <input
        type="range"
        min="0"
        max={max}
        value={value ?? 0}
        onChange={(event) => schedule(name, Number(event.target.value))}
      />
      <small>{t(help)}</small>
    </label>
  );
  return (
    <aside className="sidebar">
      <section>
        <h2>{t("detect.method.label")}</h2>
        <p className="method-chip">
          {t(
            `detect.method.${manual ? "manual" : store.detection.mode === "components" ? "components" : "grid"}` as never,
          )}
        </p>
        <button
          className="secondary full"
          onClick={() => store.setDocument(store.normalized, deepDetect())}
        >
          {t("detect.recalculate")}
        </button>
        {!manual && (
          <button
            className="link"
            onClick={() =>
              store.setDocument(store.normalized, {
                ...store.detection,
                mode: "manual-grid",
                manualGrid: { rows, columns, region: null, keepEmptyCells: true },
              })
            }
          >
            {t("fallback.bad_result")}
          </button>
        )}
      </section>
      {manual ? (
        <section>
          <h2>{t("manual.title")}</h2>
          <label className="field">
            <span>{t("manual.rows")}</span>
            <input
              type="number"
              min="1"
              max="100"
              value={rows}
              aria-invalid={maxGrid}
              aria-describedby={maxGrid ? "grid-limit" : undefined}
              onChange={(event) => setRows(Math.max(1, Number(event.target.value)))}
            />
          </label>
          <label className="field">
            <span>{t("manual.columns")}</span>
            <input
              type="number"
              min="1"
              max="100"
              value={columns}
              aria-invalid={maxGrid}
              aria-describedby={maxGrid ? "grid-limit" : undefined}
              onChange={(event) => setColumns(Math.max(1, Number(event.target.value)))}
            />
          </label>
          {maxGrid && (
            <p id="grid-limit" role="alert" className="inline-error">
              {t("manual.grid_too_large", { count: rows * columns })}
            </p>
          )}
          <button className="primary full" disabled={maxGrid} onClick={applyManual}>
            {t("manual.apply")}
          </button>
          <button
            className="secondary full"
            onClick={() => {
              setRows(1);
              setColumns(1);
            }}
          >
            {t("manual.reset")}
          </button>
          <small>{t("manual.draw_hint")}</small>
        </section>
      ) : (
        <section>
          <h2>{t("settings.detection")}</h2>
          {slider(
            "alphaThreshold",
            "settings.tolerance",
            "settings.tolerance_help",
            254,
            store.detection.alphaThreshold,
          )}
          {slider(
            "minAreaPx",
            "settings.min_area",
            "settings.min_area_help",
            1000000,
            store.detection.minAreaPx,
          )}
          {slider(
            "dilationRadiusPx",
            "settings.dilation",
            "settings.dilation_help",
            128,
            store.detection.dilationRadiusPx,
          )}
          {slider(
            "mergeDistancePx",
            "settings.merge_distance",
            "settings.merge_distance_help",
            512,
            store.detection.mergeDistancePx,
          )}
          <button
            className="secondary full"
            onClick={() => store.setDocument(store.normalized, deepDetect())}
          >
            {t("settings.reset")}
          </button>
        </section>
      )}{" "}
      {selected && (
        <section>
          <h2>{t("editor.normalized_preview")}</h2>
          <div className="normal-preview">
            <span>
              {selected.canvas.width}×{selected.canvas.height}
            </span>
          </div>
          <p className="mono">
            {t("editor.frame_size", {
              width: selected.sourceRect.width,
              height: selected.sourceRect.height,
            })}
          </p>
          <small>{t("editor.normalized_preview_help")}</small>
        </section>
      )}
    </aside>
  );
}

function Timeline({
  locale,
  frames,
  store,
}: {
  locale: Locale;
  frames: { draft: Store["drafts"][number]; index: number; frame: Frame | undefined }[];
  store: Store;
}) {
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    COPY(locale, key, values);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const flagged = frames.filter(
    ({ frame }) =>
      frame && (frame.flags.outlier || frame.flags.multipleComponents || frame.flags.empty),
  ).length;
  const visible = (frame: Frame | undefined) =>
    !frame ||
    store.filter === "all" ||
    (store.filter === "attention" &&
      (frame.flags.outlier || frame.flags.multipleComponents || frame.flags.empty)) ||
    (store.filter === "outlier" && frame.flags.outlier) ||
    (store.filter === "multipleComponents" && frame.flags.multipleComponents) ||
    (store.filter === "empty" && frame.flags.empty);
  const filters: [typeof store.filter, Parameters<typeof translate>[1], number][] = [
    ["all", "review.filter.all", frames.length],
    ["attention", "review.filter.attention", flagged],
    ["outlier", "review.filter.outlier", frames.filter(({ frame }) => frame?.flags.outlier).length],
    [
      "multipleComponents",
      "review.filter.multiple_components",
      frames.filter(({ frame }) => frame?.flags.multipleComponents).length,
    ],
    ["empty", "review.filter.empty", frames.filter(({ frame }) => frame?.flags.empty).length],
  ];
  const move = (offset: number) => {
    const from = frames.findIndex((entry) => entry.draft.id === store.selected[0]);
    const next = frames[Math.max(0, Math.min(frames.length - 1, from + offset))];
    if (next) store.setSelection([next.draft.id]);
  };
  return (
    <section className="timeline">
      <header>
        <b>{t("preview.title")}</b>
        <button
          disabled={!frames.length}
          onClick={() => store.setPreview(store.fps, store.onion, !store.playing)}
        >
          {t(store.playing ? "preview.pause" : "preview.play")}
        </button>
        <button disabled={!frames.length} onClick={() => move(-1)}>
          {t("preview.previous")}
        </button>
        <button disabled={!frames.length} onClick={() => move(1)}>
          {t("preview.next")}
        </button>
        <label>
          {t("preview.fps", { fps: store.fps })}
          <input
            type="number"
            min="1"
            max="120"
            value={store.fps}
            onChange={(event) =>
              store.setPreview(Number(event.target.value), store.onion, store.playing)
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={store.onion}
            onChange={(event) => store.setPreview(store.fps, event.target.checked, store.playing)}
          />
          {t("preview.onion_skin")}
        </label>
        <span className="grow" />
        <span>{t("review.filter.label")}</span>
        {filters
          .filter(([type, , count]) => type === "all" || type === "attention" || count > 0)
          .map(([type, key, count]) => (
            <button
              className={store.filter === type ? "filter active" : "filter"}
              key={type}
              onClick={() => store.setFilter(type)}
            >
              {t(key)} <b>{count}</b>
            </button>
          ))}
      </header>
      {flagged > 0 && (
        <div className="attention">
          {t("review.attention.title", { count: flagged })} — {t("review.attention.body")}
        </div>
      )}
      <div className="frame-row">
        {!frames.length ? (
          <p>{t("preview.empty")}</p>
        ) : !frames.some(({ frame }) => visible(frame)) ? (
          <p>
            {t("review.filter.none")}{" "}
            <button className="link" onClick={() => store.setFilter("all")}>
              {t("review.filter.all")}
            </button>
          </p>
        ) : (
          frames
            .filter(({ frame }) => visible(frame))
            .map(({ draft, index, frame }) => (
              <button
                draggable
                key={draft.id}
                className={store.selected.includes(draft.id) ? "frame-chip active" : "frame-chip"}
                onClick={(event) =>
                  store.setSelection(event.shiftKey ? [...store.selected, draft.id] : [draft.id])
                }
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null) store.reorder(dragIndex, index);
                  setDragIndex(null);
                }}
              >
                <span>{index + 1}</span>
                <i className={frame?.flags.empty ? "empty-dot" : "thumb"} />
                {frame?.flags.outlier && <em className="outlier" />}
                {frame?.flags.multipleComponents && <em className="multi" />}
                {frame?.flags.empty && <em className="empty" />}
              </button>
            ))
        )}
      </div>
    </section>
  );
}

function ExportDrawer({
  locale,
  state,
  format,
  setFormat,
  packOptions,
  setPackOptions,
  included,
  result,
  progress,
  onClose,
  onStart,
  onCancel,
  onDownload,
}: {
  locale: Locale;
  state: ExportState;
  format: ExportFormat;
  setFormat(value: ExportFormat): void;
  packOptions: PackOptions;
  setPackOptions(value: PackOptions): void;
  included: number;
  result: ExportResult | null;
  progress: ProgressEvent | null;
  onClose(): void;
  onStart(): void;
  onCancel(): void;
  onDownload(): void;
}) {
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    COPY(locale, key, values);
  const percent = Math.round((progress?.overallProgress ?? 0) * 100);
  return (
    <aside className="drawer" aria-label={t("export.title")}>
      {state === "processing" ? (
        <div className="drawer-state">
          <h1>{t("export.preparing")}</h1>
          <p>
            {progress?.stage === "pack"
              ? t("export.packing")
              : progress?.stage === "encode"
                ? format === ExportFormat.GodotFramesZip
                  ? t("export.writing_godot")
                  : t("export.writing_phaser")
                : t("export.zipping")}
          </p>
          <progress value={percent} max="100" aria-label={t("export.progress", { percent })} />
          <button className="secondary" disabled={!progress?.cancellable} onClick={onCancel}>
            {t("export.cancel")}
          </button>
        </div>
      ) : state === "success" && result ? (
        <div className="drawer-state">
          <h1>✓ {t("export.success.title")}</h1>
          <p>{t("export.success.body", { name: result.fileName })}</p>
          <button className="primary" onClick={onDownload}>
            {t("export.download")}
          </button>
          <button className="secondary" onClick={onClose}>
            {t("export.continue_editing")}
          </button>
        </div>
      ) : state === "failure" ? (
        <div className="drawer-state">
          <h1>{t("export.failed.title")}</h1>
          <p>{t("export.failed.body")}</p>
          <button className="primary" onClick={onStart}>
            {t("action.retry")}
          </button>
          <button className="secondary" onClick={onClose}>
            {t("export.back")}
          </button>
        </div>
      ) : (
        <>
          <header>
            <h1>{t("export.title")}</h1>
            <button className="tool" onClick={onClose}>
              ×
            </button>
          </header>
          <p>{t("export.summary", { count: included })}</p>
          <section>
            <h2>{t("export.format")}</h2>
            {[
              [ExportFormat.PhaserJsonHash, "export.phaser_hash"],
              [ExportFormat.PhaserJsonArray, "export.phaser_array"],
              [ExportFormat.GodotFramesZip, "export.godot"],
            ].map(([value, key]) => (
              <label className="export-choice" key={value as string}>
                <input
                  type="radio"
                  checked={format === value}
                  onChange={() => setFormat(value as ExportFormat)}
                />
                {t(key as never)}
                <small>
                  {value === ExportFormat.GodotFramesZip
                    ? "frames/ + sequence.json"
                    : "atlas.png + atlas.json + animations.json"}
                </small>
              </label>
            ))}
          </section>
          {format !== ExportFormat.GodotFramesZip && (
            <section>
              <h2>{t("export.atlas_settings")}</h2>
              <p>{t("export.atlas_size")}</p>
              <div className="size-options">
                <button
                  type="button"
                  className={packOptions.sizeMode === "auto" ? "filter active" : "filter"}
                  onClick={() => setPackOptions({ ...packOptions, sizeMode: "auto" })}
                >
                  {t("export.size_auto")}
                </button>
                <button
                  type="button"
                  className={packOptions.sizeMode === "pot" && packOptions.maxWidth === 2048 ? "filter active" : "filter"}
                  onClick={() => setPackOptions({ ...packOptions, sizeMode: "pot", maxWidth: 2048, maxHeight: 2048 })}
                >
                  {t("export.size_pot_2048")}
                </button>
                <button
                  type="button"
                  className={packOptions.sizeMode === "pot" && packOptions.maxWidth === 4096 ? "filter active" : "filter"}
                  onClick={() => setPackOptions({ ...packOptions, sizeMode: "pot", maxWidth: 4096, maxHeight: 4096 })}
                >
                  {t("export.size_pot_4096")}
                </button>
              </div>
              <label className="field">
                <span>{t("export.size_limit")}</span>
                <input
                  type="number"
                  value={packOptions.maxWidth}
                  min="64"
                  max="8192"
                  onChange={(event) => {
                    const limit = Math.max(64, Math.min(8192, Number(event.target.value) || 64));
                    setPackOptions({ ...packOptions, maxWidth: limit, maxHeight: limit, sizeMode: "auto" });
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={packOptions.allowRotation}
                  onChange={(event) => setPackOptions({ ...packOptions, allowRotation: event.target.checked })}
                /> {t("export.rotation")}
              </label>
              <p className="muted">
                {t("export.padding")}: 2 px · {t("export.extrude")}: 1 px
              </p>
            </section>
          )}
          <footer>
            <button className="secondary" onClick={onClose}>
              {t("export.back")}
            </button>
            <button className="primary" onClick={onStart}>
              {t("export.start")}
            </button>
          </footer>
        </>
      )}
    </aside>
  );
}

function Modal({
  locale,
  kind,
  size,
  downscale,
  setDownscale,
  selected,
  onClose,
  onConfirm,
  error,
}: {
  locale: Locale;
  kind: Modal;
  size: { width: number; height: number } | null;
  downscale: number;
  setDownscale(value: number): void;
  selected: number;
  onClose(): void;
  onConfirm(): void;
  error: PipelineError | null;
}) {
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    COPY(locale, key, values);
  let title = "",
    body = "",
    confirm = t("action.close"),
    dangerous = false;
  if (kind === "oversize") {
    title = t("oversize.title");
    body = t("oversize.body", size ?? {});
    confirm = t("oversize.continue");
  } else if (kind === "memory") {
    title = t("memory.precheck.title");
    body = t("memory.precheck.body");
    confirm = t("memory.downscale_retry");
  } else if (kind === "delete") {
    title =
      selected > 1
        ? t("confirm.delete_many.title", { count: selected })
        : t("confirm.delete_one.title");
    body = t("confirm.delete.body");
    confirm = t("confirm.delete.action");
    dangerous = true;
  } else if (kind === "reset") {
    title = t("confirm.reset_detection.title");
    body = t("confirm.reset_detection.body");
    confirm = t("confirm.reset_detection.action");
  } else if (kind === "newFile") {
    title = t("confirm.new_file.title");
    body = t("confirm.new_file.body");
    confirm = t("confirm.new_file.action");
  } else if (kind === "review") {
    title = t("export.review_required.title");
    body = t("export.review_required.body");
    confirm = t("export.review_required.action");
  } else if (kind === "error") {
    const copy = error
      ? errorCopy(error, locale)
      : [t("error.unknown.title"), t("error.unknown.body")];
    title = copy[0] ?? "";
    body = copy[1] ?? "";
  }
  if (kind === "shortcuts")
    return (
      <div className="modal-wrap">
        <dialog open className="modal shortcuts">
          <h1>{t("shortcuts.title")}</h1>
          <dl>
            {[
              ["V", "tool.select"],
              ["H / Space", "tool.pan"],
              ["A", "tool.add_frame"],
              ["S", "tool.split_frame"],
              ["M", "tool.merge_frames"],
              ["Delete", "tool.delete_frame"],
              ["Ctrl+Z / Ctrl+Y", "tool.undo"],
              ["0 / 1 / 2", "tool.fit"],
              ["Enter", "preview.play"],
              ["O", "preview.onion_skin"],
            ].map(([key, copy]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{t(copy as never)}</dd>
              </div>
            ))}
          </dl>
          <button className="secondary" onClick={onClose}>
            {t("shortcuts.close")}
          </button>
        </dialog>
      </div>
    );
  return (
    <div className="modal-wrap">
      <dialog open className="modal" aria-modal="true">
        <h1>{title}</h1>
        <p>{body}</p>
        {(kind === "oversize" || kind === "memory") && (
          <label className="field">
            <span>{t("oversize.target")}</span>
            <select
              value={downscale}
              onChange={(event) => setDownscale(Number(event.target.value))}
            >
              {[8192, 6144, 4096, 2048].map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
        )}
        <footer>
          <button className="secondary" onClick={onClose}>
            {kind === "oversize" ? t("oversize.cancel") : t("action.cancel")}
          </button>
          <button className={dangerous ? "danger" : "primary"} onClick={onConfirm}>
            {confirm}
          </button>
        </footer>
      </dialog>
    </div>
  );
}
