// v3 拆部位工作区状态（镜像 M1 editor-store 的 zustand+zundo 模式）。
// 文档态（parts/prompts/选中）进撤销历史；会话态（屏幕/工具/视口/降级横幅）
// 不进历史但随 resetAll 一起清空，供工作区切换时整体重置（AC-V01-C）。

import type { PixelBuffer, Rect } from "@spriteflow/pipeline";
import type { PartAsset, PartKind, SamPoint, SegmentationResult } from "@spriteflow/segment";
import { removePartAsset } from "@spriteflow/segment";
import { temporal } from "zundo";
import { create } from "zustand";

export type PartsScreen = "upload" | "process" | "review";
export type PartsTool = "select" | "add-region" | "remove-region" | "add-part" | "pan";
/** 降级横幅来源（AC-V06：非人形 / 无 key / LLM 失败，诚实语气）。 */
export type PartsDegraded = "non-humanoid" | "no-key" | "llm-failed" | "low-confidence" | null;
/** v3 会话模式标签（copy-v3 parts.mode.*）。 */
export type PartsMode = "semantic" | "click" | null;
export interface ByokConfig {
  provider: "glm_4v" | "cogvlm" | "openai_gpt" | "custom";
  endpoint: string;
  model: string;
}
export interface PartsFileMeta {
  file: File;
  size: { width: number; height: number };
}

export interface PartsDocState {
  parts: PartAsset[];
  /** 每个部位累积的正/负提示点（精修时随整幅替换蒙版一起提交）。 */
  prompts: Record<string, SamPoint[]>;
  selectedPartId: string | null;
  /** 点击模式默认名 part_000 起补零的下一序号（copy-v3 §26）。 */
  nextClickIndex: number;
}
export interface PartsSessionState {
  screen: PartsScreen;
  tool: PartsTool;
  maskHighlight: boolean;
  zoom: number;
  pan: { x: number; y: number };
  mode: PartsMode;
  degraded: PartsDegraded;
  wasmFallbackWarning: boolean;
  file: PartsFileMeta | null;
  asset: { assetId: string; revision: number } | null;
  preview: PixelBuffer | null;
  workingSize: { width: number; height: number } | null;
  byok: ByokConfig | null;
  /** LLM 失败原因分类（llm.error.* 词条键，AC-V02-C）。 */
  llmFailure: "network" | "unauthorized" | "rate_limited" | "bad_response" | null;
  backendWasm: boolean;
  modelCached: boolean;
}

export interface PartsStore extends PartsDocState, PartsSessionState {
  resetAll(): void;
  setScreen(screen: PartsScreen): void;
  setTool(tool: PartsTool): void;
  setMaskHighlight(value: boolean): void;
  setViewport(zoom: number, pan: { x: number; y: number }): void;
  selectPart(id: string | null): void;
  setMode(mode: PartsMode): void;
  setFile(file: PartsFileMeta | null): void;
  setAsset(input: {
    asset: { assetId: string; revision: number };
    preview: PixelBuffer;
    workingSize: { width: number; height: number };
  }): void;
  setByok(config: ByokConfig | null): void;
  setModelInfo(info: { backendWasm: boolean; modelCached: boolean }): void;
  applySegmentResult(result: SegmentationResult): void;
  clearParts(): void;
  updatePartMask(
    partId: string,
    update: { mask: PartAsset["mask"]; sourceRect: Rect; predictedIou: number },
  ): void;
  addClickPart(part: PartAsset): void;
  removePart(partId: string): void;
  setDegraded(degraded: PartsDegraded, llmFailure?: PartsSessionState["llmFailure"]): void;
}

const cloneSession = (): PartsSessionState => ({
  screen: "upload",
  tool: "select",
  maskHighlight: true,
  zoom: 1,
  pan: { x: 0, y: 0 },
  mode: null,
  degraded: null,
  wasmFallbackWarning: false,
  file: null,
  asset: null,
  preview: null,
  workingSize: null,
  byok: null,
  llmFailure: null,
  backendWasm: false,
  modelCached: false,
});

const cloneDoc = (): PartsDocState => ({
  parts: [],
  prompts: {},
  selectedPartId: null,
  nextClickIndex: 0,
});

