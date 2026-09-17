import { proxy, releaseProxy, transfer, wrap } from "comlink";
import { CONTRACT_VERSION, DESKTOP_LIMITS } from "../defaults.js";
import { error, Failure, uniqueId } from "../runtime/execution.js";
import type {
  CancelResult,
  Command,
  CommandPayloads,
  InitOptions,
  Outcome,
  PipelineClient,
  PipelineError,
  PipelineWorkerApi,
  ProgressEvent,
  TaskRequest,
  TaskResponse,
  WorkerCapabilities,
} from "../types.js";
import { PipelineErrorCode as Code } from "../types.js";
import { initOptions, request as validateRequest } from "./requests.js";

export function createPipelineClient(
  worker: Worker,
  options: InitOptions = { protocolVersion: 1, limits: { ...DESKTOP_LIMITS } },
): PipelineClient {
  const remote = wrap<PipelineWorkerApi>(worker);
  let stopped = false,
    disposed = false;
  const pending = new Map<
    string,
    {
      command: Command;
      settle(response: TaskResponse): void;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();
  const completed: string[] = [];
  let failReady: (result: Outcome<WorkerCapabilities>) => void = () => {};
  const readyFailure = new Promise<Outcome<WorkerCapabilities>>((resolve) => {
    failReady = resolve;
  });
  function failure(taskId: string, command: Command, problem: PipelineError): TaskResponse {
    return {
      protocolVersion: 1,
      taskId,
      command,
      outcome: { ok: false, error: problem },
    } as TaskResponse;
  }
  function settle(taskId: string, response: TaskResponse): void {
    const item = pending.get(taskId);
    if (!item) return;
    if (item.timer !== null) clearTimeout(item.timer);
    pending.delete(taskId);
    completed.push(taskId);
    if (completed.length > 128) completed.shift();
    item.settle(response);
  }
  function stop(cancelled: string | null = null): void {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    failReady({ ok: false, error: error(Code.WorkerCrashed) });
    for (const [id, item] of pending)
      settle(
        id,
        failure(id, item.command, error(id === cancelled ? Code.Cancelled : Code.WorkerCrashed)),
      );
    worker.removeEventListener("error", crashed);
    worker.removeEventListener("messageerror", crashed);
    try {
      remote[releaseProxy]();
    } catch {
      /* Endpoint is already terminated. */
    }
  }
  function crashed(): void {
    stop();
  }
  worker.addEventListener("error", crashed);
  worker.addEventListener("messageerror", crashed);
  const initialize = (async (): Promise<Outcome<WorkerCapabilities>> => {
    try {
      initOptions(options);
      const result = await remote.init(options);
      if (
        result.ok &&
        (result.value.protocolVersion !== 1 || result.value.contractVersion !== CONTRACT_VERSION)
      )
        return { ok: false, error: error(Code.ProtocolMismatch) };
      return result;
    } catch (caught) {
      return {
        ok: false,
        error: caught instanceof Failure ? caught.error : error(Code.WorkerCrashed),
      };
    }
  })();
  const ready = Promise.race([initialize, readyFailure]);
  let disposal: Promise<void> | null = null;
  return {
    ready,
    submit<K extends Command>(
      command: K,
      payload: CommandPayloads[K],
      onProgress?: (event: ProgressEvent) => void,
    ) {
      const taskId = uniqueId("task");
      let resolveResult!: (response: TaskResponse<K>) => void;
      const result = new Promise<TaskResponse<K>>((resolve) => {
        resolveResult = resolve;
      });
      const request = { protocolVersion: 1, taskId, command, payload } as TaskRequest<K>;
      let cancelRequested = false,
        dispatched = false;
      const entry = {
        command,
        settle: (response: TaskResponse) => resolveResult(response as TaskResponse<K>),
        timer: null as ReturnType<typeof setTimeout> | null,
      };
      pending.set(taskId, entry);
      const cancel = async (): Promise<CancelResult> => {
        if (!pending.has(taskId))
          return { taskId, status: completed.includes(taskId) ? "already-finished" : "unknown" };
        cancelRequested = true;
        if (!dispatched) {
          settle(taskId, failure(taskId, command, error(Code.Cancelled)));
          return { taskId, status: "requested" };
        }
        if (entry.timer === null) entry.timer = setTimeout(() => stop(taskId), 2000);
        try {
          return await Promise.race([
            remote.cancel(taskId),
            result.then(() => ({ taskId, status: "already-finished" as const })),
          ]);
        } catch {
          stop(taskId);
          return { taskId, status: "requested" };
        }
      };
      void (async () => {
        if (disposed || stopped) {
          settle(taskId, failure(taskId, command, error(Code.WorkerUnavailable)));
          return;
        }
        try {
          validateRequest(request as TaskRequest, options.limits);
          const initialized = await ready;
          if (!pending.has(taskId)) return;
          if (!initialized.ok) {
            settle(taskId, failure(taskId, command, initialized.error));
            return;
          }
          if (cancelRequested) {
            settle(taskId, failure(taskId, command, error(Code.Cancelled)));
            return;
          }
          const buffers: Transferable[] = [];
          if (request.command === "load") {
            const load = (request as TaskRequest<"load">).payload;
            buffers.push(
              load.kind === "encoded" ? load.bytes : (load.asset.pixels.data.buffer as ArrayBuffer),
            );
          }
          dispatched = true;
          const callback = proxy((event: ProgressEvent) => {
            if (!pending.has(taskId) || event.taskId !== taskId || event.protocolVersion !== 1)
              return;
            try {
              onProgress?.(event);
            } catch {
              /* Consumer observers cannot fail a task. */
            }
          });
          const response = await remote.execute(
            transfer(request as TaskRequest, buffers),
            callback,
          );
          if (
            response.taskId !== taskId ||
            response.command !== command ||
            response.protocolVersion !== 1
          ) {
            settle(taskId, failure(taskId, command, error(Code.ProtocolMismatch)));
            return;
          }
          settle(taskId, response as TaskResponse);
        } catch (caught) {
          if (caught instanceof Failure) settle(taskId, failure(taskId, command, caught.error));
          else stop();
        }
      })();
      return { taskId, result, cancel };
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      disposal = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            remote.dispose(),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, 2000);
            }),
          ]);
        } catch {
          /* Disposal still settles every local promise. */
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          stop();
        }
      })();
      return disposal;
    },
  };
}
