import { MessageChannel } from "node:worker_threads";
import { type Endpoint, expose } from "comlink";
import { describe, expect, it } from "vitest";
import { createPipelineClient } from "../src/browser/index.js";
import { CONTRACT_VERSION, DESKTOP_LIMITS } from "../src/index.js";
import type { PipelineWorkerApi } from "../src/types.js";
import { asset, value } from "./helpers.js";

function endpoint(service: PipelineWorkerApi) {
  const { port1, port2 } = new MessageChannel();
  expose(service, port2 as unknown as Endpoint);
  const worker = Object.assign(port1, {
    terminate: () => {
      port1.close();
      port2.close();
    },
  });
  return { worker: worker as unknown as Worker, port: port1 };
}
function service(): PipelineWorkerApi {
  return {
    init: async () => ({
      ok: true,
      value: {
        protocolVersion: 1,
        contractVersion: CONTRACT_VERSION,
        decode: ["image/png"],
        encode: ["image/png"],
        offscreenCanvas: true,
        limits: { ...DESKTOP_LIMITS },
      },
    }),
    execute: async (request) =>
      ({
        protocolVersion: 1,
        taskId: request.taskId,
        command: request.command,
        outcome: {
          ok: false,
          error: {
            code: "BUSY",
            stage: "validate",
            messageKey: "pipeline.error.BUSY",
            recoverable: true,
            recoveryActions: ["retry"],
            details: { field: "task" },
          },
        },
      }) as never,
    cancel: async (taskId) => ({ taskId, status: "requested" }),
    dispose: async () => {},
  };
}
describe("real Comlink MessageChannel transport", () => {
  it("blocks a 2.0.0 Worker at ready and prevents task dispatch", async () => {
    const fake = service();
    const init = fake.init;
    fake.init = async (options) => {
      const result = value(await init(options));
      return { ok: true, value: { ...result, contractVersion: "2.0.0" } } as never;
    };
    const { worker } = endpoint(fake),
      client = createPipelineClient(worker);
    expect(await client.ready).toMatchObject({
      ok: false,
      error: { code: "PROTOCOL_MISMATCH", recoverable: false },
    });
    expect(
      (await client.submit("release", { asset: { assetId: "a", revision: 1 } }).result).outcome,
    ).toMatchObject({ ok: false, error: { code: "PROTOCOL_MISMATCH" } });
    await client.dispose();
  });
  it("transfers RGBA ownership even when a task returns BUSY and settles dispose", async () => {
    const { worker } = endpoint(service());
    const client = createPipelineClient(worker);
    value(await client.ready);
    const input = asset(8, 8);
    const buffer = input.pixels.data.buffer;
    const task = client.submit("load", { kind: "rgba", asset: input });
    expect((await task.result).outcome).toMatchObject({ ok: false, error: { code: "BUSY" } });
    expect(buffer.byteLength).toBe(0);
    expect(await task.cancel()).toEqual({ taskId: task.taskId, status: "already-finished" });
    await client.dispose();
    await client.dispose();
    expect((await client.submit("release", { asset: input.ref }).result).outcome).toMatchObject({
      ok: false,
      error: { code: "WORKER_UNAVAILABLE" },
    });
  });
  it("validates before transferring a buffer", async () => {
    const { worker } = endpoint(service());
    const client = createPipelineClient(worker);
    value(await client.ready);
    const input = asset(8, 8);
    input.ref.revision = 0;
    expect(
      (await client.submit("load", { kind: "rgba", asset: input }).result).outcome,
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(input.pixels.data.byteLength).toBe(256);
    await client.dispose();
  });
  it("maps crashes to all pending results without leaving promises open", async () => {
    const fake = service();
    fake.execute = () => new Promise(() => {});
    const { worker, port } = endpoint(fake);
    const client = createPipelineClient(worker);
    value(await client.ready);
    const first = client.submit("release", { asset: { assetId: "a", revision: 1 } });
    const second = client.submit("release", { asset: { assetId: "a", revision: 1 } });
    port.dispatchEvent(new Event("error"));
    for (const task of [first, second])
      expect((await task.result).outcome).toMatchObject({
        ok: false,
        error: { code: "WORKER_CRASHED" },
      });
  });
  it("terminates after the 2000ms cancellation deadline", async () => {
    const fake = service();
    let dispatched!: () => void;
    const started = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    fake.execute = () => {
      dispatched();
      return new Promise(() => {});
    };
    const { worker } = endpoint(fake);
    const client = createPipelineClient(worker);
    value(await client.ready);
    const task = client.submit("release", { asset: { assetId: "a", revision: 1 } });
    await started;
    expect(await task.cancel()).toEqual({ taskId: task.taskId, status: "requested" });
    expect((await task.result).outcome).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  });
});