export const usePartsStore = create<PartsStore>()(
  temporal(
    (set, get) => ({
      ...cloneDoc(),
      ...cloneSession(),
      resetAll: () => set({ ...cloneDoc(), ...cloneSession() }),
      setScreen: (screen) => set({ screen }),
      setTool: (tool) => set({ tool }),
      setMaskHighlight: (maskHighlight) => set({ maskHighlight }),
      setViewport: (zoom, pan) => set({ zoom, pan }),
      selectPart: (selectedPartId) => set({ selectedPartId }),
      setMode: (mode) => set({ mode }),
      setFile: (file) => set({ file }),
      setAsset: ({ asset, preview, workingSize }) => set({ asset, preview, workingSize }),
      setByok: (byok) => set({ byok }),
      setModelInfo: (info) => set(info),
      /** L1+L2 成功结果落库：语义部位带名称；蒙版/几何来自包内生成的 PartAsset。 */
      applySegmentResult: (result) =>
        set(() => {
          const prompts: Record<string, SamPoint[]> = {};
          for (const part of result.parts) prompts[part.id] = [];
          return {
            parts: result.parts,
            prompts,
            selectedPartId: null,
            nextClickIndex: 0,
            mode: result.mode,
            wasmFallbackWarning: result.warnings.some(
              (entry) => entry.code === "WEBGPU_FALLBACK_TO_WASM",
            ),
          };
        }),
      /** 点击模式重新拆件：整体清空部位（一个撤销事务）。 */
      clearParts: () => set({ parts: [], prompts: {}, selectedPartId: null, nextClickIndex: 0 }),
      /** 点击精修：整幅替换蒙版 + 新几何（契约 r4：SamSession.segment 重推理语义）。 */
      updatePartMask: (partId, update) =>
        set((state) => {
          const current = state.parts.find((part) => part.id === partId);
          if (!current) return state;
          const total = update.sourceRect.width * update.sourceRect.height;
          let bits = 0;
          for (const byte of update.mask.data) bits += popcount(byte);
          const next: PartAsset = {
            ...current,
            mask: update.mask,
            sourceRect: update.sourceRect,
            canvas: {
              width: update.sourceRect.width,
              height: update.sourceRect.height,
              offset: { x: 0, y: 0 },
            },
            confidence: update.predictedIou,
            visibleFraction: total === 0 ? 0 : bits / total,
          };
          return {
            parts: state.parts.map((part) => (part.id === partId ? next : part)),
            prompts: { ...state.prompts, [partId]: [] },
          };
        }),
      addClickPart: (part) =>
        set((state) => ({
          parts: [...state.parts, part],
          prompts: { ...state.prompts, [part.id]: [] },
          selectedPartId: part.id,
          tool: "select",
          nextClickIndex: state.nextClickIndex + 1,
        })),
      removePart: (partId) =>
        set((state) => {
          const outcome = removePartAsset(state.parts, partId);
          if (!outcome.ok) return state;
          const prompts = { ...state.prompts };
          delete prompts[partId];
          return {
            parts: outcome.value,
            prompts,
            selectedPartId: state.selectedPartId === partId ? null : state.selectedPartId,
          };
        }),
      setDegraded: (degraded, llmFailure) =>
        set(
          llmFailure === undefined
            ? { degraded, llmFailure: degraded === null ? null : get().llmFailure }
            : { degraded, llmFailure },
        ),
    }),
    {
      limit: 100,
      partialize: (state) => ({
        parts: state.parts,
        prompts: state.prompts,
        selectedPartId: state.selectedPartId,
        nextClickIndex: state.nextClickIndex,
      }),
    },
  ),
);

function popcount(byte: number): number {
  let value = byte;
  let count = 0;
  while (value) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

/** 部位显示名：part_#### 形态的点击部位用 part.default_name，其余用 kind 词条。 */
export const CLICK_NAME_PATTERN = /^part_\d{3}$/;
export function isClickNamed(name: string): boolean {
  return CLICK_NAME_PATTERN.test(name);
}

/** 由 kind 推导的导出文件名 stem（copy-v3 §26：side 前缀 + kind 下划线组合）。 */
const KIND_STEM_BASE: Record<string, string> = {
  hair: "hair",
  head: "head",
  face: "face",
  eye: "eye",
  eyebrow: "eyebrow",
  mouth: "mouth",
  neck: "neck",
  torso: "torso",
  "upper-arm": "upper_arm",
  forearm: "forearm",
  hand: "hand",
  thigh: "thigh",
  shin: "lower_leg",
  foot: "foot",
  accessory: "accessory",
};
export function kindStem(kind: PartKind): string | null {
  for (const [base, stem] of Object.entries(KIND_STEM_BASE)) {
    if (kind === base) return stem;
    if (kind.startsWith(`${base}-`)) {
      const side = kind.slice(base.length + 1);
      if (side === "left" || side === "right") return `${side}_${stem}`;
    }
  }
  return null;
}
