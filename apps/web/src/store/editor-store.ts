import type {
  DetectOptions,
  Frame,
  FrameDraft,
  NormalizeOptions,
  Rect,
} from "@spriteflow/pipeline";
import { DEFAULT_DETECT_OPTIONS, DEFAULT_NORMALIZE_OPTIONS } from "@spriteflow/pipeline";
import { temporal } from "zundo";
import { create } from "zustand";

export type Tool = "select" | "pan" | "add" | "split";
export type Filter = "all" | "attention" | "outlier" | "multipleComponents" | "empty";
export interface DocumentState {
  drafts: FrameDraft[];
  normalized: Frame[];
  selected: string[];
  detection: DetectOptions;
  normalization: NormalizeOptions;
  editRevision: number;
}
export interface Store extends DocumentState {
  tool: Tool;
  filter: Filter;
  zoom: number;
  pan: { x: number; y: number };
  fps: number;
  onion: boolean;
  playing: boolean;
  setDocument(frames: Frame[], detection: DetectOptions): void;
  setSelection(ids: string[]): void;
  setTool(tool: Tool): void;
  setFilter(filter: Filter): void;
  setViewport(zoom: number, pan: { x: number; y: number }): void;
  setPreview(fps: number, onion: boolean, playing: boolean): void;
  replaceDrafts(drafts: FrameDraft[]): void;
  updateRect(id: string, rect: Rect): void;
  updateRects(rects: Record<string, Rect>): void;
  addDraft(rect: Rect): void;
  removeSelected(): void;
  mergeSelected(): void;
  splitSelected(axis: "vertical" | "horizontal", cut: number): void;
  reorder(from: number, to: number): void;
  confirm(): void;
  resetReview(): void;
}
const cloneDetect = (): DetectOptions => structuredClone(DEFAULT_DETECT_OPTIONS);
const draft = (frame: Frame): FrameDraft => ({
  id: frame.id,
  name: frame.name,
  sourceRect: { ...frame.sourceRect },
  origin: frame.origin,
  sourceFrameIds: [...frame.sourceFrameIds],
  edited: frame.flags.edited,
  included: frame.included,
  reviewStatus: frame.reviewStatus,
});
const resetPending = (drafts: FrameDraft[]) =>
  drafts.map((entry) => ({ ...entry, reviewStatus: "pending" as const }));
