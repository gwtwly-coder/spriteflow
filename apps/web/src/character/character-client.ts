// Character Worker 主线程客户端（镜像 M1 createPipelineClient 的 Comlink 接线模式）。
// 单例惰性创建；submit 包装进度回调代理与取消；dispose 终止 Worker。
// 回调必须经 Comlink.proxy 包装后作为【独立实参】传给 Worker 方法：裸函数无法
// structured clone（postMessage 同步抛 DataCloneError，消息根本不出主线程），
// 嵌在 input 对象里的 proxy 标记也不会被 Comlink 展开——两种形态都会让 Worker
// 侧永久"进行中"（2026-09-30 RC P1：点击模式卡死在模型下载的根因）。

import type { CharacterProgressEvent } from "@spriteflow/segment";
import { proxy, wrap } from "comlink";
import type {
  CharacterExportInput,
  CharacterExportOutput,
  CharacterLoadInput,
  CharacterLoadOutput,
  CharacterPrepareInput,
  CharacterPrepareOutput,
  CharacterProgressCallback,
  CharacterRefineInput,
  CharacterRefineOutput,
  CharacterRunInput,
  CharacterRunOutput,
  CharacterWorkerApi,
} from "./character-protocol";

export interface CharacterClient {
  load(input: CharacterLoadInput): Promise<CharacterLoadOutput>;
  run(input: CharacterRunInput, onProgress: CharacterProgressCallback): Promise<CharacterRunOutput>;
  prepare(
    input: CharacterPrepareInput,
    onProgress: CharacterProgressCallback,
  ): Promise<CharacterPrepareOutput>;
  refine(input: CharacterRefineInput): Promise<CharacterRefineOutput>;
  exportParts(
    input: CharacterExportInput,
    onProgress: CharacterProgressCallback,
  ): Promise<CharacterExportOutput>;
  cancel(): void;
  modelBytes(): Promise<number>;
  dispose(): Promise<void>;
}

export function createCharacterClient(worker: Worker): CharacterClient {
  const remote = wrap<CharacterWorkerApi>(worker);
  // 每次 submit 用一层薄回调转发（镜像 pipeline client）：不污染调用方的函数
  // 引用，代理生命周期由 Comlink 的 FinalizationRegistry 管理。
  const progressProxy = (onProgress: CharacterProgressCallback) =>
    proxy((event: CharacterProgressEvent) => {
      onProgress(event);
    });
  return {
    load: (input) => remote.load(input),
    run: (input, onProgress) => remote.run(input, progressProxy(onProgress)),
    prepare: (input, onProgress) => remote.prepare(input, progressProxy(onProgress)),
    refine: (input) => remote.refine(input),
    exportParts: (input, onProgress) => remote.exportParts(input, progressProxy(onProgress)),
    cancel: () => {
      void remote.cancel();
    },
    modelBytes: async () => remote.modelBytes(),
    dispose: async () => {
      await remote.dispose();
      worker.terminate();
    },
  };
}

let singleton: CharacterClient | null = null;

/** 惰性单例：首次使用时创建 Worker（模块级 URL 由 Vite 处理）。 */
export function getCharacterClient(): CharacterClient {
  if (singleton) return singleton;
  const worker = new Worker(new URL("../workers/character.worker.ts", import.meta.url), {
    type: "module",
  });
  singleton = createCharacterClient(worker);
  return singleton;
}

/** 测试与工作区切换后的重置入口。 */
export async function resetCharacterClient(): Promise<void> {
  if (!singleton) return;
  const current = singleton;
  singleton = null;
  await current.dispose();
}
