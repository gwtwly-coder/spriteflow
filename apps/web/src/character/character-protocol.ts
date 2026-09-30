// 主线程 ↔ Character Worker 的协议类型（Comlink 传输形状）。
// 契约 §3 :333：key 只进 Worker（仅在 run() 的 llm 配置中出现，绝不回传）。

import type { AssetRef, Rect, Size } from "@spriteflow/pipeline";
import type {
  BitMask,
  CharacterError,
  CharacterProgressEvent,
  LlmProviderConfig,
  PartAsset,
  PartExportName,
  PartExportResult,
  SamExecutionProvider,
  SamPoint,
  SegmentationResult,
} from "@spriteflow/segment";

export type LlmFailureReason = "network" | "unauthorized" | "rate_limited" | "bad_response";
export type CharacterProgressCallback = (event: CharacterProgressEvent) => void;

export interface CharacterLoadInput {
  ref: AssetRef;
  name: string;
  mime: "image/png" | "image/webp";
  bytes: ArrayBuffer;
  resizeTo: Size | null;
}

export interface CharacterLoadOutput {
  ok: boolean;
  error?: CharacterError;
  workingSize?: Size;
  /** 契约 §3 的 LlmImage 输入尺寸（语义定位外发图片的实际像素）。 */
  imageSource?: { width: number; height: number };
}

export interface CharacterRunInput {
  llm: LlmProviderConfig | null;
  consent: boolean;
  onProgress: CharacterProgressCallback;
}

export interface CharacterRunOutput {
  ok: boolean;
  result?: SegmentationResult;
  error?: CharacterError;
  llmFailure?: LlmFailureReason;
}

export interface CharacterPrepareInput {
  onProgress: CharacterProgressCallback;
}

export interface CharacterPrepareOutput {
  ok: boolean;
  error?: CharacterError;
  provider?: SamExecutionProvider;
  cachedModel?: boolean;
  webgpuFallback?: boolean;
}

export interface CharacterRefineInput {
  /** 精修提示：box = 当前部位紧框（图坐标），points = 累积点 + 本次点击。 */
  prompt: { box: Rect | null; points: SamPoint[] };
}

export interface CharacterRefineOutput {
  ok: boolean;
  error?: CharacterError;
  mask?: BitMask;
  sourceRect?: Rect;
  predictedIou?: number;
}

export interface CharacterExportInput {
  parts: PartAsset[];
  names: PartExportName[];
  onProgress: CharacterProgressCallback;
}

export interface CharacterExportOutput {
  ok: boolean;
  error?: CharacterError;
  result?: PartExportResult;
}

export interface CharacterWorkerApi {
  /** 解码并持有工作图（预检已由 M1 管线完成，这里只做解码与几何构建）。 */
  load(input: CharacterLoadInput): Promise<CharacterLoadOutput>;
  /** L1 语义定位 + L2 SAM 精修（编排跑在 Worker 内，key 不出 Worker）。 */
  run(input: CharacterRunInput): Promise<CharacterRunOutput>;
  /** 预备本地模型会话（点击模式入口 / 审校精修前置）。 */
  prepare(input: CharacterPrepareInput): Promise<CharacterPrepareOutput>;
  /** 点击增删：SamSession.segment 重推理，返回整幅替换蒙版。 */
  refine(input: CharacterRefineInput): Promise<CharacterRefineOutput>;
  /** 部位 ZIP 导出（含三断言与 PNG 编码后复验）。 */
  exportParts(input: CharacterExportInput): Promise<CharacterExportOutput>;
  /** 取消当前任务（进度/终态联动，AC-V02/AC-V03）。 */
  cancel(): void;
  /** 冻结清单的真实模型总体积（MB 展示用）。 */
  modelBytes(): number;
  /** 释放会话与后端（换图/工作区切换时调用）。 */
  dispose(): Promise<void>;
}
