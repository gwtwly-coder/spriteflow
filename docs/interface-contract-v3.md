# SpriteFlow v3 segment / rig 公共接口契约

> 版本：0.2.0-r2；日期：2026-09-29；状态：按 PRD v3.0-alpha 对齐，既有 Gate 1 文档验收已通过；当前实现范围与接续见 project-state.md。本文技术条款未因流程迁移而修改。
>
> 本文件定义 `@spriteflow/segment`、`@spriteflow/segment/browser` 与 `@spriteflow/rig` 的公共 API；代码标识符为英文，本文说明为中文。文中代码块是完整的接口声明/调用形状，不是功能实现。
>
> **与 M1 的关系：**本契约依赖但不修改 M1 [interface-contract.md](./interface-contract.md) 的 3.0.0/r4。项目必须使用该版本根入口已导出的 `AssetRef`、`InputAsset`、`PixelBuffer`、`Rect`、`Point`、`Size`、`FrameDraft`、`AnimationSpec`、`Outcome` 等类型。M1 契约的像素、坐标、资源上限和 `FrameDraft` 语义继续适用；出现冲突时，先按流程修订 v3 契约，不能暗改 M1 文件或运行时类型。
>
> **版本边界：**v3 契约版本独立演进，不提升 M1 的 `CONTRACT_VERSION` / `PROTOCOL_VERSION`。v3.0-alpha 定义部位分割、BYOK 定位、SAM 会话与部位 ZIP 导出。RigSpec/MotionPreset/逐帧渲染章节是 v3.5 预留 API，当前不属于 `@spriteflow/rig` 可发布实现或 v3.0-alpha 的验收范围。L3 遮挡补全仅有 v3.1 类型占位和显式未实现返回。

## 1. 公共规则与包入口

本契约使用 M1 `Rect` 的左上原点、整数半开区间、工作图像像素坐标。所有矩形必须在 `InputAsset.pixels` 的 `[0,width) × [0,height)` 范围内。源 `AssetRef` 在整个角色工作区内固定指向同一像素；改变像素、缩放或替换图像必须使用新 revision。未知字段、非法坐标、非有限数及超过资源上限的请求返回 `CharacterError`，不抛未约定异常。

桌面输入边长和透明度预检沿用 M1 / PRD 上限（边长≤8192）；当需降采样或超出 `CharacterLimits` 的 2048 工作边/4,194,304 像素预算时，必须走 M1 用户确认的降采样并以新 `AssetRef` 重载。segment 不得静默缩图或沿用旧资产 revision。性能验收样例另限制最长边≤2048。

`@spriteflow/segment` 根入口与 `@spriteflow/rig` 根入口仅使用 ES2022/TypedArray，可在 Node 导入和测试，不引用 DOM、Worker、fetch、Cache API、Canvas 或 ORT 类型。浏览器专用能力仅从 `@spriteflow/segment/browser` 导入。异步调用返回 `CharacterOutcome<T>`；取消通过 `CharacterExecutionContext` 检查，不使用 `AbortSignal` 污染纯逻辑根入口。结果对象不持有未声明的 Worker proxy、函数或 Canvas 实例。

```ts
import type {
  AnimationSpec,
  AssetRef,
  FrameDraft,
  InputAsset,
  Outcome,
  PixelBuffer,
  Point,
  Rect,
  Size,
} from "@spriteflow/pipeline";

export declare const V3_CONTRACT_VERSION: "3.0.0";
export declare const V3_PROTOCOL_VERSION: 1;

export type PartId = string;
export type BoneId = string;
export type MotionId = string;
export type ModelId = string;
export type SessionId = string;
export type V3TaskId = string;

export type CharacterOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: CharacterError };

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

export declare const DEFAULT_CHARACTER_LIMITS: Readonly<CharacterLimits>;
```

字段默认值：`maxWorkingDimension=2048`、`maxWorkingPixels=4_194_304`、`maxParts=32`、`maxPromptsPerPart=16`、`maxMotionFrames=120`、`maxRenderPixels=67_108_864`、`maxModelBytes=41_943_040`、`maxLlmResponseBytes=1_048_576`、`maxArchiveBytes=268_435_456`（仅 `maxArchiveBytes` 沿用 M1 desktop 上限，其余为 v3 新增限制）。限制对象不可在运行时改变。

```ts
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
```

进度值必须是有限 `[0,1]`，`overallProgress` 在 task 内单调不减；只有成功终态可发 `stage=complete, overallProgress=1, cancellable=false`。未知工作量阶段 `totalUnits=null`，不造定时器假进度。取消成功返回 `CANCELLED`，不得发 complete。每一个终态都带原 `taskId`。

## 2. 部位、蒙版与分割结果

一个 `PartAsset` 只保存几何和 mask，不复制整张源图 RGB；源颜色必须按其 `asset` 引用从同 revision 的 `InputAsset` 采样。mask 是 row-major、LSB-first 的一位图，`1` 表示保留对应源像素，`0` 表示透明；长度严格为 `ceil(width*height/8)`，末字节未用高位必须为 0。mask 的宽高必须等于 `sourceRect.width/height`，其左上对应源图 `sourceRect.x/y`。v3.0 的 `canvas` 固定等于 sourceRect 尺寸且 offset 为 `(0,0)`；保留此字段是为了显式声明不缩放/不移位的局部画布，不得默默 trim 或 padding。

