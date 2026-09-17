import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  DEFAULT_DETECT_OPTIONS,
  DegradedReason,
  detect,
  ExportFormat,
  exportAssets,
  PipelineErrorCode,
  PipelineWarningCode,
  packFrames,
} from "../src/index.js";
import type { DetectOptions, DetectResult } from "../src/types.js";
import { asset, paint, value } from "./helpers.js";

const qualities = ["preview", "final"] as const;
const modes = ["auto", "grid", "components"] as const;
function options(changes: Partial<DetectOptions> = {}): DetectOptions {
  return { ...structuredClone(DEFAULT_DETECT_OPTIONS), ...changes };
}
function assertEmptyFrames(result: DetectResult) {
  for (const frame of result.frames) {
    expect(frame).toMatchObject({
      included: true,
      reviewStatus: "pending",
      bbox: null,
      pHash: null,
      clusterId: null,
      flags: {
        empty: true,
        outlier: false,
        merged: false,
        multipleComponents: false,
        edited: false,
        duplicateOf: null,
      },
    });
    expect(frame.canvas.offset).toEqual({ x: 0, y: 0 });
  }
}

describe("contract 2.0.0 / section 13.3", () => {
  it("publishes the activated version", () => expect(CONTRACT_VERSION).toBe("3.0.0"));
  for (const [width, height] of [
    [100, 100],
    [200, 100],
    [100, 200],
    [8192, 1],
    [1, 8192],
  ]) {
    for (const mode of modes)
      for (const quality of qualities) {
        it(`returns exactly one empty whole-image frame for ${width}x${height} ${mode}/${quality}`, async () => {
          const input = asset(width, height);
          const request = options({ mode, quality });
          const result = value(await detect(input, request));
          expect(result.options).toEqual(request);
          expect(result.quality).toBe(quality);
          expect(result.asset).toEqual(input.ref);
          expect(result.strategy).toBe("manual-grid");
          expect(result.confidence).toBe(0);
          expect(result.degraded).toEqual({
            reason: DegradedReason.EmptyInput,
            attempted: [],
            suggestedGrid: { rows: 1, columns: 1, region: null, keepEmptyCells: true },
          });
          expect(result.frames).toHaveLength(1);
          expect(result.frames[0]?.sourceRect).toEqual({ x: 0, y: 0, width, height });
          expect(result.frames[0]?.id).toBe("g_0_0");
          expect(result.diagnostics).toMatchObject({
            foregroundPixels: 0,
            componentCount: 0,
            filteredComponentCount: 0,
            componentConfidence: 0,
            gridConfidence: 0,
            effectiveDilationRadiusPx: 0,
            effectiveMergeDistancePx: 0,
          });
          expect(result.warnings).toEqual([
            {
              code: PipelineWarningCode.DetectionDegraded,
              messageKey: "pipeline.warning.DETECTION_DEGRADED",
              frameIds: [],
              reason: DegradedReason.EmptyInput,
            },
            {
              code: PipelineWarningCode.EmptyFrames,
              messageKey: "pipeline.warning.EMPTY_FRAMES",
              frameIds: ["g_0_0"],
              reason: null,
            },
          ]);
          assertEmptyFrames(result);
        });
      }
  }
  for (const quality of qualities)
    for (const keepEmptyCells of [true, false]) {
      for (const region of [null, { x: 20, y: 10, width: 120, height: 60 }]) {
        it(`respects manual 2x3 region=${JSON.stringify(region)} keep=${keepEmptyCells} ${quality}`, async () => {
          const request = options({
            mode: "manual-grid",
            quality,
            manualGrid: { rows: 2, columns: 3, region, keepEmptyCells },
          });
          const result = value(await detect(asset(), request));
          expect(result.options).toEqual(request);
          expect(result.quality).toBe(quality);
          expect(result.strategy).toBe("manual-grid");
          expect(result.confidence).toBe(1);
          expect(result.degraded).toBeNull();
          expect(result).not.toHaveProperty("suggestedGrid");
          expect(result).not.toHaveProperty("attempted");
          expect(result.frames).toHaveLength(keepEmptyCells ? 6 : 0);
          if (keepEmptyCells) {
            const xs = region ? [20, 60, 100, 140] : [0, 66, 133, 200];
            const ys = region ? [10, 40, 70] : [0, 50, 100];
            expect(result.frames.map((frame) => frame.sourceRect)).toEqual(
              [0, 1].flatMap((row) =>
                [0, 1, 2].map((col) => ({
                  x: xs[col],
                  y: ys[row],
                  width: (xs[col + 1] as number) - (xs[col] as number),
                  height: (ys[row + 1] as number) - (ys[row] as number),
                })),
              ),
            );
          }
          expect(result.warnings).toEqual(
            keepEmptyCells
              ? [
                  {
                    code: PipelineWarningCode.EmptyFrames,
                    messageKey: "pipeline.warning.EMPTY_FRAMES",
                    reason: null,
                    frameIds: ["g_0_0", "g_0_1", "g_0_2", "g_1_0", "g_1_1", "g_1_2"],
                  },
                ]
              : [],
          );
          assertEmptyFrames(result);
        });
      }
      it(`does not inherit degradation on a second detection ${quality}/${keepEmptyCells}`, async () => {
        const input = asset();
        const first = value(await detect(input, options({ quality })));
        const second = value(
          await detect(
            input,
            options({
              mode: "manual-grid",
              quality,
              manualGrid: { rows: 2, columns: 3, region: null, keepEmptyCells },
            }),
          ),
        );
        expect(first.degraded?.reason).toBe(DegradedReason.EmptyInput);
        expect(first.frames).toHaveLength(1);
        expect(second.degraded).toBeNull();
        expect(second.frames).toHaveLength(keepEmptyCells ? 6 : 0);
        expect(
          second.warnings.some((warning) => warning.code === PipelineWarningCode.DetectionDegraded),
        ).toBe(false);
      });
    }
  for (const manualGrid of [
    null,
    { rows: 0, columns: 3, region: null, keepEmptyCells: true },
    { rows: 2, columns: 3, region: { x: 190, y: 0, width: 20, height: 10 }, keepEmptyCells: true },
    { rows: 100, columns: 100, region: null, keepEmptyCells: true },
  ]) {
    it(`validates before empty input: ${JSON.stringify(manualGrid)}`, async () => {
      expect(await detect(asset(), options({ mode: "manual-grid", manualGrid }))).toMatchObject({
        ok: false,
        error: { code: PipelineErrorCode.InvalidArgument, stage: "validate" },
      });
    });
  }
  for (const mode of modes)
    for (const quality of qualities) {
      it(`never confuses sparse nonzero alpha with empty input ${mode}/${quality}`, async () => {
        const input = paint(asset(8192, 1), { x: 100, y: 0, width: 1, height: 1 }, [0, 0, 0, 1]);
        const result = value(await detect(input, options({ mode, quality })));
        expect(result.degraded?.reason).not.toBe(DegradedReason.EmptyInput);
        expect(result.degraded?.suggestedGrid.columns).toBeGreaterThan(1);
      });
    }
  it("lets manual empty results succeed and rejects zero-frame pack/export", async () => {
    const input = asset();
    const detected = value(
      await detect(
        input,
        options({
          mode: "manual-grid",
          manualGrid: { rows: 2, columns: 3, region: null, keepEmptyCells: false },
        }),
      ),
    );
    expect(await packFrames(input.ref, detected.frames)).toMatchObject({
      ok: false,
      error: { code: PipelineErrorCode.NoFrames },
    });
    expect(
      await exportAssets(
        { asset: input, frames: [], pack: null },
        {
          format: ExportFormat.PngSequenceZip,
          baseName: "atlas",
          animations: [],
        },
        {
          encode: async () => {
            throw new Error("Must not encode empty results");
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: PipelineErrorCode.NoFrames },
    });
  });
});
