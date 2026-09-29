# SpriteFlow v3 segment / rig 公共接口契约（候选）

> 版本：0.1.0-r1；日期：2026-09-29；状态：架构候选，待 v3 产品流程确认。
>
> 本文件定义 `@spriteflow/segment`、`@spriteflow/segment/browser` 与 `@spriteflow/rig` 的公共 API；代码标识符为英文，本文说明为中文。文中代码块是完整的接口声明/调用形状，不是功能实现。
>
> **与 M1 的关系：**本契约依赖但不修改 M1 [interface-contract.md](./interface-contract.md) 的 3.0.0/r4。项目必须使用该版本根入口已导出的 `AssetRef`、`InputAsset`、`PixelBuffer`、`Rect`、`Point`、`Size`、`FrameDraft`、`AnimationSpec`、`Outcome` 等类型。M1 契约的像素、坐标、资源上限和 `FrameDraft` 语义继续适用；出现冲突时，先按流程修订 v3 契约，不能暗改 M1 文件或运行时类型。
>
> **版本边界：**v3 契约版本独立演进，不提升 M1 的 `CONTRACT_VERSION` / `PROTOCOL_VERSION`。v3.0 定义部位分割、BYOK 定位、SAM 会话和骨架逐帧渲染；L3 遮挡补全仅有类型和显式未实现返回。

## 1. 公共规则与包入口

本契约使用 M1 `Rect` 的左上原点、整数半开区间、工作图像像素坐标。所有矩形必须在 `InputAsset.pixels` 的 `[0,width) × [0,height)` 范围内。源 `AssetRef` 在整个角色工作区内固定指向同一像素；改变像素、缩放或替换图像必须使用新 revision。未知字段、非法坐标、非有限数及超过资源上限的请求返回 `CharacterError`，不抛未约定异常。

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

export const V3_CONTRACT_VERSION: "0.1.0";
export const V3_PROTOCOL_VERSION: 1;

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
  maxMotionFrames: number;
  maxRenderPixels: number;
  maxModelBytes: number;
  maxLlmResponseBytes: number;
}

export declare const DEFAULT_CHARACTER_LIMITS: Readonly<CharacterLimits>;

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

纯工具函数：`validatePartAsset(asset, part)` 校验引用、矩形、canvas 和 bitset；`extractPartPixels(asset, part)` 产生 sourceRect 大小的 `PixelBuffer`，mask 为 0 的输出 RGBA 全零，mask 为 1 的输出像素 RGBA 逐字节等于 InputAsset 对应源像素；`maskBounds(mask)` 返回局部紧框或 null；`applyMaskEdits(mask, edits)` 只写指定正/负像素，不改源图。空 mask 是合法结果但附 `EMPTY_MASK` warning，不能凭空生成颜色或扩大边界。

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

Box 必须是非空整数 Rect 且完全在源图内；point 坐标为整数 pixel index `[0,width-1] × [0,height-1]`，至少有一个 positive，negative 最多 16 个，重复完全相同的点先去重。mask 位序固定为本节前述 bitset；`sourceRect` 是 mask 在整张输入工作图中的原点和尺寸，必须与 mask 宽高一致。低 `predictedIou` 是 warning，不删除结果。WebGPU 初始化/首个推理失败后释放全部 ORT session/tensor，再以 WASM 建立新 session，同一 prompt 最多 replay 一次，并发/取消请求不得 replay；成功降级时返回 `WEBGPU_FALLBACK_TO_WASM` warning。

`@spriteflow/segment/browser` 导出 `createOnnxSamBackend()`、`createFetchLlmTransport()` 和模型清单只读访问器；ORT 类型仅存在该 browser 子入口内部，不能出现在根入口声明签名。ORT 不能创建两个后端时返回 `MODEL_INITIALIZATION_FAILED`；WebGPU 和 WASM 均不可用时，UI 提示继续手工矩形/稍后重试。Cache API quota/CORS 不影响模型内存会话，模型 hash 错误、license 不批准和不在 allowlist 的域都不能降级跳过验证。

## 5. 分割编排、点击回退与像素来源

