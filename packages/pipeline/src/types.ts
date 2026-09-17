// Public declarations transcribed from interface-contract.md 3.0.0 / r4.
export type AssetId = string;
export type FrameId = string;
export type ClusterId = string;
export type TaskId = string;
export type ResultId = string;

export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point, Size {}
export interface AssetRef {
  assetId: AssetId;
  revision: number;
}

export interface PixelBuffer extends Size {
  format: "rgba8";
  colorSpace: "srgb";
  alphaMode: "straight";
  data: Uint8ClampedArray;
}

export interface InputAsset {
  ref: AssetRef;
  name: string;
  sourceMime: "image/png" | "image/webp" | "application/x-rgba8";
  originalSize: Size;
  pixels: PixelBuffer;
  scaleFromOriginal: { x: number; y: number };
}

export interface AssetInfo {
  ref: AssetRef;
  name: string;
  sourceMime: InputAsset["sourceMime"];
  originalSize: Size;
  workingSize: Size;
  scaleFromOriginal: { x: number; y: number };
  alpha: { transparent: number; translucent: number; opaque: number };
}

export interface PerceptualHash {
  algorithm: "dhash64-v1";
  hex: string;
}

export interface FrameFlags {
  outlier: boolean;
  merged: boolean;
  multipleComponents: boolean;
  empty: boolean;
  edited: boolean;
  duplicateOf: FrameId | null;
}

export interface FrameCanvas extends Size {
  offset: Point;
}

export interface Frame {
  id: FrameId;
  asset: AssetRef;
  name: string;
  sourceRect: Rect;
  bbox: Rect | null;
  canvas: FrameCanvas;
  pHash: PerceptualHash | null;
  clusterId: ClusterId | null;
  flags: FrameFlags;
  origin: "grid" | "components" | "manual";
  sourceFrameIds: FrameId[];
  included: boolean;
  reviewStatus: "pending" | "accepted";
}

export interface FrameDraft {
  id: FrameId;
  name: string;
  sourceRect: Rect;
  origin: Frame["origin"];
  sourceFrameIds: FrameId[];
  edited: boolean;
  included: boolean;
  reviewStatus: Frame["reviewStatus"];
}

export interface NormalizeOptions {
  alphaThreshold: number;
  componentMinAreaPx: number;
  trim: boolean;
  padding: number;
  canvasMode: "per-frame" | "uniform";
  alignment: "top-left" | "center";
  computeHash: boolean;
  outlierThreshold: number;
  clusterTolerance: number;
}

export interface NormalizeResult {
  asset: AssetRef;
  frames: Frame[];
  options: NormalizeOptions;
  warnings: PipelineWarning[];
}

export interface GridOptions {
  gutterOccupancyThreshold: number;
  minGutterPx: number;
  minCellPx: number;
  periodTolerance: number;
  confidenceThreshold: number;
  keepEmptyCells: boolean;
}

export interface ManualGrid {
  rows: number;
  columns: number;
  region: Rect | null;
  keepEmptyCells: boolean;
}

export interface DetectOptions {
  mode: "auto" | "grid" | "components" | "manual-grid";
  quality: "preview" | "final";
  alphaThreshold: number;
  minAreaPx: number;
  minAreaRatio: number;
  dilationRadiusPx: number | null;
  mergeDistancePx: number | null;
  mergeDistanceRatio: number;
  connectivity: 8;
  analysisMaxDimension: number;
  componentConfidenceThreshold: number;
  maxFrames: number;
  grid: GridOptions;
  manualGrid: ManualGrid | null;
  normalize: NormalizeOptions;
}

export type DetectStrategy = "grid" | "components" | "manual-grid";
export enum DegradedReason {
  LowConfidence = "LOW_CONFIDENCE",
  EmptyInput = "EMPTY_INPUT",
  InsufficientComponents = "INSUFFICIENT_COMPONENTS",
  AmbiguousComponents = "AMBIGUOUS_COMPONENTS",
  FrameLimitExceeded = "FRAME_LIMIT_EXCEEDED",
}

export interface Degradation {
  reason: DegradedReason;
  attempted: ("grid" | "components")[];
  suggestedGrid: ManualGrid;
}

export interface DetectDiagnostics {
  gridConfidence: number;
  componentConfidence: number;
  componentCount: number;
  filteredComponentCount: number;
  foregroundPixels: number;
  effectiveMinAreaPx: number;
  effectiveDilationRadiusPx: number;
  effectiveMergeDistancePx: number;
}

export interface DetectResult {
  asset: AssetRef;
  quality: DetectOptions["quality"];
  frames: Frame[];
  strategy: DetectStrategy;
  confidence: number;
  degraded: Degradation | null;
  options: DetectOptions;
  diagnostics: DetectDiagnostics;
  warnings: PipelineWarning[];
}