Part ID 由管线生成并在一个 `SegmentationResult` 中唯一；不能直接信任 LLM 提供的 ID。`name` 是可显示本地化名或稳定的英文 label，`kind` 使用封闭枚举；无匹配类属用 `other`。部位框表示语义定位/点击目标，不代表 segmentation mask 的紧 bbox。无论模型如何推理，输出 mask 以源资产像素坐标表达，mask=1 处采样的 RGB 不重绘、不插值。

```ts
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

export declare const DEFAULT_SEGMENTATION_OPTIONS: Readonly<SegmentationOptions>;
```

`DEFAULT_SEGMENTATION_OPTIONS` 固定为 `maxParts=32`、`minimumPartConfidence=0.35`、`minimumMaskConfidence=0.50`、`modelInputMaxDimension=1024`、`preserveSmallParts=true`；有效范围分别是 1…32、0…1、0…1、256…1024 的整数及 boolean。传入的 maxParts 不得超过 context.limits.maxParts。

纯工具函数签名：

```ts
export declare function validatePartAsset(asset: InputAsset, part: PartAsset): CharacterOutcome<void>;
export declare function maskBounds(mask: BitMask): Rect | null;
export declare function applyMaskEdits(mask: BitMask, edits: MaskEdit[]): CharacterOutcome<BitMask>;
export declare function extractPartPixels(asset: InputAsset, part: PartAsset): CharacterOutcome<PixelBuffer>;
export declare function createPartAsset(
  source: InputAsset,
  kind: PartKind,
  name: string,
  result: SamMaskResult
): CharacterOutcome<PartAsset>;
export declare function removePartAsset(parts: PartAsset[], partId: PartId): CharacterOutcome<PartAsset[]>;
```

`validatePartAsset` 校验引用、矩形、canvas 和 bitset；`extractPartPixels` 产生 sourceRect 大小的 `PixelBuffer`，mask 为 0 的输出 RGBA 全零，mask 为 1 的输出像素 RGBA 逐字节等于 InputAsset 对应源像素；`maskBounds` 返回局部紧框或 null；`applyMaskEdits` 只写指定正/负像素，不改源图。空 mask 是合法结果但附 `EMPTY_MASK` warning，不能凭空生成颜色或扩大边界。

`createPartAsset` 校验 `result.asset === source.ref`，将 SAM 返回的源坐标 mask 包装成部件并由包生成稳定唯一 ID；正/负点精修由 `SamSession.segment` 运行模型后提交更新 mask。`removePartAsset` 返回新数组并拒绝未知 ID；前端撤销栈持有旧数组，函数不得原地修改输入。新增部位用一次 prompt 建立 mask，再调用 `createPartAsset`。v3.0-alpha 的改名属于 P1，显示名更新由前端以不可变 PartAsset 替换完成。

像素不变量按导出 PNG 解码后的 RGBA8 逐像素校验；tight crop 的源坐标为 `PartAsset.sourceRect + maskBounds(part.mask).origin + tightCropLocalPoint`。每个 `alpha>0` 的输出像素必须满足：R/G/B 与工作图同坐标逐字节相等；alpha 不大于工作图同坐标 alpha；对应 mask 位为 1。每个 mask 位为 0 的像素必须 `alpha=0`。`extractPartPixels` 对 mask=1 复制源 RGBA 全四字节、对 mask=0 写全零，因此其输出自动满足以上三条（mask=1 且源 alpha=0 时，alpha 仍为 0）；任何实现都不能生成更高 alpha、改 RGB 或从 mask 外写入可见像素。

### 部位 ZIP 导出（v3.0-alpha）

导出只接受当前同一 revision 的已确认部件，零部件返回 `NO_PARTS`。每个部件先求 mask 的非零紧框；空 mask 不进入可导出集合并作为错误返回，不能悄悄少导一张 PNG。tight crop 是 1:1、不缩放的 RGBA 子区域；`bbox` 为源工作图坐标，PNG 像素 `(0,0)` 对应 bbox 左上角。parts.json 必须与每个 PNG 一一对应，README.txt 必须存在。路径唯一（ASCII case-fold）、相对路径且无 `..`、绝对路径或设备保留名；文件名按调用方提供的稳定映射，经 M1 帧名规则校验，点击模式默认 `part_000` 起补零。导出前及 PNG 编码后解码都运行三条像素断言；任一失败即中止且不返回 ZIP。归档做与 M1 相同的条目清单、路径安全、大小和解包结构校验。

