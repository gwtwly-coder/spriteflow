// W3 部位画布视口 fit 单测（RC 2026-09-30 P1 缺陷 2：初次进入视口间歇性未适配，
// 实测 -4% 缩放 / (-3057,-11744) 平移，图片整张在屏外）。根因是挂载 effect 在
// 画布容器尚未布局（0×0）时照写 min((0-48)/w,…) 的垃圾视口且永不自愈；修复为
// computeFitViewport 纯函数守卫 + 布局就绪后（resize 首帧/后续渲染）幂等补一次。

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
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
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