export interface PackOptions {
  maxWidth: number;
  maxHeight: number;
  sizeMode: "auto" | "pot";
  padding: number;
  extrude: number;
  border: number;
  allowRotation: boolean;
  maxPages: number;
  heuristic: "max-edge" | "max-area";
}

export interface PackedFrame {
  frameId: FrameId;
  name: string;
  sourceRect: Rect;
  bbox: Rect | null;
  pageIndex: number;
  allocation: Rect;
  rect: Rect;
  rotated: boolean;
  sourceSize: Size;
  spriteSourceSize: Rect;
  empty: boolean;
}

export interface AtlasPage extends Size {
  index: number;
  frameIds: FrameId[];
}

export interface PackResult {
  asset: AssetRef;
  options: PackOptions;
  pages: AtlasPage[];
  frames: PackedFrame[];
  frameOrder: FrameId[];
  warnings: PipelineWarning[];
}

export enum ExportFormat {
  PhaserJsonHash = "phaser-json-hash",
  PhaserJsonArray = "phaser-json-array",
  GodotFramesZip = "godot-frames-zip",
  PngSequenceZip = "png-sequence-zip",
  GenericJson = "generic-json",
}

export interface AnimationSpec {
  name: string;
  frameIds: FrameId[];
  fps: number;
  loop: boolean;
}

export interface ExportTask {
  format: ExportFormat;
  baseName: string;
  animations: AnimationSpec[];
}

export interface OutputFile {
  path: string;
  mime: "image/png" | "application/json" | "text/plain";
  bytes: ArrayBuffer;
}

export interface FileManifestEntry {
  path: string;
  mime: OutputFile["mime"];
  byteLength: number;
}

export interface ExportResult {
  format: ExportFormat;
  fileName: string;
  mime: "application/zip";
  archive: ArrayBuffer;
  files: FileManifestEntry[];
  warnings: PipelineWarning[];
}

export interface ExportSource {
  asset: InputAsset;
  frames: Frame[];
  pack: PackResult | null;
}

export interface GenericAtlasDocument {
  schemaVersion: "spriteflow-atlas/1";
  generator: "SpriteFlow M1";
  coordinateSystem: "top-left-half-open-pixels";
  asset: AssetRef;
  pages: { index: number; file: string; size: Size }[];
  frames: {
    id: FrameId;
    name: string;
    pageIndex: number;
    rect: Rect;
    rotated: boolean;
    sourceSize: Size;
    spriteSourceSize: Rect;
    empty: boolean;
  }[];
  frameOrder: FrameId[];
  animations: AnimationSpec[];
}

export interface SequenceDocument {
  schemaVersion: "spriteflow-sequence/1";
  frames: { id: FrameId; name: string; file: string; size: Size }[];
  animations: AnimationSpec[];
}

export interface ResourceLimits {
  maxInputBytes: number;
  maxDimension: number;
  maxPixels: number;
  memoryBudgetBytes: number;
  maxFrames: number;
  maxArchiveBytes: number;
}

export interface PngCodec {
  encode(pixels: PixelBuffer, context: ExecutionContext): Promise<ArrayBuffer>;
}

export interface ExecutionContext {
  taskId: TaskId;
  limits: ResourceLimits;
  isCancelled(): boolean;
  yieldControl(): Promise<void>;
  onProgress(event: ProgressEvent): void;
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: PipelineError };

export enum PipelineErrorCode {
  InvalidArgument = "INVALID_ARGUMENT",
  UnsupportedFormat = "UNSUPPORTED_FORMAT",
  AnimatedInputUnsupported = "ANIMATED_INPUT_UNSUPPORTED",
  DecodeFailed = "DECODE_FAILED",
  OpaqueInput = "OPAQUE_INPUT",
  MemoryLimit = "MEMORY_LIMIT",
  DimensionLimit = "DIMENSION_LIMIT",
  AssetNotFound = "ASSET_NOT_FOUND",
  StaleResult = "STALE_RESULT",
  ReviewRequired = "REVIEW_REQUIRED",
  NoFrames = "NO_FRAMES",
  FrameTooLarge = "FRAME_TOO_LARGE",
  PackOverflow = "PACK_OVERFLOW",
  ExportIncompatible = "EXPORT_INCOMPATIBLE",
  EncodeFailed = "ENCODE_FAILED",
  ArchiveLimit = "ARCHIVE_LIMIT",
  Cancelled = "CANCELLED",
  Busy = "BUSY",
  WorkerUnavailable = "WORKER_UNAVAILABLE",
  WorkerCrashed = "WORKER_CRASHED",
  ProtocolMismatch = "PROTOCOL_MISMATCH",
  InternalError = "INTERNAL_ERROR",
}

export enum PipelineWarningCode {
  DetectionDegraded = "DETECTION_DEGRADED",
  OutlierFrames = "OUTLIER_FRAMES",
  MultipleComponents = "MULTIPLE_COMPONENTS",
  EmptyFrames = "EMPTY_FRAMES",
}

