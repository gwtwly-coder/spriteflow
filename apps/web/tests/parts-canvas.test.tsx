// W3 部位画布视口 fit 单测（RC 2026-09-30 P1 缺陷 2：初次进入视口间歇性未适配，
// 实测 -4% 缩放 / (-3057,-11744) 平移，图片整张在屏外）。根因是挂载 effect 在
// 画布容器尚未布局（0×0）时照写 min((0-48)/w,…) 的垃圾视口且永不自愈；修复为
// computeFitViewport 纯函数守卫 + 布局就绪后（resize 首帧/后续渲染）幂等补一次。
// 另：paint 的画布尺寸 0 高守卫（RC 真浏览器复验：重载后重进 W3，canvas.height
// 恒 0——布局中途宽已定高未结算时 0 被写死且此后无重绘）。

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeFitViewport, PartsCanvas } from "../src/character/PartsCanvas";
import { usePartsStore } from "../src/character/parts-store";

// 可控 ResizeObserver：把观察回调登记进数组，测试手动派发（模拟"布局稍后才就绪"）。
const resizeCallbacks: ResizeObserverCallback[] = [];
class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }
  observe(): void {}
  disconnect(): void {}
}
const fireResize = () => {
  for (const callback of [...resizeCallbacks]) callback([], {} as ResizeObserver);
};

// 可控 rAF 队列（jsdom 非 pretendToBeVisual 时无原生 rAF）：flushRaf = 推进一帧。
const rafQueue: FrameRequestCallback[] = [];
const rafCancels: number[] = [];
const flushRaf = () => {
  const queue = [...rafQueue];
  rafQueue.length = 0;
  for (const callback of queue) callback(16);
};

const getCanvas = () => {
  const canvas = document.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas not mounted");
  return canvas;
};

const renderCanvas = () =>
  render(
    <PartsCanvas
      preview={null}
      sourceSize={{ width: 2048, height: 1024 }}
      tool="select"
      busy={false}
      canvasLabel="部位画布"
      canvasBackground="#000"
      onImageClick={() => {}}
    />,
  );

/** 给已挂载的画布容器注入布局尺寸（jsdom 默认 clientWidth/Height = 0）。 */
const sizeHost = (width: number, height: number) => {
  const host = document.querySelector(".parts-canvas-host");
  if (!(host instanceof HTMLElement)) throw new Error("canvas host not mounted");
  Object.defineProperty(host, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(host, "clientHeight", { configurable: true, value: height });
};

// 2048×1024 工作图在 800×600 容器：zoom = min(752/2048, 552/1024) = 0.3671875，
// pan 居中 = ((800-752)/2, (600-376)/2) = (24, 112)。
const EXPECTED_ZOOM = 752 / 2048;

beforeEach(() => {
  resizeCallbacks.length = 0;
  rafQueue.length = 0;
  rafCancels.length = 0;
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    rafQueue.push(callback);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCancels.push(id);
  });
  usePartsStore.getState().resetAll();
  usePartsStore.temporal.getState().clear();
});

describe("computeFitViewport（纯函数）", () => {
  it("computes the centered fit for a working image inside a container", () => {
    expect(computeFitViewport({ width: 2048, height: 1024 }, { width: 800, height: 600 })).toEqual({
      zoom: EXPECTED_ZOOM,
      pan: { x: 24, y: 112 },
    });
  });

  it("returns null for unlayouted/invalid containers and sources instead of garbage", () => {
    expect(computeFitViewport({ width: 2048, height: 1024 }, { width: 0, height: 0 })).toBeNull();
    expect(
      computeFitViewport({ width: 2048, height: 1024 }, { width: 40, height: 600 }),
    ).toBeNull();
    expect(computeFitViewport({ width: 0, height: 1024 }, { width: 800, height: 600 })).toBeNull();
  });
});

describe("PartsCanvas 初始 fit", () => {
  it("does not write a garbage viewport when the host has no layout yet (RC repro)", () => {
    renderCanvas();
    expect(usePartsStore.getState().zoom).toBe(1);
    expect(usePartsStore.getState().pan).toEqual({ x: 0, y: 0 });
  });

  it("fits on mount when layout is already available", () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    try {
      renderCanvas();
      expect(usePartsStore.getState().zoom).toBeCloseTo(EXPECTED_ZOOM, 10);
      expect(usePartsStore.getState().pan.x).toBeCloseTo(24, 10);
      expect(usePartsStore.getState().pan.y).toBeCloseTo(112, 10);
    } finally {
      width.mockRestore();
      height.mockRestore();
    }
  });

  it("fits once layout arrives via the resize callback, then leaves the user viewport alone", () => {
    renderCanvas();
    sizeHost(800, 600);
    act(() => {
      fireResize();
    });
    expect(usePartsStore.getState().zoom).toBeCloseTo(EXPECTED_ZOOM, 10);
    expect(usePartsStore.getState().pan.x).toBeCloseTo(24, 10);
    expect(usePartsStore.getState().pan.y).toBeCloseTo(112, 10);
    // RO 回调同时补 paint：画布尺寸随有效宿主尺寸立即可见（jsdom dpr=1）。
    expect(getCanvas().width).toBe(800);
    expect(getCanvas().height).toBe(600);
    // 用户手动改视口后的窗口 resize 只重绘，不得重置（fit 幂等记账）。
    act(() => {
      usePartsStore.getState().setViewport(2, { x: -100, y: -50 });
    });
    act(() => {
      fireResize();
    });
    expect(usePartsStore.getState().zoom).toBe(2);
    expect(usePartsStore.getState().pan).toEqual({ x: -100, y: -50 });
  });
});

describe("画布尺寸 0 高守卫（RC P1：重载后重进 W3，canvas.height 恒 0）", () => {
  it("mid-layout 0 尺寸不写进 canvas，布局结算后经逐帧重试恢复有效尺寸", () => {
    renderCanvas();
    const canvas = getCanvas();
    // 挂载时宿主 0×0（布局中途）：不把 0 写进画布（保持默认 300×150），
    // 且已安排下一帧重试。
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
    expect(rafQueue.length).toBe(1);
    // 次帧宿主仍无布局：继续不写、自动续排重试。
    flushRaf();
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
    expect(rafQueue.length).toBe(1);
    // 布局结算（宽早于高到达的中间态已过）→ 下一帧 paint 写入有效尺寸。
    sizeHost(800, 600);
    flushRaf();
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    // 成功后不再有在途重试。
    expect(rafQueue.length).toBe(0);
  });

  it("width-settled/height-0 intermediate layout is never persisted either", () => {
    renderCanvas();
    const canvas = getCanvas();
    // RC 首见样本形态：宽已定（1098）、高未结算（0）——同样只重试不写入。
    sizeHost(1098, 0);
    flushRaf();
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
    expect(rafQueue.length).toBe(1);
  });

  it("cancels the pending retry on unmount", () => {
    const { unmount } = renderCanvas();
    expect(rafQueue.length).toBe(1);
    unmount();
    expect(rafCancels.length).toBe(1);
    expect(rafQueue.length).toBe(1); // 已登记的帧不再被消费
  });
});
