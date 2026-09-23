import { DEFAULT_DETECT_OPTIONS, type Frame } from "@spriteflow/pipeline";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { App, DetectionMethod } from "../src/app/App";

const pipelineMock = vi.hoisted(() => ({ createPipelineClient: vi.fn() }));

vi.mock("@spriteflow/pipeline/browser", () => ({
  createPipelineClient: pipelineMock.createPipelineClient,
}));

const successfulTask = (command: string, value: unknown) => ({
  cancel: vi.fn(async () => ({ status: "already-finished" })),
  result: Promise.resolve({
    command,
    outcome: { ok: true, value },
    protocolVersion: 1,
    taskId: `task_${command}`,
  }),
});

const testFrame = (assetId: string): Frame => ({
  asset: { assetId, revision: 1 },
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
  id: `frame_${assetId}`,
  included: true,
  name: "frame_000",
  origin: "grid",
  pHash: null,
  reviewStatus: "pending",
  sourceFrameIds: [],
  sourceRect: { x: 0, y: 0, width: 1, height: 1 },
});

const uploadFile = (name: string) => {
  const file = new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(4) });
  return file;
};

describe("SpriteFlow app shell", () => {
  beforeEach(() => {
    pipelineMock.createPipelineClient.mockReset();
    pipelineMock.createPipelineClient.mockImplementation(() => {
      return {
        dispose: vi.fn(async () => {}),
        ready: Promise.resolve({ ok: true, value: {} }),
        submit: vi.fn(
          (
            command: string,
            payload: { ref?: { assetId: string }; asset?: { assetId: string } },
          ) => {
            const assetId = payload.ref?.assetId ?? payload.asset?.assetId ?? "unknown";
            if (command === "load")
              return successfulTask(command, {
                asset: { workingSize: { width: 1, height: 1 } },
                preview: { data: new Uint8ClampedArray(4), height: 1, width: 1 },
              });
            if (command === "detect")
              return successfulTask(command, {
                degraded: null,
                frames: [testFrame(assetId)],
                options: { ...DEFAULT_DETECT_OPTIONS },
                strategy: "grid",
              });
            if (command === "normalize")
              return successfulTask(command, {
                frames: [testFrame(assetId)],
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
          },
        ),
      };
    });
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
  it("renders the local-only upload state", () => {
    render(<App />);
    expect(screen.getByText("把透明精灵表变成引擎素材")).toBeTruthy();
    expect(screen.getByText(/文件只在你的浏览器中处理/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "选择图片" })).toBeTruthy();
  });

  it("switches visible copy without resetting the upload surface", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText("语言"), "en");
    expect(
      screen.getByText("Turn transparent sprite sheets into engine-ready assets"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose image" })).toBeTruthy();
  });

  it("opens the shortcut reference from the permanent header", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "快捷键" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "快捷键" })).toBeTruthy();
  });

  it("maps the pipeline strategy to its detection-method copy", () => {
    const { rerender } = render(<DetectionMethod locale="zh" strategy="components" />);
    expect(screen.getByText("区域")).toBeTruthy();

    rerender(<DetectionMethod locale="zh" strategy="grid" />);
    expect(screen.getByText("网格")).toBeTruthy();

    rerender(<DetectionMethod locale="en" strategy="manual-grid" />);
    expect(screen.getByText("Manual")).toBeTruthy();
  });

  it("starts a fresh worker session after export before processing another upload", async () => {
    const user = userEvent.setup();
    render(<App />);
    const fileInput = document.getElementById("spriteflow-file");
    if (!(fileInput instanceof HTMLInputElement)) throw new Error("Upload input is missing");

    await user.upload(fileInput, uploadFile("first.png"));
    await screen.findByRole("button", { name: /确认审校/ });
    await user.click(screen.getByRole("button", { name: /确认审校/ }));
    await user.click(screen.getByRole("button", { name: /^导出$/ }));
    await user.click(screen.getByRole("button", { name: "生成并下载" }));
    await screen.findByText(/导出完成/);
    expect(screen.queryByText("正在处理，请稍候。")).toBeNull();

    await user.click(screen.getByRole("button", { name: "换一张图" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "换图" }));
    await screen.findByText("把透明精灵表变成引擎素材");
    const secondInput = document.getElementById("spriteflow-file");
    if (!(secondInput instanceof HTMLInputElement))
      throw new Error("Replacement upload input is missing");
    await user.upload(secondInput, uploadFile("second.png"));

    await screen.findByRole("button", { name: /确认审校/ });
    expect(screen.queryByText("出了点问题")).toBeNull();
    expect(screen.queryByText("正在处理，请稍候。")).toBeNull();
    expect(pipelineMock.createPipelineClient).toHaveBeenCalledTimes(2);
  });
});
