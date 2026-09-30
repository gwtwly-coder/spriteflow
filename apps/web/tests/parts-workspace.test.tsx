// v3 拆部位工作区组件测试（Vitest + Testing Library）：交互断言端到端数据变化。
// 夹具：假 Character Worker（Comlink 通道整体替换的可编程 fake client，key 不出
// 夹具）+ 假 M1 pipeline client；LLM 失败形态经 llmFailure 分类映射为横幅原因
// 文案（transport 层在真实 Worker 内，UI 侧可观测面即 llm.error.* 词条）。

import type { PipelineClient } from "@spriteflow/pipeline";
import type { BitMask, PartAsset, PartExportResult, SegmentationResult } from "@spriteflow/segment";
import { CharacterErrorCode, PartKind, SegmentationDegradedReason } from "@spriteflow/segment";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { App } from "../src/app/App";
import { PartsWorkspace } from "../src/character/PartsWorkspace";
import { usePartsStore } from "../src/character/parts-store";

const characterMock = vi.hoisted(() => {
  return {
    behavior: {
      run: undefined as (() => unknown) | undefined,
      refine: undefined as (() => unknown) | undefined,
      prepare: undefined as (() => unknown) | undefined,
    },
    client: undefined as ReturnType<typeof makeFakeCharacterClient> | undefined,
  };
});

function makeFakeCharacterClient() {
  return {
    load: vi.fn(async () => ({
      ok: true as const,
      workingSize: { width: 8, height: 8 },
      imageSource: { width: 8, height: 8 },
    })),
    run: vi.fn(async () => {
      if (characterMock.behavior.run) return characterMock.behavior.run();
      return { ok: true as const, result: semanticResult() };
    }),
    prepare: vi.fn(async () => {
      if (characterMock.behavior.prepare) return characterMock.behavior.prepare();
      return {
        ok: true as const,
        provider: "wasm" as const,
        cachedModel: true,
        webgpuFallback: false,
      };
    }),
    refine: vi.fn(async () => {
      if (characterMock.behavior.refine) return characterMock.behavior.refine();
      return {
        ok: true as const,
        mask: twoByTwoMask(),
        sourceRect: { x: 0, y: 0, width: 2, height: 2 },
        predictedIou: 0.91,
      };
    }),
    exportParts: vi.fn(async () => ({ ok: true as const, result: exportResult() })),
    cancel: vi.fn(),
    modelBytes: vi.fn(async () => 80_000_000),
    dispose: vi.fn(async () => {}),
  };
}

vi.mock("../src/character/character-client", () => ({
  getCharacterClient: () => {
    characterMock.client ??= makeFakeCharacterClient();
    return characterMock.client;
  },
  resetCharacterClient: async () => {
    characterMock.client = undefined;
  },
}));

const pipelineMock = vi.hoisted(() => ({ createPipelineClient: vi.fn() }));

vi.mock("@spriteflow/pipeline/browser", () => ({
  createPipelineClient: pipelineMock.createPipelineClient,
}));

// --- 固定形状 ---------------------------------------------------------------

const ASSET_REF = { assetId: "test-asset", revision: 1 };

const twoByTwoMask = (): BitMask => ({
  width: 2,
  height: 2,
  encoding: "bitset-lsb0-row-major",
  data: new Uint8Array([0b1111]),
});

const semanticPart = (id: string, name: string, kind: PartKind): PartAsset => ({
  id,
  asset: ASSET_REF,
  name,
  kind,
  sourceRect: { x: 0, y: 0, width: 2, height: 2 },
  mask: twoByTwoMask(),
  canvas: { width: 2, height: 2, offset: { x: 0, y: 0 } },
  confidence: 0.93,
  occluded: false,
  visibleFraction: 1,
});

const semanticResult = (): SegmentationResult => ({
  asset: ASSET_REF,
  mode: "semantic",
  humanoid: { isHumanoid: true, confidence: 0.9, reason: "humanoid" },
  parts: [semanticPart("part-hair", "hair", PartKind.Hair)],
  confidence: 0.93,
  degraded: null,
  warnings: [],
});

const exportResult = (): PartExportResult => ({
  fileName: "parts.zip",
  mime: "application/zip",
  archive: new ArrayBuffer(8),
  files: [],
  manifest: {
    schemaVersion: "spriteflow-parts/1",
    coordinateSystem: "top-left-half-open-working-pixels",
    asset: ASSET_REF,
    sourceSize: { width: 8, height: 8 },
    parts: [],
  },
});