export const useEditorStore = create<Store>()(
  temporal(
    (set, get) => ({
      drafts: [],
      normalized: [],
      selected: [],
      detection: cloneDetect(),
      normalization: structuredClone(DEFAULT_NORMALIZE_OPTIONS),
      editRevision: 0,
      tool: "select",
      filter: "all",
      zoom: 1,
      pan: { x: 0, y: 0 },
      fps: 12,
      onion: false,
      playing: false,
      setDocument: (frames, detection) =>
        set({
          normalized: frames,
          drafts: frames.map(draft),
          detection: structuredClone(detection),
          selected: [],
          editRevision: get().editRevision + 1,
        }),
      setSelection: (selected) => set({ selected }),
      setTool: (tool) => set({ tool }),
      setFilter: (filter) => set({ filter }),
      setViewport: (zoom, pan) => set({ zoom, pan }),
      setPreview: (fps, onion, playing) => set({ fps, onion, playing }),
      replaceDrafts: (drafts) =>
        set({ drafts: resetPending(drafts), selected: [], editRevision: get().editRevision + 1 }),
      updateRect: (id, sourceRect) =>
        set((state) => ({
          drafts: resetPending(
            state.drafts.map((entry) =>
              entry.id === id ? { ...entry, sourceRect, edited: true } : entry,
            ),
          ),
          editRevision: state.editRevision + 1,
        })),
      updateRects: (rects) =>
        set((state) => ({
          drafts: resetPending(
            state.drafts.map((entry) => {
              const sourceRect = rects[entry.id];
              return sourceRect ? { ...entry, sourceRect, edited: true } : entry;
            }),
          ),
          editRevision: state.editRevision + 1,
        })),
      addDraft: (sourceRect) =>
        set((state) => {
          const id = `m_${crypto.randomUUID().replaceAll("-", "")}`;
          const entry: FrameDraft = {
            id,
            name: `frame_${String(state.drafts.length).padStart(3, "0")}`,
            sourceRect,
            origin: "manual",
            sourceFrameIds: [],
            edited: true,
            included: true,
            reviewStatus: "pending",
          };
          return {
            drafts: [...resetPending(state.drafts), entry],
            selected: [id],
            tool: "select",
            editRevision: state.editRevision + 1,
          };
        }),
      removeSelected: () =>
        set((state) => ({
          drafts: resetPending(
            state.drafts.map((entry) =>
              state.selected.includes(entry.id) ? { ...entry, included: false } : entry,
            ),
          ),
          selected: [],
          editRevision: state.editRevision + 1,
        })),
      mergeSelected: () =>
        set((state) => {
          const frames = state.drafts.filter((entry) => state.selected.includes(entry.id));
          if (frames.length < 2) return state;
          const x = Math.min(...frames.map((entry) => entry.sourceRect.x));
          const y = Math.min(...frames.map((entry) => entry.sourceRect.y));
          const right = Math.max(
            ...frames.map((entry) => entry.sourceRect.x + entry.sourceRect.width),
          );
          const bottom = Math.max(
            ...frames.map((entry) => entry.sourceRect.y + entry.sourceRect.height),
          );
          const id = `m_${crypto.randomUUID().replaceAll("-", "")}`;
          const merged: FrameDraft = {
            id,
            name: `frame_${String(state.drafts.length).padStart(3, "0")}`,
            sourceRect: { x, y, width: right - x, height: bottom - y },
            origin: "manual",
            sourceFrameIds: frames.map((entry) => entry.id),
            edited: true,
            included: true,
            reviewStatus: "pending",
          };
          return {
            drafts: [
              ...resetPending(state.drafts.filter((entry) => !state.selected.includes(entry.id))),
              merged,
            ],
            selected: [id],
            editRevision: state.editRevision + 1,
          };
        }),
      splitSelected: (axis, cut) =>
        set((state) => {
          const selected = state.drafts.find((entry) => entry.id === state.selected[0]);
          if (!selected) return state;
          const r = selected.sourceRect;
          const first =
            axis === "vertical" ? { ...r, width: cut - r.x } : { ...r, height: cut - r.y };
          const second =
            axis === "vertical"
              ? { x: cut, y: r.y, width: r.x + r.width - cut, height: r.height }
              : { x: r.x, y: cut, width: r.width, height: r.y + r.height - cut };
          if (first.width < 1 || first.height < 1 || second.width < 1 || second.height < 1)
            return state;
          const make = (sourceRect: Rect): FrameDraft => ({
            ...selected,
            id: `m_${crypto.randomUUID().replaceAll("-", "")}`,
            sourceRect,
            sourceFrameIds: [selected.id],
            origin: "manual",
            edited: true,
            reviewStatus: "pending",
          });
          return {
            drafts: [
              ...resetPending(state.drafts.filter((entry) => entry.id !== selected.id)),
              make(first),
              make(second),
            ],
            selected: [],
            editRevision: state.editRevision + 1,
          };
        }),
      reorder: (from, to) =>
        set((state) => {
          const drafts = [...state.drafts];
          const [entry] = drafts.splice(from, 1);
          if (!entry) return state;
          drafts.splice(to, 0, entry);
          return { drafts: resetPending(drafts), editRevision: state.editRevision + 1 };
        }),
      confirm: () =>
        set((state) => ({
          drafts: state.drafts.map((entry) =>
            entry.included ? { ...entry, reviewStatus: "accepted" } : entry,
          ),
          editRevision: state.editRevision + 1,
        })),
      resetReview: () =>
        set((state) => ({
          drafts: resetPending(state.drafts),
          editRevision: state.editRevision + 1,
        })),
    }),
    {
      limit: 100,
      partialize: (state) => ({
        drafts: state.drafts,
        normalized: state.normalized,
        selected: state.selected,
        detection: state.detection,
        normalization: state.normalization,
        editRevision: state.editRevision,
      }),
    },
  ),
);
