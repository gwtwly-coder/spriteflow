// biome-ignore-all lint/style/noNonNullAssertion: Asset and result cache guards precede access within the single-task service.
import { releaseProxy, transfer } from "comlink";
import { detect } from "../detection/detect.js";
import { exportAssets } from "../export/export.js";
import { alphaStats, resizePixels } from "../input/pixels.js";
import * as validate from "../input/validate.js";
import { normalizeFrames } from "../normalization/frames.js";
import { packFrames } from "../packing/pack.js";
import {
  checkpoint,
  createExecutionContext,
  error,
  Failure,
  fail,
  outcome,
  Progress,
  uniqueId,
} from "../runtime/execution.js";
import type {
  Command,
  CommandResults,
  InitOptions,
  InputAsset,
  Outcome,
  PipelineWorkerApi,
  ProgressEvent,
  StoredNormalizeResult,
  StoredPackResult,
  TaskRequest,
  TaskResponse,
  WorkerCapabilities,
} from "../types.js";
import { PipelineErrorCode as Code, ProgressStage as Stage } from "../types.js";
import { loadAsset, pngCodec, probe } from "./codec.js";
import { initOptions, request as validateRequest } from "./requests.js";

export function createWorkerService(): PipelineWorkerApi {
  let capabilities: WorkerCapabilities | null = null,
    config: InitOptions | null = null;
  let initialization: Promise<Outcome<WorkerCapabilities>> | null = null;
  let disposed = false,
    asset: InputAsset | null = null;
  let normalized: StoredNormalizeResult | null = null,
    packed: StoredPackResult | null = null;
  let current: { id: string; cancelled: boolean } | null = null;
  const finished: string[] = [];
  const service: PipelineWorkerApi = {
    async init(options) {
      try {
        if (disposed) fail(Code.WorkerUnavailable);
        initOptions(options);
        if (config) {
          if (
            Object.keys(config.limits).some(
              (key) =>
                config!.limits[key as keyof InitOptions["limits"]] !==
                options.limits[key as keyof typeof options.limits],
            )
          )
            validate.invalid("options");
          return initialization!;
        }
        config = structuredClone(options);
        initialization = (async () => {
          try {
            capabilities = await probe(options.limits);
            return { ok: true as const, value: structuredClone(capabilities) };
          } catch (caught) {
            return {
              ok: false as const,
              error: caught instanceof Failure ? caught.error : error(Code.WorkerUnavailable),
            };
          }
        })();
        return initialization;
      } catch (caught) {
        return {
          ok: false,
          error: caught instanceof Failure ? caught.error : error(Code.InternalError),
        };
      }
    },
    async execute<K extends Command>(
      request: TaskRequest<K>,
      onProgress: (event: ProgressEvent) => void,
    ): Promise<TaskResponse<K>> {
      const token = { id: request?.taskId, cancelled: false };
      let ownsTask = false;
      const respond = (result: Outcome<CommandResults[Command]>): TaskResponse<K> =>
        ({
          protocolVersion: 1,
          taskId: request.taskId,
          command: request.command,
          outcome: result,
        }) as TaskResponse<K>;
      try {
        if (disposed || !capabilities) fail(Code.WorkerUnavailable);
        if (current) fail(Code.Busy, Stage.Validate, { field: "task" });
        validateRequest(request as TaskRequest, capabilities.limits);
        current = token;
        ownsTask = true;
        const context = createExecutionContext(request.taskId, {
          limits: capabilities.limits,
          isCancelled: () => disposed || token.cancelled,
          onProgress,
        });
        const command = request as TaskRequest;
        const progress = new Progress(
          context,
          command.command === "load"
            ? command.payload.kind === "rgba"
              ? command.payload.asset.ref
              : command.payload.ref
            : command.payload.asset,
          command.command,
        );
        let result: Outcome<CommandResults[Command]>;
        if (command.command === "load") {
          if (asset) fail(Code.Busy, Stage.Validate, { field: "asset" });
          result = await outcome(progress, async () => {
            const loaded = await loadAsset(command.payload, capabilities!, context, progress);
            progress.report(Stage.Analyze);
            const alpha = await alphaStats(loaded.pixels, context);
            const preview = await resizePixels(loaded.pixels, 1024, context);
            await checkpoint(context, Stage.Analyze);
            asset = loaded;
            normalized = null;
            packed = null;
            return {
              asset: {
                ref: { ...loaded.ref },
                name: loaded.name,
                sourceMime: loaded.sourceMime,
                originalSize: { ...loaded.originalSize },
                workingSize: { width: loaded.pixels.width, height: loaded.pixels.height },
                scaleFromOriginal: { ...loaded.scaleFromOriginal },
                alpha,
              },
              preview,
            };
          });
        } else if (command.command === "release") {
          result = await outcome(progress, async () => {
            const released = asset !== null && validate.sameRef(asset.ref, command.payload.asset);
            if (released) {
              asset = null;
              normalized = null;
              packed = null;
            }
            return { released };
          });
        } else {
          if (!asset || !validate.sameRef(asset.ref, command.payload.asset))
            fail(Code.AssetNotFound);
          const input = asset;
          switch (command.command) {
            case "detect":
              result = await detect(input, command.payload.options, context);
              break;
            case "preview":
              result = await outcome(progress, async () => {
                const r = command.payload.sourceRect;
                if (r !== null) validate.rect(r, input.pixels, "payload.sourceRect");
                progress.report(Stage.Render);
                return resizePixels(
                  input.pixels,
                  command.payload.maxDimension,
                  context,
                  r ?? undefined,
                );
              });
              break;
            case "normalize": {
              const computed = await normalizeFrames(
                input,
                command.payload.drafts,
                command.payload.options,
                context,
              );
              if (computed.ok) {
                normalized = { ...computed.value, normalizationId: uniqueId("normalization") };
                packed = null;
                result = { ok: true, value: structuredClone(normalized) };
              } else result = computed;
              break;
            }
            case "pack": {
              if (!normalized || normalized.normalizationId !== command.payload.normalizationId)
                fail(Code.StaleResult);
              const computed = await packFrames(
                input.ref,
                normalized.frames,
                command.payload.options,
                context,
              );
              if (computed.ok) {
                packed = {
                  ...computed.value,
                  normalizationId: normalized.normalizationId,
                  packId: uniqueId("pack"),
                };
                result = { ok: true, value: structuredClone(packed) };
              } else result = computed;
              break;
            }
            case "export": {
              if (!normalized || normalized.normalizationId !== command.payload.normalizationId)
                fail(Code.StaleResult);
              if (
                command.payload.packId !== null &&
                (!packed ||
                  packed.packId !== command.payload.packId ||
                  packed.normalizationId !== normalized.normalizationId)
              )
                fail(Code.StaleResult);
              const storedPack = command.payload.packId !== null ? packed : null;
              const purePack = storedPack
                ? {
                    asset: storedPack.asset,
                    options: storedPack.options,
                    pages: storedPack.pages,
                    frames: storedPack.frames,
                    frameOrder: storedPack.frameOrder,
                    warnings: storedPack.warnings,
                  }
                : null;
              result = await exportAssets(
                { asset: input, frames: normalized.frames, pack: purePack },
                command.payload.task,
                pngCodec,
                context,
              );
              break;
            }
          }
        }
        const response = respond(result);
        if (result.ok) {
          if (command.command === "load")
            return transfer(response, [
              (result.value as CommandResults["load"]).preview.data.buffer as ArrayBuffer,
            ]);
          if (command.command === "preview")
            return transfer(response, [
              (result.value as CommandResults["preview"]).data.buffer as ArrayBuffer,
            ]);
          if (command.command === "export")
            return transfer(response, [(result.value as CommandResults["export"]).archive]);
        }
        return response;
      } catch (caught) {
        return respond({
          ok: false,
          error: caught instanceof Failure ? caught.error : error(Code.InternalError),
        });
      } finally {
        if (ownsTask) {
          current = null;
          finished.push(request.taskId);
          if (finished.length > 128) finished.shift();
        }
        try {
          const callback = onProgress as unknown as { [releaseProxy]?: () => void };
          callback[releaseProxy]?.();
        } catch {
          /* The caller may already have terminated the endpoint. */
        }
      }
    },
    async cancel(taskId) {
      if (current?.id === taskId) {
        current.cancelled = true;
        return { taskId, status: "requested" };
      }
      return { taskId, status: finished.includes(taskId) ? "already-finished" : "unknown" };
    },
    async dispose() {
      disposed = true;
      if (current) current.cancelled = true;
      asset = null;
      normalized = null;
      packed = null;
    },
  };
  return service;
}