export type RecoveryAction =
  | "fix-options"
  | "choose-file"
  | "downsample"
  | "manual-edit"
  | "review"
  | "repack"
  | "change-format"
  | "retry"
  | "restart-worker"
  | "release-asset";

export interface PipelineError {
  code: PipelineErrorCode;
  messageKey: string;
  stage: ProgressStage;
  recoverable: boolean;
  recoveryActions: RecoveryAction[];
  details: {
    field?: string;
    limit?: number;
    actual?: number;
    estimatedBytes?: number;
    suggestedSize?: Size;
    frameIds?: FrameId[];
  };
}

export interface PipelineWarning {
  code: PipelineWarningCode;
  messageKey: string;
  frameIds: FrameId[];
  reason: DegradedReason | null;
}

export enum ProgressStage {
  Validate = "validate",
  Decode = "decode",
  Analyze = "analyze",
  Grid = "grid",
  Components = "components",
  Normalize = "normalize",
  Hash = "hash",
  Pack = "pack",
  Render = "render",
  Encode = "encode",
  Archive = "archive",
  Complete = "complete",
}

export interface ProgressEvent {
  protocolVersion: 1;
  type: "progress";
  taskId: TaskId;
  asset: AssetRef | null;
  stage: ProgressStage;
  stageProgress: number;
  overallProgress: number;
  completedUnits: number;
  totalUnits: number | null;
  cancellable: boolean;
}

export interface InitOptions {
  protocolVersion: 1;
  limits: ResourceLimits;
}

export interface WorkerCapabilities {
  protocolVersion: 1;
  contractVersion: "3.0.0";
  decode: ("image/png" | "image/webp")[];
  encode: ["image/png"];
  offscreenCanvas: true;
  limits: ResourceLimits;
}

export type LoadInput =
  | {
      kind: "encoded";
      ref: AssetRef;
      name: string;
      mimeHint: string;
      bytes: ArrayBuffer;
      resizeTo: Size | null;
    }
  | { kind: "rgba"; asset: InputAsset };

export interface LoadResult {
  asset: AssetInfo;
  preview: PixelBuffer;
}

export interface PreviewRequest {
  asset: AssetRef;
  sourceRect: Rect | null;
  maxDimension: number;
}

export interface NormalizeRequest {
  asset: AssetRef;
  drafts: FrameDraft[];
  options: NormalizeOptions;
}

export interface StoredNormalizeResult extends NormalizeResult {
  normalizationId: ResultId;
}
export interface StoredPackResult extends PackResult {
  normalizationId: ResultId;
  packId: ResultId;
}

export interface CommandPayloads {
  load: LoadInput;
  detect: { asset: AssetRef; options: DetectOptions };
  preview: PreviewRequest;
  normalize: NormalizeRequest;
  pack: { asset: AssetRef; normalizationId: ResultId; options: PackOptions };
  export: {
    asset: AssetRef;
    normalizationId: ResultId;
    packId: ResultId | null;
    task: ExportTask;
  };
  release: { asset: AssetRef };
}

export interface CommandResults {
  load: LoadResult;
  detect: DetectResult;
  preview: PixelBuffer;
  normalize: StoredNormalizeResult;
  pack: StoredPackResult;
  export: ExportResult;
  release: { released: boolean };
}

export type Command = keyof CommandPayloads;
export type TaskRequest<K extends Command = Command> = {
  [P in K]: {
    protocolVersion: 1;
    taskId: TaskId;
    command: P;
    payload: CommandPayloads[P];
  };
}[K];

export type TaskResponse<K extends Command = Command> = {
  [P in K]: {
    protocolVersion: 1;
    taskId: TaskId;
    command: P;
    outcome: Outcome<CommandResults[P]>;
  };
}[K];

export interface CancelResult {
  taskId: TaskId;
  status: "requested" | "already-finished" | "unknown";
}

export interface PipelineWorkerApi {
  init(options: InitOptions): Promise<Outcome<WorkerCapabilities>>;
  execute<K extends Command>(
    request: TaskRequest<K>,
    onProgress: (event: ProgressEvent) => void,
  ): Promise<TaskResponse<K>>;
  cancel(taskId: TaskId): Promise<CancelResult>;
  dispose(): Promise<void>;
}

export interface PendingTask<K extends Command> {
  taskId: TaskId;
  result: Promise<TaskResponse<K>>;
  cancel(): Promise<CancelResult>;
}

export interface PipelineClient {
  ready: Promise<Outcome<WorkerCapabilities>>;
  submit<K extends Command>(
    command: K,
    payload: CommandPayloads[K],
    onProgress?: (event: ProgressEvent) => void,
  ): PendingTask<K>;
  dispose(): Promise<void>;
}
