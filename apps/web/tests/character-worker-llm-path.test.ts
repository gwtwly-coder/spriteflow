// Worker 路径 BYOK 语义定位回归（2026-10-01 RC 走查 P1 双缺陷）。
//
// 链路全部真实，仅全局 fetch 换成假实现（worker 模块与测试同 realm，
// createFetchLlmTransport 的闭包在调用时解析全局 fetch——真 fetchTransport
// 的请求组装/JSON 序列化/响应读取全程参与）：
//   createCharacterClient（真 Comlink wrap）
//     → endpointPair 结构化克隆边界（真 expose/wrap 往返）
//       → character.worker.ts 真 run()（buildLlmImage → segmentSemantically
//         → locatePartsWithLlm → buildChatRequest → createFetchLlmTransport
//         全部真实）
//         → 假 fetch（最小 Response 形状：status/headers/body 流）
//
// 断言五件事：
//   ① Worker 路径确实发出请求（假 fetch 收到完整 POST 形状）；
//   ② 配置对象跨 Comlink 后字段完整（endpoint/Authorization Bearer key/
//     body.model/max_tokens/response_format/messages 一字不差）；
//   ③ glm-4v-flash 的 max_tokens 夹到服务商实测上限 1024（z.ai 400/1210
//     实测 [1,1024]），未知模型用契约上限 4096（与 buildLlmConfig 同一
//     接线 maxOutputTokensForModel）；
//   ④ 400 类请求拒绝 → LLM_CONFIGURATION_INVALID → llmFailure "unauthorized"
//     （绝不网络类；z.ai 对超限 max_tokens 的 400/1210 实测 <1s）；
//   ⑤ finish_reason=length 截断两次 → 恰好两次请求（初始+修复，修复不带图）
//     → LLM_INVALID_RESPONSE → llmFailure "bad_response"。

import type { CharacterProgressEvent } from "@spriteflow/segment";
import { expose } from "comlink";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maxOutputTokensForModel } from "../src/character/byok";
import { type CharacterClient, createCharacterClient } from "../src/character/character-client";
import type { CharacterRunOutput } from "../src/character/character-protocol";

// --- 假 fetch（每个用例注入脚本；worker 的真 transport 调用它） ----------------------

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyJson: string;
  body: {
    model: string;
    temperature: number;
    max_tokens: number;
    response_format: { type: string };
    messages: Array<{ role: string; content: unknown }>;
  };
}

interface ScriptedStep {
  status: number;
  bodyText: string;
}

const captured: CapturedRequest[] = [];
const realFetch = globalThis.fetch;

function installFetchScript(script: ScriptedStep[]): void {
  let call = 0;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const step = script[call++];
    if (step === undefined) {
      return Promise.reject(new Error(`unexpected fetch call #${call}`));
    }
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const bodyJson = String(init?.body ?? "");
    captured.push({
      url: String(url),
      method: String(init?.method),
      headers,
      bodyJson,
      body: JSON.parse(bodyJson) as CapturedRequest["body"],
    });
    // 最小 Response 形状：fetchTransport 只读 status/headers.get/body.getReader。
    const bytes = new TextEncoder().encode(step.bodyText);
    let served = false;
    return Promise.resolve({
      status: step.status,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => {
            if (served) return { done: true, value: undefined };
            served = true;
            return { done: false, value: bytes };
          },
        }),
      },
    } as unknown as Response);
  }) as typeof fetch;
}

// worker api 的动态导入在 fetch 脚本安装之后按需进行（fetch 在调用时才解析）。
const { api } = await import("../src/workers/character.worker");

// --- jsdom 缺失的 Worker API 桩 ---------------------------------------------------

