import * as v from "../input/validate.js";
import { fail } from "../runtime/execution.js";
import type { InitOptions, LoadInput, ResourceLimits, TaskRequest } from "../types.js";
import { PipelineErrorCode } from "../types.js";

export function initOptions(options: InitOptions): void {
  if (options?.protocolVersion !== 1) fail(PipelineErrorCode.ProtocolMismatch);
  v.object(options, ["protocolVersion", "limits"], "options");
  v.limits(options.limits);
}
export function request(request: TaskRequest, limits: ResourceLimits): void {
  if (request?.protocolVersion !== 1) fail(PipelineErrorCode.ProtocolMismatch);
  v.object(request, ["protocolVersion", "taskId", "command", "payload"], "request");
  v.id(request.taskId, "request.taskId");
  const p = request.payload;
  switch (request.command) {
    case "load":
      load(p as LoadInput, limits);
      break;
    case "detect":
      v.object(p, ["asset", "options"], "payload");
      v.ref(request.payload.asset);
      v.detectOptions(
        request.payload.options,
        { width: limits.maxDimension, height: limits.maxDimension },
        limits,
      );
      break;
    case "preview":
      v.object(p, ["asset", "sourceRect", "maxDimension"], "payload");
      v.ref(request.payload.asset);
      v.number(request.payload.maxDimension, 1, 1024, "payload.maxDimension");
      if (request.payload.sourceRect !== null)
        v.rect(
          request.payload.sourceRect,
          { width: limits.maxDimension, height: limits.maxDimension },
          "payload.sourceRect",
        );
      break;
    case "normalize":
      v.object(p, ["asset", "drafts", "options"], "payload");
      v.ref(request.payload.asset);
      v.normalizeOptions(request.payload.options);
      v.drafts(
        request.payload.drafts,
        { width: limits.maxDimension, height: limits.maxDimension },
        limits,
      );
      break;
    case "pack":
      v.object(p, ["asset", "normalizationId", "options"], "payload");
      v.ref(request.payload.asset);
      v.id(request.payload.normalizationId, "payload.normalizationId");
      v.packOptions(request.payload.options, limits);
      break;
    case "export":
      v.object(p, ["asset", "normalizationId", "packId", "task"], "payload");
      v.ref(request.payload.asset);
      v.id(request.payload.normalizationId, "payload.normalizationId");
      if (request.payload.packId !== null) v.id(request.payload.packId, "payload.packId");
      v.object(request.payload.task, ["format", "baseName", "animations"], "payload.task");
      break;
    case "release":
      v.object(p, ["asset"], "payload");
      v.ref(request.payload.asset);
      break;
    default:
      v.invalid("request.command");
  }
}
function load(input: LoadInput, limits: ResourceLimits): void {
  if (input?.kind === "rgba") {
    v.object(input, ["kind", "asset"], "payload");
    v.asset(input.asset, limits);
    return;
  }
  v.object(input, ["kind", "ref", "name", "mimeHint", "bytes", "resizeTo"], "payload");
  v.oneOf(input.kind, ["encoded"], "payload.kind");
  v.ref(input.ref);
  if (typeof input.name !== "string" || typeof input.mimeHint !== "string")
    v.invalid("payload.name");
  if (!(input.bytes instanceof ArrayBuffer) || !input.bytes.byteLength) v.invalid("payload.bytes");
  if (input.resizeTo !== null) v.size(input.resizeTo, "payload.resizeTo");
}
