import { DESKTOP_LIMITS } from "../defaults.js";
import type {
  AssetRef,
  ExecutionContext,
  Outcome,
  PipelineError,
  RecoveryAction,
} from "../types.js";
import { PipelineErrorCode as Code, ProgressStage as Stage } from "../types.js";

const recoveries: Record<Code, RecoveryAction[]> = {
  INVALID_ARGUMENT: ["fix-options"],
  UNSUPPORTED_FORMAT: ["choose-file"],
  ANIMATED_INPUT_UNSUPPORTED: ["choose-file"],
  DECODE_FAILED: ["choose-file", "retry"],
  OPAQUE_INPUT: ["choose-file"],
  MEMORY_LIMIT: ["downsample", "choose-file"],
  DIMENSION_LIMIT: ["downsample", "choose-file"],
  ASSET_NOT_FOUND: ["restart-worker"],
  STALE_RESULT: ["retry"],
  REVIEW_REQUIRED: ["review"],
  NO_FRAMES: ["manual-edit"],
  FRAME_TOO_LARGE: ["repack"],
  PACK_OVERFLOW: ["repack"],
  EXPORT_INCOMPATIBLE: ["change-format", "repack"],
  ENCODE_FAILED: ["retry", "repack"],
  ARCHIVE_LIMIT: ["retry", "repack"],
  CANCELLED: [],
  BUSY: ["retry"],
  WORKER_UNAVAILABLE: ["restart-worker"],
  WORKER_CRASHED: ["restart-worker"],
  PROTOCOL_MISMATCH: ["restart-worker"],
  INTERNAL_ERROR: ["restart-worker"],
};
export function error(
  code: Code,
  stage = Stage.Validate,
  details: PipelineError["details"] = {},
): PipelineError {
  return {
    code,
    stage,
    details,
    messageKey: `pipeline.error.${code}`,
    recoverable: code !== Code.WorkerUnavailable && code !== Code.ProtocolMismatch,
    recoveryActions:
      code === Code.Busy && details.field === "asset"
        ? ["release-asset", "retry"]
        : [...recoveries[code]],
  };
}
export class Failure {
  constructor(readonly error: PipelineError) {}
}
export function fail(
  code: Code,
  stage = Stage.Validate,
  details: PipelineError["details"] = {},
): never {
  throw new Failure(error(code, stage, details));
}
export function invalid(field: string): never {
  return fail(Code.InvalidArgument, Stage.Validate, { field });
}
let serial = 0;
export function uniqueId(prefix = "task"): string {
  return `${prefix}_${Date.now().toString(36)}_${++serial}`;
}
export function createExecutionContext(
  taskId: string,
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  let lastYield = 0;
  return {
    taskId,
    limits: { ...DESKTOP_LIMITS },
    isCancelled: () => false,
    yieldControl: () =>
      new Promise<void>((resolve) => {
        if (Date.now() - lastYield < 8) {
          resolve();
          return;
        }
        const timers = globalThis as unknown as {
          setTimeout(callback: () => void, ms: number): unknown;
        };
        timers.setTimeout(() => {
          lastYield = Date.now();
          resolve();
        }, 0);
      }),
    onProgress: () => {},
    ...overrides,
  };
}
export async function checkpoint(context: ExecutionContext, stage: Stage): Promise<void> {
  if (context.isCancelled()) fail(Code.Cancelled, stage);
  await context.yieldControl();
  if (context.isCancelled()) fail(Code.Cancelled, stage);
}
export const weights = {
  detect: [
    [Stage.Validate, 0.05],
    [Stage.Analyze, 0.1],
    [Stage.Grid, 0.15],
    [Stage.Components, 0.45],
    [Stage.Normalize, 0.15],
    [Stage.Hash, 0.1],
  ],
  normalize: [
    [Stage.Validate, 0.05],
    [Stage.Normalize, 0.75],
    [Stage.Hash, 0.2],
  ],
  pack: [
    [Stage.Validate, 0.1],
    [Stage.Pack, 0.9],
  ],
  export: [
    [Stage.Validate, 0.05],
    [Stage.Render, 0.3],
    [Stage.Encode, 0.45],
    [Stage.Archive, 0.2],
  ],
  load: [
    [Stage.Validate, 0.1],
    [Stage.Decode, 0.75],
    [Stage.Analyze, 0.15],
  ],
  preview: [
    [Stage.Validate, 0.1],
    [Stage.Render, 0.9],
  ],
  release: [[Stage.Validate, 1]],
} satisfies Record<string, [Stage, number][]>;
export class Progress {
  stage = Stage.Validate;
  private overall = 0;
  private lastAt = 0;
  constructor(
    readonly context: ExecutionContext,
    readonly asset: AssetRef | null,
    readonly task: keyof typeof weights,
  ) {}
  report(stage: Stage, completed = 0, total: number | null = null, finished = false): void {
    const changed = stage !== this.stage;
    this.stage = stage;
    const fraction =
      total === null ? Number(finished) : Math.min(1, completed / Math.max(1, total));
    let overall = 0;
    for (const [name, weight] of weights[this.task]) {
      if (name === stage) {
        overall += weight * fraction;
        break;
      }
      overall += weight;
    }
    this.overall = Math.max(this.overall, Math.min(overall, 1 - Number.EPSILON));
    const now = Date.now();
    if (!changed && !finished && now - this.lastAt < 50) return;
    this.lastAt = now;
    this.emit(stage, fraction, completed, total);
  }
  complete(): void {
    this.overall = 1;
    this.emit(Stage.Complete, 1, 1, 1);
  }
  private emit(
    stage: Stage,
    stageProgress: number,
    completedUnits: number,
    totalUnits: number | null,
  ): void {
    try {
      this.context.onProgress({
        protocolVersion: 1,
        type: "progress",
        taskId: this.context.taskId,
        asset: this.asset,
        stage,
        stageProgress,
        overallProgress: this.overall,
        completedUnits,
        totalUnits,
        cancellable: stage !== Stage.Complete,
      });
    } catch {
      /* Observers must not affect computation. */
    }
  }
}
export async function outcome<T>(progress: Progress, work: () => Promise<T>): Promise<Outcome<T>> {
  try {
    if (progress.context.isCancelled()) fail(Code.Cancelled, progress.stage);
    const value = await work();
    if (progress.context.isCancelled()) fail(Code.Cancelled, progress.stage);
    progress.complete();
    return { ok: true, value };
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Failure ? caught.error : error(Code.InternalError, progress.stage),
    };
  }
}
export function memory(
  context: ExecutionContext,
  estimatedBytes: number,
  size: { width: number; height: number },
  stage = Stage.Validate,
): void {
  if (estimatedBytes <= context.limits.memoryBudgetBytes) return;
  const ratio = Math.min(0.5, Math.sqrt(context.limits.memoryBudgetBytes / estimatedBytes));
  fail(Code.MemoryLimit, stage, {
    estimatedBytes,
    limit: context.limits.memoryBudgetBytes,
    suggestedSize: {
      width: Math.max(1, Math.floor(size.width * ratio)),
      height: Math.max(1, Math.floor(size.height * ratio)),
    },
  });
}
