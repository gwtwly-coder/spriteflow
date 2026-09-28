import {
  DEFAULT_DETECT_OPTIONS,
  DEFAULT_NORMALIZE_OPTIONS,
  type Frame,
} from "@spriteflow/pipeline";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { useEditorStore } from "../src/store/editor-store";

const pipelineMock = vi.hoisted(() => ({ createPipelineClient: vi.fn() }));

vi.mock("@spriteflow/pipeline/browser", () => ({
  createPipelineClient: pipelineMock.createPipelineClient,
}));

const FRAME_COUNT = 6;

const successfulTask = (command: string, value: unknown) => ({
  cancel: vi.fn(async () => ({ status: "already-finished" })),
  result: Promise.resolve({
    command,
    outcome: { ok: true, value },
    protocolVersion: 1,
    taskId: `task_${command}`,
  }),
});

const testFrame = (index: number): Frame => ({
  asset: { assetId: "test-asset", revision: 1 },
  bbox: { x: 0, y: 0, width: 1, height: 1 },
  canvas: { width: 1, height: 1, offset: { x: 0, y: 0 } },
  clusterId: null,
  flags: {
    duplicateOf: null,
    edited: false,
    empty: false,
    merged: false,
    multipleComponents: false,
    outlier: false,
  },
  id: `frame_${index}`,
  included: true,
  name: `frame_${String(index).padStart(3, "0")}`,
  origin: "grid",
  pHash: null,
  reviewStatus: "pending",
  sourceFrameIds: [],
  sourceRect: { x: 0, y: 0, width: 1, height: 1 },
});

const timelineFrames = Array.from({ length: FRAME_COUNT }, (_, index) => testFrame(index));

const uploadFile = (name: string) => {
  const file = new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(4) });
  return file;
};

const chips = () => document.querySelectorAll(".frame-chip").length;

const toolButton = (label: string) => {
  const button = [...document.querySelectorAll(".toolbar .tool")].find((b) =>
    b.textContent?.includes(label),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} button is missing`);
  return button;
};

const renderReviewScreen = async () => {
  const user = userEvent.setup();
  render(<App />);
  const fileInput = document.getElementById("spriteflow-file");
  if (!(fileInput instanceof HTMLInputElement)) throw new Error("Upload input is missing");
  await user.upload(fileInput, uploadFile("sheet.png"));
  await screen.findByRole("button", { name: /确认审校/ });
  await waitFor(() => {
    expect(chips()).toBe(FRAME_COUNT);
  });
  return user;
};

const deleteChip = async (user: ReturnType<typeof userEvent.setup>, index: number) => {
  document.querySelectorAll<HTMLButtonElement>(".frame-chip")[index]?.click();
  await waitFor(() => {
    expect(toolButton("删除帧").disabled).toBe(false);
  });
  await user.click(toolButton("删除帧"));
  const dialog = screen.getByRole("dialog");
  const confirm = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "删除");
  if (!confirm) throw new Error("Delete confirmation button is missing");
  await user.click(confirm);
  await screen.findByText("已删除帧。");
};

describe("frame deletion", () => {
  beforeEach(() => {
    useEditorStore.setState({
      drafts: [],
      normalized: [],
      selected: [],
      detection: structuredClone(DEFAULT_DETECT_OPTIONS),
      normalization: structuredClone(DEFAULT_NORMALIZE_OPTIONS),
      editRevision: 0,
      tool: "select",
      filter: "all",
      zoom: 1,
      pan: { x: 0, y: 0 },
      fps: 12,
      onion: false,
      playing: false,
    });
    useEditorStore.temporal.getState().clear();
    pipelineMock.createPipelineClient.mockReset();
    pipelineMock.createPipelineClient.mockImplementation(() => ({
      dispose: vi.fn(async () => {}),
      ready: Promise.resolve({ ok: true, value: {} }),
      submit: vi.fn((command: string, payload: { asset?: { assetId: string } }) => {
        const assetId = payload.asset?.assetId ?? "unknown";
        if (command === "load")
          return successfulTask(command, {
            asset: { workingSize: { width: 1, height: 1 } },
            preview: { data: new Uint8ClampedArray(4), height: 1, width: 1 },
          });
        if (command === "detect")
          return successfulTask(command, {
            degraded: null,
            diagnostics: {
              componentConfidence: 0.9,
              componentCount: FRAME_COUNT,
              effectiveDilationRadiusPx: 1,
              effectiveMergeDistancePx: 0,
              effectiveMinAreaPx: 4,
              filteredComponentCount: FRAME_COUNT,
              foregroundPixels: 20,
              gridConfidence: 0.9,
            },
            frames: timelineFrames,
            options: { ...DEFAULT_DETECT_OPTIONS },
            strategy: "grid",
          });
        if (command === "normalize")
          return successfulTask(command, {
            frames: timelineFrames,
            normalizationId: `normalization_${assetId}`,
          });
        if (command === "pack") return successfulTask(command, { packId: `pack_${assetId}` });
        if (command === "export")
          return successfulTask(command, {
            archive: new ArrayBuffer(4),
            fileName: "atlas.zip",
            mime: "application/zip",
          });
        return successfulTask(command, { released: true });
      }),
    }));
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ close: vi.fn(), height: 1, width: 1 })),
    );
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: vi.fn(() => "blob:test") },
      revokeObjectURL: { configurable: true, value: vi.fn() },
    });
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "test-asset") });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("removes the selected frame from the timeline after confirmation", async () => {
    const user = await renderReviewScreen();

    await deleteChip(user, 0);

    expect(chips()).toBe(FRAME_COUNT - 1);
    expect(screen.getByText(`${FRAME_COUNT - 1} 帧`)).toBeTruthy();
    expect(toolButton("删除帧").disabled).toBe(true);
    expect(useEditorStore.getState().drafts.map((entry) => entry.id)).not.toContain("frame_0");
    const drafts = useEditorStore.getState().drafts;
    expect(drafts.every((entry) => entry.included)).toBe(true);
  });

  it("restores the deleted frame with undo and re-deletes it with redo", async () => {
    const user = await renderReviewScreen();

    await deleteChip(user, 0);
    expect(chips()).toBe(FRAME_COUNT - 1);

    await user.keyboard("{Control>}z}");
    expect(chips()).toBe(FRAME_COUNT);
    expect(useEditorStore.getState().drafts.map((entry) => entry.id)).toContain("frame_0");

    await user.keyboard("{Control>}y}");
    expect(chips()).toBe(FRAME_COUNT - 1);
    expect(useEditorStore.getState().drafts.map((entry) => entry.id)).not.toContain("frame_0");
  });
});