```ts
export interface PartExportName {
  partId: PartId;
  fileName: string;
}

export interface PartExportTask {
  names: PartExportName[];
}

export interface PartsManifestEntry {
  id: PartId;
  name: string;
  kind: PartKind;
  file: string;
  bbox: Rect;
}

export interface PartsManifest {
  schemaVersion: "spriteflow-parts/1";
  coordinateSystem: "top-left-half-open-working-pixels";
  asset: AssetRef;
  sourceSize: Size;
  parts: PartsManifestEntry[];
}

export interface PartExportFile {
  path: string;
  mime: "image/png" | "application/json" | "text/plain";
  bytes: ArrayBuffer;
}

export interface PartExportFileEntry {
  path: string;
  mime: PartExportFile["mime"];
  byteLength: number;
}

export interface PartExportResult {
  fileName: string;
  mime: "application/zip";
  archive: ArrayBuffer;
  files: PartExportFileEntry[];
  manifest: PartsManifest;
}

export interface PartExportCodec {
  encodePng(pixels: PixelBuffer, context: CharacterExecutionContext): Promise<ArrayBuffer>;
  decodePng(bytes: ArrayBuffer, context: CharacterExecutionContext): Promise<PixelBuffer>;
  encodeZip(files: PartExportFile[], context: CharacterExecutionContext): Promise<ArrayBuffer>;
  inspectZip(archive: ArrayBuffer, context: CharacterExecutionContext): Promise<PartExportFileEntry[]>;
}

export interface PartPixelInvariantReport {
  partId: PartId;
  checkedPixels: number;
  visiblePixels: number;
  passed: true;
}

export declare function assertPartPixelInvariant(
  source: InputAsset,
  part: PartAsset,
  tightPixels: PixelBuffer
): CharacterOutcome<PartPixelInvariantReport>;

export declare function exportPartAssets(
  source: InputAsset,
  parts: PartAsset[],
  task: PartExportTask,
  codec: PartExportCodec,
  context: CharacterExecutionContext
): Promise<CharacterOutcome<PartExportResult>>;
```

`PartExportTask.names` 必须和当前部件 ID 集一一对应，`fileName` 是不含扩展名的文件名 stem，沿用 M1 合法字符/设备名/大小写冲突规则；点击模式默认 `part_000` 起补零。`PartsManifestEntry.file` 形如 `parts/<fileName>.png`；`parts.json` 是 UTF-8、无 BOM、2 空格缩进、末尾 LF 的上述 JSON；README.txt 使用 UTF-8/LF，列出生成版本、目录说明、源 bbox 坐标规则与像素不变量。归档固定且只有 `parts/*.png`、`parts.json`、`README.txt`；PNG 数必须等于输入部件数，所有 PNG 在 manifest 出现且无额外条目。ZIP 条目按路径排序、mtime 固定为 1980-01-01、禁止权限/绝对路径；PNG store、JSON/文本 deflate 6。`exportPartAssets` 必须用 `inspectZip` 解包目录，再对实际路径、重复项、条目数、MIME/长度和 manifest 一一映射执行 M1 式结构校验；`files` 记录通过校验的归档条目元信息，`archive` 持有唯一 ZIP bytes。编码、解码及归档均注入 codec，不新增 M1 契约格式或第三方依赖。`assertPartPixelInvariant` 比较导出 tight crop 与源工作图，按 mask 外 alpha、源 alpha 上界和 RGB 字节逐项检查；`exportPartAssets` 必须在打包前后通过该校验，解码后的尺寸和像素不符时归类 `PART_PIXEL_INVARIANT_FAILED` 并丢弃归档。

## 3. L1 语义定位与 BYOK API

v3.0 只支持 JSON 兼容的多模态 Chat Completions 端点。使用者负责给出 endpoint、model 与 key；契约定义传输形状而不内置供应商 key、代理、重试队列或 SDK。请求前 UI 必须显示图像将直接发给用户所选 endpoint 并逐次取得同意。未同意时不发请求。endpoint 必须 HTTPS，开发 localhost 例外；URL 不可包含 userinfo 或 fragment。请求不跟随 redirect、不带浏览器 cookies，响应大小受 CharacterLimits 限制。

BYOK key 默认只传入执行 Worker 中的请求，不进入结果 DTO、进度、warning、日志或错误 details。若应用实现“本 tab 记住”，只允许用户明确选择后用 `sessionStorage`，关闭 tab/退出工作区即清；契约 API 本身不持久化 key。用户更换或清除 key 立即清掉 Worker 中旧引用。请求超时/取消之后不继续读取响应体。

```ts
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
      content: string | Array<
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

export declare function locatePartsWithLlm(
  request: LlmLocateRequest,
  transport: LlmTransport,
  context: CharacterExecutionContext
): Promise<CharacterOutcome<LlmLocateResult>>;
```

响应必须是单个符合 `LlmLocateDocument` 的 JSON 对象；parser 可剥离首尾一组 Markdown code fence，但不能从任意自然语言中猜字段。`schemaVersion`、coordinateSpace、封闭 `PartKind`、confidence [0,1]、框坐标/范围、部位数、重复部位组合任一校验失败，都算一次可修复的 JSON/schema 错误。第一次输出无法 parse/validate 时，最多发一次修复请求：保留 model/温度/token 上限，只包含 schema、原始文本截断片段和字段错误摘要；不得再次发送图像。第二次仍非法返回 `LLM_INVALID_RESPONSE`。401/403、429、5xx、网络/CORS、timeout、cancel、响应超限不触发 JSON 修复；不自动重试收费请求。错误不得带 authorization、key、图像 dataUrl 或未经截断的 provider body。