class FakeImageData {
  constructor(
    public readonly data: Uint8ClampedArray,
    public readonly width: number,
    public readonly height: number,
  ) {}
}
class FakeCanvasContext {
  drawImage(): void {}
  putImageData(): void {}
  getImageData(_x: number, _y: number, width: number, height: number) {
    return { data: new Uint8ClampedArray(width * height * 4) };
  }
}
class FakeOffscreenCanvas {
  constructor(
    public readonly width: number,
    public readonly height: number,
  ) {}
  getContext(): FakeCanvasContext {
    return new FakeCanvasContext();
  }
  async convertToBlob(options?: { type?: string }): Promise<Blob> {
    return new Blob(["cGFja2VkLWltYWdl"], { type: options?.type ?? "image/png" });
  }
}
if (typeof globalThis.OffscreenCanvas === "undefined") {
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    configurable: true,
    value: FakeOffscreenCanvas,
  });
}
if (typeof globalThis.ImageData === "undefined") {
  Object.defineProperty(globalThis, "ImageData", {
    configurable: true,
    value: FakeImageData,
  });
}
if (typeof globalThis.createImageBitmap === "undefined") {
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: 8, height: 8, close(): void {} }),
  });
}

// --- Comlink 端点对（镜像 character-client.test.ts 的结构化克隆仿真） ---------------

function cloneError(): Error {
  const error = new Error("function could not be cloned");
  error.name = "DataCloneError";
  return error;
}
function assertCloneable(value: unknown, transfers: readonly object[], seen: Set<object>): void {
  if (typeof value === "function") throw cloneError();
  if (value === null || typeof value !== "object") return;
  if (transfers.includes(value) || seen.has(value)) return;
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
}
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

// --- 用例夹具 -----------------------------------------------------------------------

/** Chat Completions 信封（choices[0].message.content 承载模型输出）。 */
function envelope(content: string, finishReason: string): string {
  return JSON.stringify({
    id: "chatcmpl-test",
    choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content } }],
    usage: { total_tokens: 42 },
  });
}

const VALID_DOCUMENT = JSON.stringify({
  schemaVersion: "spriteflow-parts/1",
  coordinateSpace: "working-pixels-top-left-half-open",
  humanoid: { isHumanoid: false, confidence: 0.97, reason: "non-humanoid" },
  parts: [
    {
      kind: "hair",
      name: "hair",
      box: { x: 1, y: 1, width: 4, height: 4 },
      confidence: 0.9,
      occluded: false,
    },
  ],
});

/** 与 PartsWorkspace.buildLlmConfig 相同的接线（含 maxOutputTokensForModel）。 */
function llmConfig(model: string) {
  return {
    endpoint: "http://localhost:8787/chat/completions",
    model,
    apiKey: "zai-key-unit-test",
    timeoutMs: 60_000,
    maxResponseBytes: 1_048_576,
    maxOutputTokens: maxOutputTokensForModel(model),
  };
}

async function connectedClient(): Promise<CharacterClient> {
  const [workerSide, mainSide] = endpointPair();
  expose(api, workerSide as unknown as Parameters<typeof expose>[1]);
  const client = createCharacterClient(mainSide as unknown as Worker);
  const load = await client.load({
    ref: { assetId: "worker-path-test", revision: 1 },
    name: "hero.png",
    mime: "image/png",
    bytes: new ArrayBuffer(8),
    resizeTo: { width: 8, height: 8 },
  });
  if (!load.ok) throw new Error(`load failed: ${JSON.stringify(load.error)}`);
  return client;
}

async function runSemantic(client: CharacterClient, model: string): Promise<CharacterRunOutput> {
  return client.run(
    { llm: llmConfig(model), consent: true },
    (_event: CharacterProgressEvent) => {},
  );
}

function flushMacrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
}