const successfulTask = (value: unknown) => ({
  cancel: vi.fn(async () => ({})),
  result: Promise.resolve({ outcome: { ok: true, value } }),
});

const pngFile = (name = "hero.png") => {
  const file = new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(4) });
  return file;
};

const firstOf = (elements: HTMLElement[]): HTMLElement => {
  const first = elements[0];
  if (!first) throw new Error("expected at least one matching element");
  return first;
};

async function uploadFile(file = pngFile()) {
  const input = document.getElementById("spriteflow-parts-file") as HTMLInputElement;
  await waitFor(() => expect(input).toBeTruthy());
  const changeEvent = { target: { files: [file] } };
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.change(input, changeEvent);
}

/** 上传 → 无 key 路径卡 → 点击模式进入审校（本地路径，不触 LLM）。 */
async function reachReviewByClickMode(user: ReturnType<typeof userEvent.setup>) {
  render(
    <PartsWorkspace
      locale="zh"
      setLocale={() => {}}
      onSwitchRequest={() => {}}
      onDirtyChange={() => {}}
    />,
  );
  await uploadFile();
  const useClick = await screen.findByText("使用点击模式");
  await user.click(useClick);
  await screen.findByText("审校部位");
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  characterMock.behavior.run = undefined;
  characterMock.behavior.refine = undefined;
  characterMock.behavior.prepare = undefined;
  characterMock.client = undefined;
  usePartsStore.getState().resetAll();
  usePartsStore.temporal.getState().clear();
  pipelineMock.createPipelineClient.mockReset();
  pipelineMock.createPipelineClient.mockImplementation(
    (): PipelineClient =>
      ({
        dispose: vi.fn(async () => ({})),
        ready: Promise.resolve({ ok: true, value: {} }),
        submit: vi.fn(() =>
          successfulTask({
            asset: { workingSize: { width: 8, height: 8 } },
            preview: {
              data: new Uint8ClampedArray(8 * 8 * 4),
              width: 8,
              height: 8,
              format: "rgba8",
              colorSpace: "srgb",
              alphaMode: "straight",
            },
          }),
        ),
      }) as unknown as PipelineClient,
  );
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ close: vi.fn(), width: 8, height: 8 })),
  );
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "test-asset") });
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: vi.fn(() => "blob:test") },
    revokeObjectURL: { configurable: true, value: vi.fn() },
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
});

// --- 用例 -------------------------------------------------------------------