`timeoutMs` 有效范围 1,000…8,000，`maxResponseBytes` 为 1…1,048,576 且不超过 context 限制，`maxOutputTokens` 为 128…4,096；endpoint 总长≤2,048 个字符、model 非空且≤128、apiKey 非空且≤4,096。请求 endpoint 是完整 `/chat/completions` URL。`userConsent` 只有字面量 true 合法；`SemanticSegmentationRequest.llmConsent=false` 时 `segmentSemantically` 不得调用 LlmTransport，直接进入 click mode，并返回 `LLM_UNAVAILABLE` degradation。未经同意缺失/配置不合法不会发送网络请求。

人形置信低于 `minimumPartConfidence`、显式判断 `non-humanoid` 或 LLM 任一最终失败时，不生成伪语义部件；返回 `mode="click"` 和相应 degradation，让用户以 SAM 点击建立匿名/手工命名部件。局部合法部位在整份 LLM 结果验证前不能部分覆盖旧结果。

## 4. L2 SAM 模型 manifest、会话与提示

SAM 模型在 browser adapter 中由 ONNX Runtime Web 执行。公开 manifest 只允许应用审计过的模型 ID；模型 URL 不能由调用者传任意 host。Worker 先按完整 manifest 获取并检查字节数、SHA-256，再尝试 Cache API；缓存不存在/不可用时网络拉取仍可继续，但模型 hash 未通过一律丢弃并报错。manifest 的权重许可 ID 必须引用架构文档审核的许可清单，未知 license 不可初始化。

图片嵌入每个 asset revision 只计算一次，box/point prompt 以原图工作坐标输入；backend 将图像确定性缩放到 manifest 的输入尺寸，推理结束把 mask 映回 sourceRect。多次点击修改只重新执行 prompt decoder，不重新传整张源图给模型。一个 session 同时最多一个推理任务；另一个调用返回 `BUSY`。`dispose()` 幂等，dispose 后任何操作返回 `INVALID_STATE`。

```ts
export interface SamModelManifest {
  modelId: ModelId;
  revision: string;
  artifactUrl: string;
  sha256: string;
  byteLength: number;
  inputSize: Size;
  maxSourceDimension: number;
  imageInputName: string;
  promptInputNames: {
    box: string;
    points: string;
    pointLabels: string;
  };
  outputNames: {
    masks: string;
    scores: string;
  };
  licenseId: string;
}

export type SamExecutionProvider = "webgpu" | "wasm";

export interface SamRuntimeOptions {
  provider: "auto" | SamExecutionProvider;
  wasmThreads: 1;
  useModelCache: boolean;
}

export declare const DEFAULT_SAM_RUNTIME_OPTIONS: Readonly<SamRuntimeOptions>;

export interface SamPoint {
  point: Point;
  label: "positive" | "negative";
}

export type SamPrompt =
  | { type: "box"; box: Rect; points: SamPoint[] }
  | { type: "points"; points: SamPoint[]; box: Rect | null };

export interface SamMaskResult {
  asset: AssetRef;
  mask: BitMask;
  sourceRect: Rect;
  predictedIou: number;
  provider: SamExecutionProvider;
}

export interface SamSessionInfo {
  sessionId: SessionId;
  modelId: ModelId;
  revision: string;
  provider: SamExecutionProvider;
  cachedModel: boolean;
  asset: AssetRef | null;
  state: "ready" | "image-ready" | "disposed";
  warnings: CharacterWarning[];
}

export interface SamInferenceBackend {
  create(manifest: SamModelManifest, provider: SamExecutionProvider): Promise<void>;
  embed(asset: InputAsset, manifest: SamModelManifest, context: CharacterExecutionContext): Promise<void>;
  infer(prompt: SamPrompt, context: CharacterExecutionContext): Promise<{
    mask: BitMask;
    sourceRect: Rect;
    predictedIou: number;
  }>;
  dispose(): Promise<void>;
}

export interface SamSession {
  initialize(context: CharacterExecutionContext): Promise<CharacterOutcome<SamSessionInfo>>;
  setImage(asset: InputAsset, context: CharacterExecutionContext): Promise<CharacterOutcome<SamSessionInfo>>;
  segment(prompt: SamPrompt, context: CharacterExecutionContext): Promise<CharacterOutcome<SamMaskResult>>;
  dispose(): Promise<void>;
}

export declare function createSamSession(
  manifest: SamModelManifest,
  options: SamRuntimeOptions,
  backend: SamInferenceBackend
): SamSession;

export declare function mergePromptMask(
  current: BitMask,
  patch: BitMask,
  prompt: SamPrompt
): CharacterOutcome<BitMask>;
```

`DEFAULT_SAM_RUNTIME_OPTIONS` 为 `{provider:"auto", wasmThreads:1, useModelCache:true}`；v3.0-alpha 不允许改变 WASM thread 数。模型 initialize 下载/校验/ORT 初始化失败返回可重试错误，保留当前 `InputAsset` 与已确认部件；再次调用 `initialize()` 重试模型阶段，不要求也不得要求 UI 重新上传/transfer 同一图像。直到 initialize 成功后才重新执行 embedding。若 WebGPU 和 WASM 都不可用，自动拆件与点击模式均不可用；保留页面状态并提供 retry，不能显示“手动画蒙版”作为现有能力。