```ts
export interface SemanticSegmentationRequest {
  asset: InputAsset;
  image: LlmImage;
  llm: LlmProviderConfig | null;
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

export interface MaskEdit {
  points: SamPoint[];
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

## 7. RigSpec 与骨骼模板

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

`humanoid-biped-v1` 固定骨骼 ID 为 `root`, `pelvis`, `torso`, `head`, `upper-arm-left`, `forearm-left`, `hand-left`, `upper-arm-right`, `forearm-right`, `hand-right`, `thigh-left`, `shin-left`, `foot-left`, `thigh-right`, `shin-right`, `foot-right`。骨骼 bind transform 与挂接模板是 API 数据，变更 ID/父子关系属于 major；模板不能通过运行时随机从部位数组顺序推断。自动 mapping 只接受 `HumanoidAssessment.isHumanoid=true`；非人形返回 `RIG_TEMPLATE_UNSUPPORTED`，保留点击分割结果，让用户拖拽挂接或导出分割部件，不强套两足骨架。

## 8. MotionPreset 与确定性曲线

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

## 9. 逐帧像素渲染及 M1 适配

刚体变换使用最近邻采样，不做双线性或颜色滤波。三角函数矩阵先量化为 16.16 定点数；逆变换落到像素坐标时 `floor(value + 0.5)`，源图外透明。透明输出 RGBA 归零；非透明输出 RGB 必须来自对应 part.sourceRect 的原像素。多个部件重叠按 `zIndex` 升序、partId 字典序稳定打破平局，source-over 只组合 alpha 与原色，不产生新 RGB 颜色值。像素预算超过 `maxRenderPixels` 或 frame 数超过限制时在分配前失败。

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

`source.ref`、所有 parts.asset、rig.asset 必须逐字段相等。`durationMs` 是正整数，fps 为 1…60，frame 数为 `ceil(durationMs*fps/1000)` 并受 limits 与 task.maxFrames 双重限制；columns 为 1…frameCount。sheet 页面像素透明初始化，格子以整数倍 frameSize 放置。每个 draft `origin="manual"`, `sourceFrameIds=[]`, `edited=false`, `included=true`, `reviewStatus="pending"`。`animations` 恰含一条与 drafts 顺序一致、frameIds 对应所有 draft id 的动画；其 name 是 preset.id 的合法化稳定名，fps 和 loop 取任务 fps / preset.loop。上层通过 M1 `load` (rgba) → review → `normalize` → `pack` → `export` 复用 M1 格式，不由 rig 新增导出 JSON/ZIP 变体。

像素契约的强断言范围：`extractPartPixels` 的可见源像素逐字节相等；Rig 渲染允许 nearest-neighbor 对位置做重复/舍弃采样，但不得生成新 RGB 值。蒙版应用只改变 alpha；层间遮挡使用稳定 z-order。测试对固定 JS、ORT-free Node 纯逻辑路径和规定 Chromium 版本记录完整帧 RGBA 哈希与逐通道 diff，不以视觉截图代替字节断言。

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
| LLM 未同意、未配置或 401 | 不上传图片；提示配置或同意。保留当前 parts/草稿，转本地 click-mode |
| LLM JSON 一次修复后仍非法 | 显示 `LLM_INVALID_RESPONSE` 与 `attempts=2`；清除本次临时 proposals，保留之前确认的 parts；可继续 SAM click-mode |
| LLM 429、CORS/网络、超时 | 不自动复试收费请求；显示 provider/messageKey，不显示响应体/key；本地 click-mode 可继续 |
| `humanoid=false` 或置信不足 | 黄色非人形提示；不创建人形 RigSpec，保留 SAM 点选拆件 |
| WebGPU 初始化/推理失败、WASM 成功 | 返回成功但带 `WEBGPU_FALLBACK_TO_WASM` warning，告知处理较慢 |
| 模型下载、hash、license 或双 provider 初始化失败 | 模型错误面板；保留已有 masks；retry /手动画部件；hash/license 失败禁止自动跳过 |
| 空 mask / 低 mask confidence | 部件保持可编辑并给警告；用户可加点、删点或矩形兜底，不静默删部件 |
| SAM 完全不可用 | 允许手动画矩形/命名部件；不能伪称点式 SAM 已工作 |
| rig unsupported / invalid | 保留 Parts；引导拖拽挂接或回到拆件导出，不丢弃部件 |
| 内存/尺寸/帧数超限 | 展示 actual/limit，等待用户缩小图/帧数；不得自动降采样或静默少渲帧 |
| `NOT_IMPLEMENTED` | v3.0 completion 面板标示“遮挡补全将在 v3.1 提供”；不出现成功版本或空图下载 |
| CANCELLED / BUSY | 取消为普通状态；BUSY 等当前任务终态后重试，不能并行启动另一模型/渲染任务 |

所有 `messageKey` 形如 `character.error.<CODE>` 或 `character.warning.<CODE>`；`details` 不得含 key、图像、base64、完整 LLM response、prompt 原文、任意 URL query 或堆栈。返回可定位错误时，`partIds` 只放当前用户资产内 ID。

## 11. 自足性和验收约定

只实现/调用 segment 或 rig 的工程师可以仅凭本契约和它声明的 M1 type-only imports，创建一张 `InputAsset`，用 LLM transport mock 或点击 prompts 得到 mask `PartAsset[]`，建立 RigSpec/MotionPreset，渲染 RGBA sheet，再将结果交给 M1 API。项目必须将本文件里的声明示例编译成 TypeScript fixture；实现实际导出字段不得比本文件少，也不得自行追加公共 enum 成员。

v3.0 的主要回归必须包含：无 DOM 根入口 Node import；LLM 初始成功/一次 JSON repair 成功/repair 第二次失败/401、429、CORS、timeout/无 consent；非人形与 LLM 失败点击降级；模型 hash 错、Cache unavailable、WebGPU→WASM、双 provider 失败；box+point、正负点混合、mask bit order/空 mask/源像素一致；Rig tree/template/curve/参数上下限；nearest neighbor/z-order/透明合成/整段 frame hashes；取消和内存/帧上限；L3 返回 `NOT_IMPLEMENTED`。

这里的 v3 版本号是候选契约自己的版本，尚待产品主按项目流程确认。更新字段、模型格式、provider 语义、像素结果或 worker 消息前，必须修订本文件及 `architecture-v3.md`，按语义变更提高版本并获产品主确认；不得修改 M1 `interface-contract.md` 的 3.0.0/r4 冻结内容。
