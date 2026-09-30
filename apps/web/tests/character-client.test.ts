// P1 回归（2026-09-30 真浏览器挂死）：Character Worker 的进度回调必须经
// Comlink.proxy 跨线程。修复前 character-client 把裸函数塞进 remote.prepare(...)
// —— 函数无法 structured clone，postMessage 在主线程同步抛 DataCloneError，
// 消息根本到不了 Worker：下载从未开始（Cache API 恒空）、进度事件从未发出、
// UI 永久停在"正在下载本地模型（76 MB）+ 0%"的假进行中。
//
// 本测试搭出真实的 Comlink expose/wrap 往返：一端 expose 假 CharacterWorkerApi，
// 另一端跑 createCharacterClient。端点仿真结构化克隆边界（函数必抛
// DataCloneError、transfer 对象按引用传递），jsdom 没有 MessageChannel 时用
// 最小 ponyfill 顶上（Comlink 的 proxy transfer handler 内部要 new MessageChannel）。

import type { CharacterProgressEvent } from "@spriteflow/segment";
import { CharacterStage } from "@spriteflow/segment";
import { expose } from "comlink";
import { describe, expect, it } from "vitest";
import { type CharacterClient, createCharacterClient } from "../src/character/character-client";

// --- 结构化克隆边界仿真 -----------------------------------------------------------

function cloneError(): Error {
  const error = new Error("function could not be cloned");
  error.name = "DataCloneError";
  return error;
}

/** 深走线消息：函数不可克隆（真正的 postMessage 会抛 DataCloneError）；transfer 列表内的对象按引用传递，不克隆。 */
function assertCloneable(value: unknown, transfers: readonly object[], seen: Set<object>): void {
  if (typeof value === "function") throw cloneError();
  if (value === null || typeof value !== "object") return;
  if (transfers.includes(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertCloneable(item, transfers, seen);
    return;
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
  for (const item of Object.values(value as Record<string, unknown>)) {
    assertCloneable(item, transfers, seen);
  }
}

interface FakeEndpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: string, listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: string, listener: (event: { data: unknown }) => void): void;
  terminate(): void;
}

/** MessageChannel 形状的一对端点：postMessage 经克隆校验后异步投递到对端监听者。 */
function endpointPair(): [FakeEndpoint, FakeEndpoint] {
  const listenersA = new Set<(event: { data: unknown }) => void>();
  const listenersB = new Set<(event: { data: unknown }) => void>();
  const makeSide = (
    local: Set<(event: { data: unknown }) => void>,
    remote: Set<(event: { data: unknown }) => void>,
  ): FakeEndpoint => ({
    postMessage(message, transfer) {
      assertCloneable(message, transfer ?? [], new Set());
      const targets = [...remote];
      queueMicrotask(() => {
        for (const listener of targets) listener({ data: message });
      });
    },
    addEventListener: (_type, listener) => local.add(listener),
    removeEventListener: (_type, listener) => local.delete(listener),
    terminate: () => {},
  });
  return [makeSide(listenersA, listenersB), makeSide(listenersB, listenersA)];
}

// jsdom 没有 MessageChannel；Comlink 的 proxy 序列化内部需要它。
if (typeof globalThis.MessageChannel === "undefined") {
  class PonyPort {
    peer: PonyPort | null = null;
    private readonly listeners = new Set<(event: { data: unknown }) => void>();
    postMessage(message: unknown): void {
      const peer = this.peer;
      queueMicrotask(() => {
        for (const listener of [...(peer?.listeners ?? [])]) listener({ data: message });
      });
    }
    addEventListener(_type: string, listener: (event: { data: unknown }) => void): void {
      this.listeners.add(listener);
    }
    removeEventListener(_type: string, listener: (event: { data: unknown }) => void): void {
      this.listeners.delete(listener);
    }
    start(): void {}
  }
  const factory = function MessageChannelPony() {
    const port1 = new PonyPort();
    const port2 = new PonyPort();
    port1.peer = port2;
    port2.peer = port1;
    return { port1, port2 };
  };
  Object.defineProperty(globalThis, "MessageChannel", {
    value: factory as unknown as abstract new () => MessageChannel,
    configurable: true,
  });
}