Box 必须是非空整数 Rect 且完全在源图内；point 坐标为整数 pixel index `[0,width-1] × [0,height-1]`，至少有一个 positive，negative 最多 16 个，重复完全相同的点先去重。mask 位序固定为本节前述 bitset；`sourceRect` 是 mask 在整张输入工作图中的原点和尺寸，必须与 mask 宽高一致。低 `predictedIou` 是 warning，不删除结果。WebGPU 初始化/首个推理失败后释放全部 ORT session/tensor，再以 WASM 建立新 session，同一 prompt 最多 replay 一次，并发/取消请求不得 replay；成功降级时返回 `WEBGPU_FALLBACK_TO_WASM` warning。

`@spriteflow/segment/browser` 导出以下声明以及模型清单只读访问器；ORT 类型仅存在该 browser 子入口内部，不能出现在根入口声明签名。ORT 不能创建两个后端时返回 `MODEL_INITIALIZATION_FAILED`；WebGPU 和 WASM 均不可用时，UI 明确标注自动拆件与点击模式不可用，提供重试并保留源图/已有部件。Cache API quota/CORS 不影响模型内存会话，模型 hash 错误、license 不批准和不在 allowlist 的域都不能降级跳过验证。

```ts
export declare function createOnnxSamBackend(): SamInferenceBackend;
export declare function createFetchLlmTransport(): LlmTransport;
export declare function getApprovedSamManifest(modelId: ModelId): SamModelManifest | null;
```

## 5. 分割编排、点击回退与像素来源

```ts
export interface SemanticSegmentationRequest {
  asset: InputAsset;
  image: LlmImage;
  llm: LlmProviderConfig | null;
  llmConsent: boolean;
  model: SamModelManifest;
  options: SegmentationOptions;
  runtime: SamRuntimeOptions;
}

export interface ClickSegmentationRequest {
  asset: InputAsset;
  model: SamModelManifest;
  runtime: SamRuntimeOptions;
  initialPrompts: Array<{ kind: PartKind; name: string; prompt: SamPrompt }>;
}

export declare function segmentSemantically(
  request: SemanticSegmentationRequest,
  llmTransport: LlmTransport,
  samBackend: SamInferenceBackend,
  context: CharacterExecutionContext
): Promise<CharacterOutcome<SegmentationResult>>;

export declare function segmentByPrompts(
  request: ClickSegmentationRequest,
  samBackend: SamInferenceBackend,
  context: CharacterExecutionContext
): Promise<CharacterOutcome<SegmentationResult>>;

export interface MaskEditPoint {
  // Integer pixel indices local to the BitMask.
  point: Point;
  label: "positive" | "negative";
}

export interface MaskEdit {
  points: MaskEditPoint[];
}

export declare function applyMaskEdits(
  mask: BitMask,
  edits: MaskEdit[]
): CharacterOutcome<BitMask>;

export declare function extractPartPixels(
  asset: InputAsset,
  part: PartAsset
): CharacterOutcome<PixelBuffer>;
```

`segmentSemantically` validates the complete LLM document before SAM work. LLM failure/non-human results return a successful, editable click-mode `SegmentationResult` with zero semantic parts and a warning/degradation; they are not transport errors unless even the local session cannot initialize. The click path creates parts from caller prompts and generates stable IDs inside the package. A user can add, subtract, rename or delete masks; any changed result uses immutable new arrays/objects. If `part.asset` differs from `asset.ref`, extraction fails `ASSET_MISMATCH`.

Pixel invariant: for every pixel where mask=1 and source alpha>0, `extractPartPixels` RGB and alpha bytes exactly equal the source bytes at the corresponding `sourceRect` coordinate. Where mask=0, output RGBA is `(0,0,0,0)`. There is no blur, color filling, alpha feathering, interpolation, palette conversion or model-generated pixel in v3.0 segmentation. The returned buffer dimensions are sourceRect dimensions; callers must not resize it before pixel-identity validation.

## 6. L3 completion placeholder (v3.1)

```ts
export type CompletionMode = "full-part" | "local-composite";

export interface CompletionRequest {
  source: InputAsset;
  part: PartAsset;
  contextMask: BitMask;
  mode: CompletionMode;
  prompt: string | null;
}

export interface CompletionVariant {
  id: string;
  mode: CompletionMode;
  pixels: PixelBuffer;
  source: "local-model" | "byok-provider";
  provenance: "generated";
}

export interface CompletionResult {
  asset: AssetRef;
  partId: PartId;
  variants: [CompletionVariant, CompletionVariant];
}

export declare function completeOcclusion(
  request: CompletionRequest,
  context: CharacterExecutionContext
): Promise<CharacterOutcome<CompletionResult>>;
```

v3.0 的 `completeOcclusion` 必须返回 `NOT_IMPLEMENTED`，不接受“空成功”或伪造 pixels。v3.1 另行确定 LaMa/BYOK 模型、供应商请求与补全像素许可证、可选依赖、分辨率/提示输入和独立契约版本；上列类型是占位 API，不代表实现授权。

