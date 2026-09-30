// Character Worker 主线程客户端（镜像 M1 createPipelineClient 的 Comlink 接线模式）。
// 单例惰性创建；submit 包装进度回调代理与取消；dispose 终止 Worker。
import { wrap } from "comlink";
import type {
  CharacterExportInput,
  CharacterExportOutput,
  CharacterLoadInput,
  CharacterLoadOutput,
  CharacterPrepareInput,
  CharacterPrepareOutput,
  CharacterRefineInput,
  CharacterRefineOutput,
  CharacterRunInput,
  CharacterRunOutput,
  CharacterWorkerApi,
} from "./character-protocol";

export interface CharacterClient {
  load(input: CharacterLoadInput): Promise<CharacterLoadOutput>;
  run(
    input: Omit<CharacterRunInput, "onProgress">,
    onProgress: CharacterRunInput["onProgress"],
  ): Promise<CharacterRunOutput>;
  prepare(
    input: Omit<CharacterPrepareInput, "onProgress">,
    onProgress: CharacterPrepareInput["onProgress"],
  ): Promise<CharacterPrepareOutput>;
  refine(input: CharacterRefineInput): Promise<CharacterRefineOutput>;
  exportParts(
    input: Omit<CharacterExportInput, "onProgress">,
    onProgress: CharacterExportInput["onProgress"],
  ): Promise<CharacterExportOutput>;
  cancel(): void;
  modelBytes(): Promise<number>;
  dispose(): Promise<void>;
}

export function createCharacterClient(worker: Worker): CharacterClient {
  const remote = wrap<CharacterWorkerApi>(worker);
  return {
    load: (input) => remote.load(input),
    run: (input, onProgress) => remote.run({ ...input, onProgress }),
    prepare: (input, onProgress) => remote.prepare({ ...input, onProgress }),
    refine: (input) => remote.refine(input),
    exportParts: (input, onProgress) => remote.exportParts({ ...input, onProgress }),
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