// --- Worker 侧假 API ---------------------------------------------------------------

let progressSequence = 0;
function downloadEvent(): CharacterProgressEvent {
  progressSequence += 1;
  return {
    protocolVersion: 1,
    taskId: "client-test",
    stage: CharacterStage.ModelDownload,
    stageProgress: 0.5,
    overallProgress: 0.5,
    completedUnits: progressSequence,
    totalUnits: 76_000_000,
    cancellable: true,
  };
}

/** 假 CharacterWorkerApi：每个带 onProgress 的入口都真实回调两次再成功返回。 */
function fakeWorkerApi() {
  return {
    async load() {
      return { ok: true };
    },
    async run(
      _input: { llm: null; consent: boolean },
      onProgress: (event: CharacterProgressEvent) => void,
    ) {
      onProgress(downloadEvent());
      onProgress(downloadEvent());
      return { ok: true };
    },
    async prepare(
      _input: Record<string, never>,
      onProgress: (event: CharacterProgressEvent) => void,
    ) {
      onProgress(downloadEvent());
      onProgress(downloadEvent());
      return { ok: true, provider: "wasm", cachedModel: false, webgpuFallback: true };
    },
    async refine() {
      return { ok: true };
    },
    async exportParts(
      _input: { parts: unknown[]; names: unknown[] },
      onProgress: (event: CharacterProgressEvent) => void,
    ) {
      onProgress(downloadEvent());
      return { ok: true };
    },
    cancel(): void {},
    modelBytes(): number {
      return 76_068_699;
    },
    async dispose() {},
  };
}

function connectedClient(): { client: CharacterClient; worker: FakeEndpoint } {
  const [workerSide, mainSide] = endpointPair();
  expose(fakeWorkerApi(), workerSide as unknown as Parameters<typeof expose>[1]);
  return { client: createCharacterClient(mainSide as unknown as Worker), worker: mainSide };
}

/**
 * 回调代理若走真实 MessagePort（Node 全局存在 MessageChannel），事件投递发生在
 * 事件循环任务上而非微任务；等一个宏任务拍子再断言。
 */
function flushMacrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
}

// --- 回归断言 ----------------------------------------------------------------------

describe("createCharacterClient progress callback marshalling", () => {
  it("delivers prepare() progress events across the Comlink boundary", async () => {
    const { client } = connectedClient();
    const events: CharacterProgressEvent[] = [];
    const output = await client.prepare({}, (event) => events.push(event));
    await flushMacrotasks();
    expect(output.ok).toBe(true);
    expect(output.provider).toBe("wasm");
    expect(events.length).toBe(2);
    expect(events[0]?.stage).toBe(CharacterStage.ModelDownload);
  });

  it("delivers run() and exportParts() progress events the same way", async () => {
    const { client } = connectedClient();
    const runEvents: CharacterProgressEvent[] = [];
    const runOutput = await client.run({ llm: null, consent: false }, (event) =>
      runEvents.push(event),
    );
    await flushMacrotasks();
    expect(runOutput.ok).toBe(true);
    expect(runEvents.length).toBe(2);
    const exportEvents: CharacterProgressEvent[] = [];
    const exportOutput = await client.exportParts({ parts: [], names: [] }, (event) =>
      exportEvents.push(event),
    );
    await flushMacrotasks();
    expect(exportOutput.ok).toBe(true);
    expect(exportEvents.length).toBe(1);
    await client.dispose();
  });

  it("rejects raw function callbacks at the cloning boundary (pre-fix behavior guard)", () => {
    // 修复前的发送形态：裸函数直接进消息体（无论作为独立实参还是嵌在 input 里）。
    // 边界必须抛 DataCloneError——这个断言保证仿真边界与真浏览器 postMessage 的
    // 克隆规则一致，上面两个往返测试因此确实能抓住"回调未 proxy"回归。
    const [workerSide] = endpointPair();
    expect(() => workerSide.postMessage({ value: { nested: () => {} } }, [])).toThrow(/cloned/);
  });
});