## 7. RigSpec 与骨骼模板（v3.5 占位）

> 本节及第 8–9 节只记录 v3.5 候选接口，PRD v3.0-alpha 明确排除绑骨、动作和逐帧渲染。当前不得在 `@spriteflow/rig` 发布入口实现或导出这些声明；需由 v3.5 PRD 与独立契约修订重新确认。

`RigSpec` 是可 JSON 序列化的局部骨架。骨骼树必须只有一个 root、无环、父节点先于子节点，所有坐标均为相对 parent 的源像素单位。rotation 单位是弧度、顺时针为正。附着点 pivot 使用 PartAsset 的 sourceRect 局部坐标；同一个 part 恰有一个 attachment。缺失 body kind 不会伪造 part，默认映射可把相邻现存部件挂到最近有效父骨骼。未知 kind 保持 unattached 并给可见错误，不静默忽略。

```ts
export type HumanoidTemplateId = "humanoid-biped-v1";
export type BoneProperty = "rotation" | "translationX" | "translationY";

export interface Transform2D {
  x: number;
  y: number;
  rotation: number;
}

export interface BoneSpec {
  id: BoneId;
  name: string;
  parentId: BoneId | null;
  bind: Transform2D;
}

export interface PartAttachment {
  partId: PartId;
  boneId: BoneId;
  pivot: Point;
  zIndex: number;
}

export interface RigSpec {
  schemaVersion: "spriteflow-rig/1";
  id: string;
  template: HumanoidTemplateId | "custom";
  asset: AssetRef;
  canvas: Size;
  bones: BoneSpec[];
  attachments: PartAttachment[];
}

export interface RigMappingOptions {
  template: HumanoidTemplateId;
  canvas: Size;
  root: Point;
  allowUnattached: boolean;
}

export interface RigMappingResult {
  rig: RigSpec;
  unattachedPartIds: PartId[];
  warnings: CharacterWarning[];
}

export declare function createHumanoidRig(
  asset: AssetRef,
  parts: PartAsset[],
  options: RigMappingOptions
): CharacterOutcome<RigMappingResult>;

export declare function validateRig(
  rig: RigSpec,
  parts: PartAsset[]
): CharacterOutcome<void>;
```

`humanoid-biped-v1` 固定骨骼 ID 为 `root`, `pelvis`, `torso`, `head`, `upper-arm-left`, `forearm-left`, `hand-left`, `upper-arm-right`, `forearm-right`, `hand-right`, `thigh-left`, `shin-left`, `foot-left`, `thigh-right`, `shin-right`, `foot-right`。骨骼 bind transform 与挂接模板是 API 数据，变更 ID/父子关系属于 major；模板不能通过运行时随机从部位数组顺序推断。自动 mapping 只接受 `HumanoidAssessment.isHumanoid=true`；非人形返回 `RIG_TEMPLATE_UNSUPPORTED`，保留点击分割结果，让用户拖拽挂接或导出分割部件，不强套两足骨架。默认 `PartKind → BoneId` 映射固定为：hair/head/face/eye-left/eye-right/eyebrow-left/eyebrow-right/mouth→head；neck/torso→torso；upper-arm-left/forearm-left/hand-left→对应 left 骨；upper-arm-right/forearm-right/hand-right→对应 right 骨；thigh/shin/foot 同样按左右侧对应。accessory/other 不自动附着，除非 caller 提供完整自定义 `attachments`。每个部件 pivot 默认是 maskBounds 紧框中心映射到 PartAsset sourceRect 局部坐标；无 mask pixel 时不能建立自动 attachment。

固定父子关系为 root(null) → pelvis → torso；torso 的子项为 head、upper-arm-left、upper-arm-right；左右 upper-arm 分别连接同侧 forearm，再连接 hand；pelvis 连接 thigh-left/right，再分别连接同侧 shin 和 foot。为避免“模板不能依数组顺序推断”仍有歧义，骨骼数组必须以该拓扑顺序输出。root 的 bind 原点取 `RigMappingOptions.root`；其余骨骼的源图绝对原点取挂接到该骨的部件 maskBounds 并集中心，多个映射部件先合并紧框再求中心；没有直接挂接部件时沿父链继承最近祖先原点。`bind.x/y` 是该原点减父骨骼原点，`bind.rotation=0`。所有自动 attachment 的 pivot 为该部件 maskBounds 紧框中心减 `sourceRect.x/y`；`sourceRect`/maskBounds 越界或空 mask 不参与自动映射。验证器拒绝重复 ID、缺失 parent、循环、非拓扑数组顺序、非有限变换和超出画布的 attachment pivot。

template 默认绘制层级以稳定 kind 序列赋 `zIndex`：hair 10，feet 20，shins 30，thighs 40，torso/neck 50，upper arms 60，forearms 70，hands 80，head 90，face 100，eyes/eyebrows 110，mouth 120；同 rank 按 PartId 字典序。每个 PartAttachment 的 zIndex 是安全整数；用户可在审校阶段改值并重新 validate。

## 8. MotionPreset 与确定性曲线（v3.5 占位）