describe("v3 parts workspace", () => {
  it("adds a part with the add-part tool: list grows and export enables", async () => {
    const user = userEvent.setup();
    await reachReviewByClickMode(user);
    // 零部位空状态：导出禁用并带说明。
    const exportButton = screen.getByRole("button", { name: "导出" });
    expect(exportButton).toHaveProperty("disabled", true);
    expect(screen.getByText("还没有部位。用“新增部位”点击图中区域。")).toBeTruthy();
    // 加区域 → 画布点击 → refine 正点 → 列表 +1（part_000 起默认名）。
    await user.click(screen.getByRole("button", { name: /新增部位/ }));
    const canvas = screen.getByLabelText("部位画布");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    await screen.findByText("部位 1");
    expect(screen.getByText("部位 1")).toBeTruthy();
    expect((screen.getByRole("button", { name: "导出" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(characterMock.client?.refine).toHaveBeenCalledTimes(1);
    expect((characterMock.client?.refine.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
      prompt: { box: null, points: [{ label: "positive" }] },
    });
    expect(usePartsStore.getState().parts[0]?.name).toBe("part_000");
  });

  it("deletes the selected part after confirmation: it disappears and export disables", async () => {
    const user = userEvent.setup();
    await reachReviewByClickMode(user);
    await user.click(screen.getByRole("button", { name: /新增部位/ }));
    const canvas = screen.getByLabelText("部位画布");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    await screen.findByText("部位 1");
    // 选中 → 删除 → 确认对话框 → 列表清空、导出禁用。
    await user.click(screen.getByRole("button", { name: /已选部位|部位 1/ }));
    await user.click(screen.getByRole("button", { name: "删除部位" }));
    await screen.findByText("删除这个部位？");
    await user.click(screen.getByRole("button", { name: "删除" }));
    await screen.findByText("还没有部位。用“新增部位”点击图中区域。");
    expect(screen.queryByText("部位 1")).toBeNull();
    expect((screen.getByRole("button", { name: "导出" }) as HTMLButtonElement).disabled).toBe(true);
    expect(usePartsStore.getState().parts).toHaveLength(0);
  });

  it("shows the no-key fallback banner with honest wording after click-mode entry", async () => {
    const user = userEvent.setup();
    await reachReviewByClickMode(user);
    // 诚实语气：不硬猜、给出两条明确路径（配置 / 点击模式）。
    expect(screen.getByText("语义定位还没配置")).toBeTruthy();
    expect(
      screen.getByText("可以配置 API Key 自动命名部位，或直接用本地点击模式拆件。"),
    ).toBeTruthy();
    expect(screen.getAllByText("配置语义定位").length).toBeGreaterThan(0);
  });

  it("returns to the W2 path card instead of a fake progress screen after the key is cleared and rerun (P1-1)", async () => {
    const user = userEvent.setup();
    await reachReviewByClickMode(user);
    // 存 key → 清除 Key（store.byok 仍在、key 已清）。
    await user.click(firstOf(await screen.findAllByText("配置语义定位")));
    await user.type(await screen.findByLabelText("API Key"), "sk-test");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await user.click(firstOf(await screen.findAllByText("配置语义定位")));
    await screen.findByText("语义定位设置");
    await user.click(screen.getByRole("button", { name: "清除 Key" }));
    // 重新拆件 → 同意 → 不得停在假"正在拆部位"：应回路径选择卡（AC-V06-B）。
    await user.click(screen.getByRole("button", { name: "重新拆件" }));
    await screen.findByText("重新拆件并替换当前部位？");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "重新拆件" }));
    await screen.findByText("语义定位会把这张图片发送到你配置的 GLM-4V。");
    await user.click(screen.getByRole("button", { name: "同意并开始拆件" }));
    await screen.findByText("配置 API Key 后可自动命名部位；不配置也能用本地点击模式拆件。");
    expect(screen.getByRole("button", { name: "使用点击模式" })).toBeTruthy();
    expect(characterMock.client?.run).not.toHaveBeenCalled();
  });

  it("surfaces the WASM fallback hint when prepare reports no WebGPU (P1-2 / AC-V03-B)", async () => {
    characterMock.behavior.prepare = () => ({
      ok: true as const,
      provider: "wasm" as const,
      cachedModel: true,
      webgpuFallback: true,
    });
    const user = userEvent.setup();
    await reachReviewByClickMode(user);
    // 回退提示在审校横幅区持续在场（性能差异，非错误弹出）。
    expect(
      screen.getByText("当前浏览器不支持 WebGPU，已切换到兼容模式，速度会慢一些。"),
    ).toBeTruthy();
  });

  it("surfaces non-humanoid degradation verbatim and lands in click mode", async () => {
    const user = userEvent.setup();
    render(
      <PartsWorkspace
        locale="zh"
        setLocale={() => {}}
        onSwitchRequest={() => {}}
        onDirtyChange={() => {}}
      />,
    );
    // 配置 BYOK（假 key 只进夹具），上传后走同意 → 语义 run → 非人形降级。
    await user.click(firstOf(await screen.findAllByText("配置语义定位")));
    await user.type(await screen.findByLabelText("API Key"), "sk-test");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await uploadFile();
    await screen.findByText("语义定位会把这张图片发送到你配置的 GLM-4V。");
    characterMock.behavior.run = () => ({
      ok: true as const,
      result: {
        ...semanticResult(),
        mode: "click" as const,
        humanoid: { isHumanoid: false, confidence: 0.8, reason: "non-humanoid" as const },
        parts: [],
        degraded: {
          reason: SegmentationDegradedReason.NonHumanoid,
          nextMode: "click" as const,
          messageKey: "degraded.non_humanoid",
        },
      },
    });
    await user.click(screen.getByRole("button", { name: "同意并开始拆件" }));
    await screen.findByText("这张图不像人形角色");
    expect(screen.getByText("没有硬猜。已切到纯点击模式，逐个点出你需要的部位。")).toBeTruthy();
    // 模式标签与零部位空状态同时在场（降级进点击模式，AC-V06）。
    expect(screen.getAllByText("模式：点击").length).toBeGreaterThan(0);
    expect(screen.getByText("还没有部位。用“新增部位”点击图中区域。")).toBeTruthy();
  });

  it("shows the reason-matched LLM failure card with retry and click-mode actions (AC-V02-C)", async () => {
    const user = userEvent.setup();
    render(
      <PartsWorkspace
        locale="zh"
        setLocale={() => {}}
        onSwitchRequest={() => {}}
        onDirtyChange={() => {}}
      />,
    );
    await user.click(firstOf(await screen.findAllByText("配置语义定位")));
    await user.type(await screen.findByLabelText("API Key"), "sk-bad");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await uploadFile();
    await screen.findByText("语义定位会把这张图片发送到你配置的 GLM-4V。");
    characterMock.behavior.run = () => ({
      ok: false as const,
      error: {
        code: CharacterErrorCode.LlmAuthenticationFailed,
        messageKey: "character.error.LLM_AUTHENTICATION_FAILED",
        stage: "validate" as never,
        recoverable: true,
        recoveryActions: ["configure-key"],
        details: {},
      },
      llmFailure: "unauthorized" as const,
    });
    await user.click(screen.getByRole("button", { name: "同意并开始拆件" }));
    // LLM 失败不进模型失败卡：原因匹配说明 + 重试语义定位/使用点击模式两条路径。
    await screen.findByText("语义定位没成功");
    expect(screen.getByText("API Key 无效。")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "使用点击模式" }));
    await screen.findByText("审校部位");
    // 已上传的图片保留（无需重新上传，AC-V06-C）：工作区标题栏显示文件名。
    expect(screen.getByText("hero.png")).toBeTruthy();
  });

  it("keeps parts when the user cancels the workspace switch (App shell)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "拆部位" }));
    await uploadFile();
    await user.click(await screen.findByText("使用点击模式"));
    await screen.findByText("审校部位");
    await user.click(screen.getByRole("button", { name: /新增部位/ }));
    const canvas = screen.getByLabelText("部位画布");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    await screen.findByText("部位 1");
    // 触发切换确认 → 取消 → 部位数据原样保留。
    await user.click(screen.getByRole("button", { name: "切帧" }));
    await screen.findByText("切换到切帧工作区？");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText("切换到切帧工作区？")).toBeNull();
    expect(screen.getByText("部位 1")).toBeTruthy();
    expect(usePartsStore.getState().parts).toHaveLength(1);
  });

  it("exports through the real drawer flow and reports success", async () => {
    const user = userEvent.setup();
    await reachReviewByClickMode(user);
    await user.click(screen.getByRole("button", { name: /新增部位/ }));
    const canvas = screen.getByLabelText("部位画布");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    await screen.findByText("部位 1");
    await user.click(screen.getByRole("button", { name: "导出" }));
    await screen.findByText("导出部位包");
    expect(screen.getByText("将导出 1 个部位 PNG")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "生成并下载" }));
    await screen.findByText(/导出完成/);
    expect(screen.getByText("`parts.zip` 已生成。")).toBeTruthy();
    expect(characterMock.client?.exportParts).toHaveBeenCalledTimes(1);
    expect((characterMock.client?.exportParts.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
      names: [{ fileName: "part_000" }],
    });
  });

  it("returns to W1 and clears parts and undo history via the new-file confirmation", async () => {
    const user = userEvent.setup();
    await reachReviewByClickMode(user);
    await user.click(screen.getByRole("button", { name: /新增部位/ }));
    const canvas = screen.getByLabelText("部位画布");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    await screen.findByText("部位 1");
    await user.click(screen.getByRole("button", { name: "换一张图" }));
    await screen.findByText("换一张图？");
    await user.click(screen.getByRole("button", { name: "换图" }));
    await screen.findByText("拖入透明人物立绘");
    expect(usePartsStore.getState().parts).toHaveLength(0);
    expect(usePartsStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("clears parts only after the switch is confirmed (App shell)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "拆部位" }));
    await uploadFile();
    await user.click(await screen.findByText("使用点击模式"));
    await screen.findByText("审校部位");
    await user.click(screen.getByRole("button", { name: /新增部位/ }));
    const canvas = screen.getByLabelText("部位画布");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    await screen.findByText("部位 1");
    // 确认切换 → 回到切帧工作区；再切回来时 v3 会话已整体清空。
    await user.click(screen.getByRole("button", { name: "切帧" }));
    await user.click(await screen.findByRole("button", { name: "切换" }));
    expect(screen.getByText("把透明精灵表变成引擎素材")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "拆部位" }));
    // 确认切换已清空 v3 会话：回到 W1 上传空状态，部位数为 0。
    expect(screen.getByText("拖入透明人物立绘")).toBeTruthy();
    expect(usePartsStore.getState().parts).toHaveLength(0);
  });
});
