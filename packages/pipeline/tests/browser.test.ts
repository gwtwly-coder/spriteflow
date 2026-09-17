import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectEncoded } from "../src/browser/codec.js";
import { createWorkerService } from "../src/browser/index.js";
import {
  DEFAULT_DETECT_OPTIONS,
  DEFAULT_NORMALIZE_OPTIONS,
  DEFAULT_PACK_OPTIONS,
  DESKTOP_LIMITS,
} from "../src/index.js";
import { asset, value } from "./helpers.js";

const tinyPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0,
]);
function mockCapabilities() {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close() {} }));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return {
          drawImage() {},
          putImageData() {},
          getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }),
        };
      }
      async convertToBlob() {
        return new Blob([tinyPng], { type: "image/png" });
      }
    },
  );
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
}
afterEach(() => vi.unstubAllGlobals());
describe("encoded container inspection", () => {
  it("reads signatures rather than trusting MIME hints", () => {
    expect(inspectEncoded(tinyPng.buffer)).toMatchObject({
      mime: "image/png",
      width: 1,
      height: 1,
    });
    expect(() => inspectEncoded(new Uint8Array([255, 216, 255]).buffer)).toThrow();
  });
  it("rejects APNG and animated WebP before decoding", () => {
    const png = new Uint8Array(58);
    png.set(tinyPng.subarray(0, 33));
    png.set([0, 0, 0, 8, 97, 99, 84, 76, 0, 0, 0, 2, 0, 0, 0, 0], 33);
    expect(() => inspectEncoded(png.buffer)).toThrow();
    const webp = new Uint8Array(30);
    webp.set([82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88, 10, 0, 0, 0, 2], 0);
    expect(() => inspectEncoded(webp.buffer)).toThrow();
  });
});
describe("worker service lifecycle", () => {
  it("reports capability and protocol failures", async () => {
    expect(
      await createWorkerService().init({
        protocolVersion: 2,
        limits: { ...DESKTOP_LIMITS },
      } as never),
    ).toMatchObject({ ok: false, error: { code: "PROTOCOL_MISMATCH", recoverable: false } });
    expect(
      await createWorkerService().init({ protocolVersion: 1, limits: { ...DESKTOP_LIMITS } }),
    ).toMatchObject({ ok: false, error: { code: "WORKER_UNAVAILABLE" } });
  });
  it("loads, detects, reviews, packs, invalidates stale results and releases atomically", async () => {
    mockCapabilities();
    const service = createWorkerService();
    const init = { protocolVersion: 1 as const, limits: { ...DESKTOP_LIMITS } };
    expect(value(await service.init(init)).contractVersion).toBe("3.0.0");
    expect(await service.init(init)).toMatchObject({ ok: true });
    expect(
      await service.init({ ...init, limits: { ...DESKTOP_LIMITS, maxFrames: 100 } }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    const input = asset(8, 8),
      progress = () => {};
    const loaded = await service.execute(
      {
        protocolVersion: 1,
        taskId: "load",
        command: "load",
        payload: { kind: "rgba", asset: input },
      },
      progress,
    );
    const preview = value(loaded.outcome).preview;
    expect(preview.data.buffer).not.toBe(input.pixels.data.buffer);
    expect(
      (
        await service.execute(
          {
            protocolVersion: 1,
            taskId: "busy",
            command: "load",
            payload: { kind: "rgba", asset: asset() },
          },
          progress,
        )
      ).outcome,
    ).toMatchObject({
      ok: false,
      error: {
        code: "BUSY",
        details: { field: "asset" },
        recoveryActions: ["release-asset", "retry"],
      },
    });
    const detection = value(
      (
        await service.execute(
          {
            protocolVersion: 1,
            taskId: "detect",
            command: "detect",
            payload: { asset: input.ref, options: structuredClone(DEFAULT_DETECT_OPTIONS) },
          },
          progress,
        )
      ).outcome,
    );
    const drafts = detection.frames.map((f) => ({
      id: f.id,
      name: f.name,
      sourceRect: f.sourceRect,
      origin: f.origin,
      sourceFrameIds: f.sourceFrameIds,
      edited: false,
      included: true,
      reviewStatus: "accepted" as const,
    }));
    const payload = { asset: input.ref, drafts, options: { ...DEFAULT_NORMALIZE_OPTIONS } };
    const normalized = value(
      (
        await service.execute(
          { protocolVersion: 1, taskId: "normalize", command: "normalize", payload },
          progress,
        )
      ).outcome,
    );
    const packed = value(
      (
        await service.execute(
          {
            protocolVersion: 1,
            taskId: "pack",
            command: "pack",
            payload: {
              asset: input.ref,
              normalizationId: normalized.normalizationId,
              options: { ...DEFAULT_PACK_OPTIONS },
            },
          },
          progress,
        )
      ).outcome,
    );
    expect(packed.packId).toBeTruthy();
    expect(structuredClone(packed).frames[0]).toMatchObject({
      sourceRect: normalized.frames[0]?.sourceRect,
      bbox: normalized.frames[0]?.bbox,
    });
    const normalizedAgain = value(
      (
        await service.execute(
          { protocolVersion: 1, taskId: "normalize2", command: "normalize", payload },
          progress,
        )
      ).outcome,
    );
    expect(
      (
        await service.execute(
          {
            protocolVersion: 1,
            taskId: "stale",
            command: "pack",
            payload: {
              asset: input.ref,
              normalizationId: normalized.normalizationId,
              options: { ...DEFAULT_PACK_OPTIONS },
            },
          },
          progress,
        )
      ).outcome,
    ).toMatchObject({ ok: false, error: { code: "STALE_RESULT" } });
    const exportPayload = {
      asset: input.ref,
      normalizationId: normalizedAgain.normalizationId,
      packId: packed.packId,
      task: { format: "phaser-json-hash" as const, baseName: "atlas", animations: [] },
    };
    const exportTask = {
      protocolVersion: 1 as const,
      taskId: "stale_pack",
      command: "export" as const,
      payload: exportPayload,
    };
    expect((await service.execute(exportTask as never, progress)).outcome).toMatchObject({
      ok: false,
      error: { code: "STALE_RESULT" },
    });
    const repackPayload = {
      asset: input.ref,
      normalizationId: normalizedAgain.normalizationId,
      options: { ...DEFAULT_PACK_OPTIONS },
    };
    const packAgain = value(
      (
        await service.execute(
          { protocolVersion: 1, taskId: "pack_again", command: "pack", payload: repackPayload },
          progress,
        )
      ).outcome,
    );
    expect(packAgain.frames).toEqual(packed.frames);
    value(
      (
        await service.execute(
          { protocolVersion: 1, taskId: "pack_third", command: "pack", payload: repackPayload },
          progress,
        )
      ).outcome,
    );
    expect(
      (
        await service.execute(
          {
            ...exportTask,
            taskId: "old_pack_id",
            payload: { ...exportPayload, packId: packAgain.packId },
          } as never,
          progress,
        )
      ).outcome,
    ).toMatchObject({ ok: false, error: { code: "STALE_RESULT" } });
    expect(
      (
        await service.execute(
          {
            protocolVersion: 1,
            taskId: "release",
            command: "release",
            payload: { asset: input.ref },
          },
          progress,
        )
      ).outcome,
    ).toEqual({ ok: true, value: { released: true } });
    expect(
      (
        await service.execute(
          {
            protocolVersion: 1,
            taskId: "release2",
            command: "release",
            payload: { asset: input.ref },
          },
          progress,
        )
      ).outcome,
    ).toEqual({ ok: true, value: { released: false } });
    expect(await service.cancel("detect")).toEqual({
      taskId: "detect",
      status: "already-finished",
    });
    expect(await service.cancel("unknown")).toEqual({ taskId: "unknown", status: "unknown" });
    await service.dispose();
    await service.dispose();
  });
  it("honors cancellation and task BUSY before loaded-asset BUSY", async () => {
    mockCapabilities();
    const service = createWorkerService();
    value(await service.init({ protocolVersion: 1, limits: { ...DESKTOP_LIMITS } }));
    const first = service.execute(
      {
        protocolVersion: 1,
        taskId: "slow",
        command: "load",
        payload: { kind: "rgba", asset: asset(512, 512) },
      },
      () => {},
    );
    const second = await service.execute(
      {
        protocolVersion: 1,
        taskId: "busy",
        command: "load",
        payload: { kind: "rgba", asset: asset() },
      },
      () => {},
    );
    expect(second.outcome).toMatchObject({
      ok: false,
      error: { code: "BUSY", details: { field: "task" } },
    });
    expect(await service.cancel("slow")).toEqual({ taskId: "slow", status: "requested" });
    expect((await first).outcome).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
    await service.dispose();
  });
});