曲线时间是 `[0,1]` 归一化周期，值为相对 bind transform 的增量。keyframe 严格递增且首尾覆盖 0 和 1。插值采用 cubic Hermite，`inTangent` / `outTangent` 是对归一化时间的导数。`parameterId=null` 表示固定曲线；否则输出值为 `(curveValue * parameter.value) + offset`。参数缺省用默认值，未知参数、越界参数和重复 channel 返回 `INVALID_MOTION`。

```ts
export interface MotionParameter {
  id: string;
  label: string;
  minimum: number;
  maximum: number;
  defaultValue: number;
}

export interface CurveKeyframe {
  t: number;
  value: number;
  inTangent: number;
  outTangent: number;
}

export interface PoseChannel {
  boneId: BoneId;
  property: BoneProperty;
  parameterId: string | null;
  offset: number;
  keyframes: CurveKeyframe[];
}

export interface MotionPreset {
  schemaVersion: "spriteflow-motion/1";
  id: MotionId;
  name: string;
  durationMs: number;
  loop: boolean;
  parameters: MotionParameter[];
  channels: PoseChannel[];
}

export type MotionParameterValues = Record<string, number>;

export interface BonePose {
  boneId: BoneId;
  local: Transform2D;
}

export declare function sampleMotion(
  rig: RigSpec,
  preset: MotionPreset,
  parameters: MotionParameterValues,
  timeMs: number
): CharacterOutcome<BonePose[]>;
```

Loop 曲线取 `timeMs % durationMs`；non-loop 曲线 clamp 到 `[0,durationMs]`。逐帧采样时 frame i 的时间精确为 `i * 1000 / fps`，不额外输出 duration 端点帧，以免循环首帧重复。Rig 的 parent 矩阵按骨骼数组拓扑顺序计算；先验证所有曲线与骨骼引用，再渲染任何像素。

## 9. 逐帧像素渲染及 M1 适配（v3.5 占位）

刚体变换使用最近邻采样，不做双线性或颜色滤波。三角函数矩阵先量化为 16.16 定点数；逆变换落到像素坐标时 `floor(value + 0.5)`，源图外透明。透明输出 RGBA 归零；非透明输出 RGB 必须来自对应 part.sourceRect 的原像素。多个部件重叠按 `zIndex` 升序、partId 字典序稳定打破平局，采用 painter overwrite：后绘制的非透明部件复制其源 RGBA，完全替换底层像素，不做 source-over RGB 混色。由此保留 RGB 只能取自某一个源像素；任何 bilinear、alpha feather、颜色混合均违反像素不变量。像素预算超过 `maxRenderPixels` 或 frame 数超过限制时在分配前失败。

sheet 布局是确定性 row-major 网格，不旋转格子、不压缩、不加出血。每格尺寸等于 RigSpec.canvas，每格 `padding=0`；列数和最大页面边由任务给出，整体 sheet 尺寸必须在 limits 内。帧 i 使用 ID `rig_<presetId>_<zeroPaddedIndex>`，名称 `frame_000` 起，draft 状态 pending，供用户审阅后交给 M1 normalize/pack/export。输出的 `InputAsset` 使用调用者给的唯一 `AssetRef` 和 `application/x-rgba8`，revision 由调用者管理。

```ts
export interface RigRenderTask {
  output: {
    ref: AssetRef;
    name: string;
  };
  preset: MotionPreset;
  parameters: MotionParameterValues;
  fps: number;
  durationMs: number;
  columns: number;
  maxSheetDimension: number;
  maxFrames: number;
}

export interface RigRenderResult {
  asset: InputAsset;
  drafts: FrameDraft[];
  animations: AnimationSpec[];
  frameSize: Size;
  columns: number;
  rows: number;
  warnings: CharacterWarning[];
}

export declare function renderMotionSheet(
  source: InputAsset,
  parts: PartAsset[],
  rig: RigSpec,
  task: RigRenderTask,
  context: CharacterExecutionContext
): Promise<CharacterOutcome<RigRenderResult>>;
```

`@spriteflow/segment/browser` 精确导出清单为 `createOnnxSamBackend`、`createFetchLlmTransport`、`getApprovedSamManifest`；v3.0-alpha 的 `@spriteflow/segment` 根入口只导出部位、BYOK、SAM 与部位导出 API（第 1–5 节及第 10 节相关错误/进度类型）。第 7–9 节是 v3.5 占位，不是当前 package exports。`DEFAULT_CHARACTER_LIMITS`、`DEFAULT_SEGMENTATION_OPTIONS`、`DEFAULT_SAM_RUNTIME_OPTIONS` 是只读常量。浏览器子入口允许依赖 DOM、fetch、Cache API 与 ORT，但签名遵守上述 browser adapter 接口；本契约中的 v3.0-alpha 声明名与签名即完整公共表面，不可由实现包省略。

`source.ref`、所有 parts.asset、rig.asset 必须逐字段相等。`durationMs` 是正整数，fps 为 1…60，frame 数为 `ceil(durationMs*fps/1000)` 并受 limits 与 task.maxFrames 双重限制；columns 为 1…frameCount。sheet 页面像素透明初始化，格子以整数倍 frameSize 放置。每个 draft `origin="manual"`, `sourceFrameIds=[]`, `edited=false`, `included=true`, `reviewStatus="pending"`。`animations` 恰含一条与 drafts 顺序一致、frameIds 对应所有 draft id 的动画；其 name 是 preset.id 的合法化稳定名，fps 和 loop 取任务 fps / preset.loop。上层通过 M1 `load` (rgba) → review → `normalize` → `pack` → `export` 复用 M1 格式，不由 rig 新增导出 JSON/ZIP 变体。