beforeEach(() => {
  captured.length = 0;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("character worker BYOK semantic path (real Comlink round-trip, fake fetch)", () => {
  it("emits the chat request from the Worker with every config field intact across Comlink", async () => {
    const client = await connectedClient();
    installFetchScript([{ status: 200, bodyText: envelope(VALID_DOCUMENT, "stop") }]);
    const output = await runSemantic(client, "glm-4v-flash");
    await flushMacrotasks();

    // ① Worker 路径确实发出了请求（恰好一次，经真 fetchTransport 组装）
    expect(captured).toHaveLength(1);
    const request = captured[0];
    if (!request) throw new Error("no request captured");
    expect(request.url).toBe("http://localhost:8787/chat/completions");
    expect(request.method).toBe("POST");
    // ② 配置字段跨 Comlink 后一字不差
    expect(request.headers.Authorization).toBe("Bearer zai-key-unit-test");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(request.body.model).toBe("glm-4v-flash");
    expect(request.body.temperature).toBe(0);
    expect(request.body.response_format).toEqual({ type: "json_object" });
    // ③ glm-4v-flash 夹到服务商实测上限（z.ai 400/1210 上限 [1,1024]）
    expect(request.body.max_tokens).toBe(1_024);
    expect(request.body.messages).toHaveLength(2);
    expect(request.body.messages[0]?.role).toBe("system");
    const userContent = request.body.messages[1]?.content;
    expect(JSON.stringify(userContent)).toContain("data:image/png;base64,");
    // 非 humanoid 文档 → 诚实降级（run 成功返回，SAM 未介入）
    expect(output.ok).toBe(true);
    if (output.ok && output.result) {
      expect(output.result.mode).toBe("click");
      expect(output.result.degraded?.reason).toBe("NON_HUMANOID");
    }
  });

  it("uses the contract ceiling 4096 for models without a known provider cap", async () => {
    const client = await connectedClient();
    installFetchScript([{ status: 200, bodyText: envelope(VALID_DOCUMENT, "stop") }]);
    await runSemantic(client, "glm-4v");
    await flushMacrotasks();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.body.max_tokens).toBe(4_096);
  });

  it("classifies a provider 400 (max_tokens over the model cap) as configuration failure, never network", async () => {
    const client = await connectedClient();
    // 2026-10-01 实测形状：z.ai glm-4v-flash 对 max_tokens>1024 回 400 code 1210（<1s）。
    installFetchScript([
      {
        status: 400,
        bodyText: JSON.stringify({
          error: {
            code: "1210",
            message: "The max_tokens parameter is illegal.：限制数值范围[1,1024]",
          },
        }),
      },
    ]);
    const output = await runSemantic(client, "glm-4v-flash");
    await flushMacrotasks();

    expect(captured).toHaveLength(1); // 拒绝不进修复路径
    expect(output.ok).toBe(true); // LLM 失败 → 诚实降级到点击模式
    if (output.ok && output.result) {
      expect(output.result.degraded?.reason).toBe("LLM_FAILED");
    }
    // 权威错误码经降级透传 → 四分类为 key/配置类，绝不网络类
    expect(output.llmFailure).toBe("unauthorized");
    expect(output.llmFailure).not.toBe("network");
  });

  it("runs exactly one repair for a finish_reason=length truncated reply and classifies INVALID_RESPONSE when it stays truncated", async () => {
    const client = await connectedClient();
    const truncated = `${VALID_DOCUMENT.slice(0, 180)},"confi`;
    installFetchScript([
      { status: 200, bodyText: envelope(truncated, "length") },
      { status: 200, bodyText: envelope(truncated, "length") },
    ]);
    const output = await runSemantic(client, "glm-4v-flash");
    await flushMacrotasks();

    // 初始 + 一次修复，无第三次
    expect(captured).toHaveLength(2);
    // 修复请求不带图像（契约 :420），并点名 token 截断
    const repairContent = captured[1]?.body.messages[1]?.content;
    expect(typeof repairContent).toBe("string");
    expect(repairContent).toContain("finish_reason=length");
    expect(JSON.stringify(captured[1]?.body.messages)).not.toContain("data:image/png");
    expect(captured[1]?.body.max_tokens).toBe(1_024); // 契约 :420 保留 token 上限
    // 两次都非法 → LLM_INVALID_RESPONSE → bad_response（诚实归类，绝不网络类）
    expect(output.llmFailure).toBe("bad_response");
    if (output.ok && output.result) {
      expect(output.result.degraded?.reason).toBe("LLM_FAILED");
    }
  });
});
