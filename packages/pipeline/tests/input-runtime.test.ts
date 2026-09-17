import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  DEFAULT_DETECT_OPTIONS,
  DESKTOP_LIMITS,
  detect,
} from "../src/index.js";
import { resizePixels } from "../src/input/pixels.js";
import { asset, paint, value } from "./helpers.js";

describe("input and runtime", () => {
  it("uses exact area averaging and independent tightly packed buffers", async () => {
    const input = asset(3, 1);
    input.pixels.data.set([0, 0, 0, 0, 60, 120, 180, 120, 120, 240, 0, 240]);
    const output = await resizePixels(input.pixels, 2, createExecutionContext("resize"));
    expect(output.width).toBe(2);
    expect(output.height).toBe(1);
    expect([...output.data]).toEqual([20, 40, 60, 40, 100, 200, 60, 200]);
    expect(output.data.buffer).not.toBe(input.pixels.data.buffer);
    expect(output.data.byteOffset).toBe(0);
  });
  it("zeros transparent RGB without modifying the input", async () => {
    const input = asset(1, 1);
    input.pixels.data.set([20, 40, 60, 0]);
    const output = await resizePixels(input.pixels, 20, createExecutionContext("resize"));
    expect([...output.data]).toEqual([0, 0, 0, 0]);
    expect([...input.pixels.data]).toEqual([20, 40, 60, 0]);
  });
  it("accepts exactly 99% opaque and rejects strictly above it", async () => {
    const input = paint(asset(100, 1), { x: 0, y: 0, width: 99, height: 1 });
    value(await detect(input));
    paint(input, { x: 99, y: 0, width: 1, height: 1 });
    expect(await detect(input)).toMatchObject({ ok: false, error: { code: "OPAQUE_INPUT" } });
  });
  it("rejects sliced/shared/detached buffers and unknown options", async () => {
    const input = asset(2, 2);
    input.pixels.data = new Uint8ClampedArray(new ArrayBuffer(20), 4, 16);
    expect(await detect(input)).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    input.pixels.data = new Uint8ClampedArray(new SharedArrayBuffer(16));
    expect(await detect(input)).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    input.pixels.data = new Uint8ClampedArray(16);
    structuredClone(input.pixels.data.buffer, { transfer: [input.pixels.data.buffer] });
    expect(await detect(input)).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(
      await detect(asset(), { ...DEFAULT_DETECT_OPTIONS, extra: true } as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });
  it("checks budgets before allocating analysis arrays", async () => {
    expect(
      await detect(
        asset(),
        undefined,
        createExecutionContext("memory", {
          limits: { ...DESKTOP_LIMITS, memoryBudgetBytes: 1 },
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "MEMORY_LIMIT" } });
  });
  it("cancels during a real macrotask yield without emitting complete", async () => {
    let cancelled = false;
    const events: string[] = [];
    const context = createExecutionContext("cancel", {
      isCancelled: () => cancelled,
      yieldControl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        cancelled = true;
      },
      onProgress: (event) => events.push(event.stage),
    });
    expect(await detect(asset(256, 256), undefined, context)).toMatchObject({
      ok: false,
      error: { code: "CANCELLED", recoveryActions: [] },
    });
    expect(events).not.toContain("complete");
  });
});