像素契约的强断言范围：`extractPartPixels` 的可见源像素逐字节相等；Rig 渲染允许 nearest-neighbor 对位置做重复/舍弃采样，但不得生成新 RGB 值。蒙版应用只决定选中源 RGBA 或透明像素；层间遮挡按稳定 z-order 覆盖。测试对固定 JS、ORT-free Node 纯逻辑路径和规定 Chromium 版本记录完整帧 RGBA 哈希与逐通道 diff，不以视觉截图代替字节断言。

## 10. 错误模型与 UI 降级

```ts
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
```

| 错误/结果 | UI 呈现与恢复 |
|---|---|
| LLM 未同意或未配置 | 未配置时明确提供“配置语义定位”与“直接使用点击模式”两条路；未同意时不发请求。点击路径不发携带图片的 LLM 网络请求，保留当前 parts/草稿 |
| LLM 401 | 显示 key 无效与配置入口；不自动重试、不上传到其他端点，保留 parts/草稿；用户可主动选择 click-mode |
| LLM JSON 一次修复后仍非法 | 显示 `LLM_INVALID_RESPONSE` 与 `attempts=2`；清除本次临时 proposals，保留之前确认的 parts；可继续 SAM click-mode |
| LLM 429、CORS/网络、超时 | 不自动复试收费请求；显示 provider/messageKey，不显示响应体/key；本地 click-mode 可继续 |
| `humanoid=false` 或置信不足 | 黄色非人形提示；不创建人形 RigSpec，保留 SAM 点选拆件 |
| WebGPU 初始化/推理失败、WASM 成功 | 返回成功但带 `WEBGPU_FALLBACK_TO_WASM` warning，告知处理较慢 |
| 模型下载、hash、license 或双 provider 初始化失败 | 模型错误面板；保留已有 masks；只提供 retry（可重试错误）；自动拆件与点击模式均标记不可用；hash/license 失败禁止自动跳过 |
| 空 mask / 低 mask confidence | 部件保持可编辑并给警告；用户可加点、删点或矩形兜底，不静默删部件 |
| SAM 完全不可用 | 自动拆件与点击模式均不可用；保留页面与资产状态，允许重试；不能伪称手工蒙版或点式 SAM 已工作 |
| rig unsupported / invalid | 保留 Parts；引导拖拽挂接或回到拆件导出，不丢弃部件 |
| 内存/尺寸/帧数超限 | 展示 actual/limit，等待用户缩小图/帧数；不得自动降采样或静默少渲帧 |
| `NOT_IMPLEMENTED` | v3.0 completion 面板标示“遮挡补全将在 v3.1 提供”；不出现成功版本或空图下载 |
| CANCELLED / BUSY | 取消为普通状态；BUSY 等当前任务终态后重试，不能并行启动另一模型/渲染任务 |

所有 `messageKey` 形如 `character.error.<CODE>` 或 `character.warning.<CODE>`；`details` 不得含 key、图像、base64、完整 LLM response、prompt 原文、任意 URL query 或堆栈。返回可定位错误时，`partIds` 只放当前用户资产内 ID。

## 11. 自足性和验收约定

v3.0-alpha 的 segment 工程师仅凭本契约及 M1 type-only imports，可创建 `InputAsset`、用 mock LLM/SAM 得到 `PartAsset[]`、运行三断言并生成部位 ZIP。RigSpec/MotionPreset 和逐帧渲染是 v3.5 占位，不得进入 alpha API 或验收。项目必须将 v3.0-alpha 声明示例编译成 TypeScript fixture；实现实际导出字段不得比本文件少，也不得自行追加公共 enum 成员。

v3.0-alpha 的主要回归必须包含：无 DOM 根入口 Node import；LLM 初始成功/一次 JSON repair 成功/repair 第二次失败/401、429、CORS、timeout/无 consent；非人形与 LLM 失败点击降级；模型 hash 错、Cache unavailable、WebGPU→WASM、双 provider 失败和无重传恢复；box+point、正负点、mask bit order/空 mask；tight crop 像素三断言、PNG 编解码回环、`parts/*.png`/`parts.json`/`README.txt` ZIP 结构与路径检查；至少 10 例人形和另 1 例不占配额的非人形锚点；取消和内存/帧/归档上限；L3 返回 `NOT_IMPLEMENTED`。Rig tree/template/curve、nearest-neighbor 变换与整段渲染 hash 测试属于 v3.5，不纳入 alpha。

这里的 v3 版本号是候选契约自己的版本，尚待产品主按项目流程确认。更新字段、模型格式、provider 语义、像素结果或 worker 消息前，必须修订本文件及 `architecture-v3.md`，按语义变更提高版本并获产品主确认；不得修改 M1 `interface-contract.md` 的 3.0.0/r4 冻结内容。
