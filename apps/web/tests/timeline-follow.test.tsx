import {
  DEFAULT_DETECT_OPTIONS,
  DEFAULT_NORMALIZE_OPTIONS,
  type Frame,
} from "@spriteflow/pipeline";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const scrollIntoViewMock = vi.fn();

const renderReviewScreen = async () => {
  const user = userEvent.setup();
  const { container } = render(<App />);
  const fileInput = document.getElementById("spriteflow-file");
  if (!(fileInput instanceof HTMLInputElement)) throw new Error("Upload input is missing");
  await user.upload(fileInput, uploadFile("sheet.png"));
  await screen.findByRole("button", { name: /确认审校/ });
  await waitFor(() => {
    expect(container.querySelectorAll(".frame-chip").length).toBe(FRAME_COUNT);
  });
  const row = container.querySelector<HTMLDivElement>(".frame-row");
  if (!row) throw new Error("Frame row is missing");
  return row;
};

const startPlayback = () => {
  fireEvent.click(screen.getByRole("button", { name: "播放" }));
};

const usePlaybackClock = () =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });

/** Advances playback in steps, returning whether follow scrolled at least once. */
const advanceAndFollows = (stepMs: number, steps: number) => {
  scrollIntoViewMock.mockClear();
  for (let i = 0; i < steps; i += 1) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
  return scrollIntoViewMock.mock.calls.length > 0;
};

const CHIP_STRIDE = 80;
const CHIP_WIDTH = 72;
const ROW_VIEW = 200;

const rect = (left: number, right: number): DOMRect =>
  ({
    bottom: 60,
    height: 60,
    left,
    right,
    top: 0,
    width: right - left,
    x: left,
    y: 0,
  }) as DOMRect;

/**
 * Emulates a horizontally scrollable chip row: chips sit at index*CHIP_STRIDE in content
 * coordinates, scrollLeft is backed by a plain variable, and programmatic scrollIntoView
 * scrolls synchronously but delivers the scroll event asynchronously, like a real browser.
 */
const installScrollHarness = (row: HTMLDivElement) => {
  let scroll = 0;
  Object.defineProperty(row, "scrollLeft", {
    configurable: true,
    get: () => scroll,
    set: (value: number) => {
      scroll = value;
    },
  });
  Object.defineProperty(row, "clientWidth", { configurable: true, value: ROW_VIEW });
  Object.defineProperty(row, "scrollWidth", {
    configurable: true,
    value: FRAME_COUNT * CHIP_STRIDE,
  });
  vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => rect(0, ROW_VIEW));
  for (const chip of row.querySelectorAll<HTMLElement>(".frame-chip")) {
    vi.spyOn(chip, "getBoundingClientRect").mockImplementation(() => {
      const index = Number(chip.dataset.frameIndex);
      const left = index * CHIP_STRIDE - scroll;
      return rect(left, left + CHIP_WIDTH);
    });
  }
  const siv = vi.fn(function scrollIntoViewStub(this: HTMLElement) {
    const index = Number(this.dataset.frameIndex);
    const chipLeft = index * CHIP_STRIDE;
    const chipRight = chipLeft + CHIP_WIDTH;
    if (chipLeft < scroll) scroll = chipLeft;
    else if (chipRight > scroll + ROW_VIEW) scroll = chipRight - ROW_VIEW;
    window.setTimeout(() => row.dispatchEvent(new Event("scroll")), 100);
  });
  Element.prototype.scrollIntoView = siv as unknown as Element["scrollIntoView"];
  return siv;
};

describe("timeline playhead follow", () => {
  beforeEach(() => {
    vi.useRealTimers();
    // The editor store is a module-level singleton; playing/fps leak across tests otherwise.
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
    Element.prototype.scrollIntoView = scrollIntoViewMock as unknown as Element["scrollIntoView"];
    scrollIntoViewMock.mockClear();
  });

  it("keeps following the playhead while playing at 12 FPS without user scrolling", async () => {
    await renderReviewScreen();
    usePlaybackClock();
    try {
      startPlayback();
      expect(advanceAndFollows(100, 3)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses follow for ~2s when the user wheels the chip row at 12 FPS, then resumes", async () => {
    const row = await renderReviewScreen();
    usePlaybackClock();
    try {
      startPlayback();
      expect(advanceAndFollows(100, 3)).toBe(true);

      fireEvent.wheel(row, { deltaX: 5000 });

      // Ticks keep firing every ~83ms during the pause; follow must not steal the row back.
      expect(advanceAndFollows(100, 19)).toBe(false);
      // Past the 2s pause the next tick follows the playhead again.
      expect(advanceAndFollows(100, 3)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses follow on plain scroll events (scrollbar/keyboard) at 12 FPS", async () => {
    const row = await renderReviewScreen();
    usePlaybackClock();
    try {
      startPlayback();
      expect(advanceAndFollows(100, 3)).toBe(true);

      fireEvent.scroll(row);

      expect(advanceAndFollows(100, 19)).toBe(false);
      expect(advanceAndFollows(100, 3)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the 2s pause and follow behavior working at 2 FPS", async () => {
    const row = await renderReviewScreen();
    usePlaybackClock();
    try {
      fireEvent.change(screen.getByDisplayValue("12"), { target: { value: "2" } });
      startPlayback();
      // 500ms per tick: follow scrolls on the first tick.
      expect(advanceAndFollows(500, 1)).toBe(true);

      fireEvent.wheel(row, { deltaX: 5000 });

      expect(advanceAndFollows(500, 3)).toBe(false);
      expect(advanceAndFollows(500, 1)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not re-arm the follow pause when the resume scroll lands on an in-view chip", async () => {
    const row = await renderReviewScreen();
    const siv = installScrollHarness(row);
    fireEvent.change(screen.getByDisplayValue("12"), { target: { value: "10" } });
    usePlaybackClock();
    try {
      startPlayback();
      act(() => {
        vi.advanceTimersByTime(50);
      });
      // Playback start runs follow once even though the chip is in view (no-op scroll).
      siv.mockClear();
      // User parks the row: pause armed at t=50, resume timer due at t=2050 while the
      // 100ms playback ticks land at t=100·k — the resume fires between two ticks.
      row.scrollLeft = 280;
      fireEvent.scroll(row);
      for (let i = 0; i < 20; i += 1) {
        act(() => {
          vi.advanceTimersByTime(100);
        });
      }
      expect(siv).not.toHaveBeenCalled();
      // t=2050: the resume runs follow once; its scroll event is queued for t=2150.
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(siv).toHaveBeenCalledTimes(1);
      // t=2100: the next tick finds the chip already in view and must keep the queued
      // programmatic target; the t=2150 event must be consumed, not treated as user scroll.
      for (let i = 0; i < 12; i += 1) {
        act(() => {
          vi.advanceTimersByTime(100);
        });
      }
      expect(siv.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
