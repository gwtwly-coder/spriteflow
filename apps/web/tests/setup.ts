import "@testing-library/dom";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => null,
});

// jsdom 没有 PointerEvent 构造器：fireEvent.pointer* 会回退到 new Event(type, init)，
// Event 构造器丢弃 init 里的 clientX/clientY——画布点击测试拿到的坐标全是 NaN
//（RC P1-1 选中路径测试踩中：partAtPoint(NaN) 必落空）。用 MouseEvent 派生类补上，
// 坐标语义与真实 PointerEvent 一致。
class PointerEventMock extends MouseEvent {}
if (typeof globalThis.PointerEvent === "undefined") {
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    value: PointerEventMock,
    writable: true,
  });
}

class ResizeObserverMock {
  disconnect() {}
  observe() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock,
});
