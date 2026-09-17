// biome-ignore-all lint/style/noNonNullAssertion: These deterministic fixtures establish the indexed entries used by assertions.
import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  DEFAULT_DETECT_OPTIONS,
  DEFAULT_NORMALIZE_OPTIONS,
  DEFAULT_PACK_OPTIONS,
  DESKTOP_LIMITS,
  detect,
  ExportFormat,
  exportAssets,
  normalizeFrames,
  packFrames,
} from "../src/index.js";
import { dhash } from "../src/normalization/hash.js";
import type { FrameDraft, PackOptions, ProgressEvent } from "../src/types.js";
import { asset, paint, value } from "./helpers.js";

const ctx = () => createExecutionContext("boundary", { yieldControl: async () => {} });
const draft = (id: string, width: number, height: number, x = 0, y = 0): FrameDraft => ({
  id,
  name: id,
  sourceRect: { x, y, width, height },
  origin: "manual",
  sourceFrameIds: [],
  edited: false,
  included: true,
  reviewStatus: "accepted",
});
describe("boundary rules", () => {
  it("hashes constant nonzero grayscale to zero even with fractional sample boundaries", async () => {
    const input = paint(asset(13, 11), { x: 0, y: 0, width: 13, height: 11 }, [173, 173, 173, 180]);
    expect((await dhash(input.pixels, { x: 0, y: 0, width: 13, height: 11 }, ctx())).hex).toBe(
      "0000000000000000",
    );
  });
  it("returns geometric ambiguity when at least two valid size clusters disagree", async () => {
    const input = paint(asset(150, 100), { x: 5, y: 5, width: 8, height: 9 });
    paint(input, { x: 40, y: 20, width: 20, height: 25 });
    paint(input, { x: 90, y: 45, width: 40, height: 45 });
    const r = value(
      await detect(
        input,
        { ...DEFAULT_DETECT_OPTIONS, mode: "components", dilationRadiusPx: 0, mergeDistancePx: 0 },
        ctx(),
      ),
    );
    expect(r.degraded?.reason).toBe("AMBIGUOUS_COMPONENTS");
    expect(r.diagnostics.componentConfidence).toBeCloseTo(0.7 / 3 + 0.3);
    expect(r.degraded?.attempted).toEqual(["components"]);
  });
  it("validates all options before early empty-input success", async () => {
    for (const changes of [
      { alphaThreshold: 255 },
      { minAreaPx: 0 },
      { minAreaRatio: 0.2 },
      { connectivity: 4 },
      { quality: "draft" },
      { dilationRadiusPx: -1 },
      { mergeDistancePx: 513 },
      { mergeDistanceRatio: NaN },
      { maxFrames: 2001 },
      { analysisMaxDimension: 127 },
      { componentConfidenceThreshold: Infinity },
      { manualGrid: { rows: 1, columns: 1, region: null, keepEmptyCells: true } },
      { grid: { ...DEFAULT_DETECT_OPTIONS.grid, extra: 1 } },
      { normalize: { ...DEFAULT_NORMALIZE_OPTIONS, alphaThreshold: 9 } },
    ]) {
      expect(
        await detect(asset(), { ...DEFAULT_DETECT_OPTIONS, ...changes } as never, ctx()),
      ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT", stage: "validate" } });
    }
    expect(
      await detect(
        asset(100, 1),
        undefined,
        createExecutionContext("small", { limits: { ...DESKTOP_LIMITS, maxDimension: 50 } }),
      ),
    ).toMatchObject({ ok: false, error: { code: "DIMENSION_LIMIT" } });
  });
  it("keeps monotonic finite progress and absorbs observer exceptions", async () => {
    const events: ProgressEvent[] = [];
    const input = asset(96, 96);
    for (const x of [5, 55]) paint(input, { x, y: 5, width: 25, height: 25 });
    value(
      await detect(
        input,
        undefined,
        createExecutionContext("progress", {
          onProgress: (e) => {
            events.push(e);
            throw new Error("observer");
          },
        }),
      ),
    );
    expect(events.at(-1)).toMatchObject({
      stage: "complete",
      overallProgress: 1,
      cancellable: false,
    });
    expect(
      events.every(
        (e, i) =>
          Number.isFinite(e.overallProgress) &&
          e.overallProgress >= (events[i - 1]?.overallProgress ?? 0),
      ),
    ).toBe(true);
    expect(events.filter((e) => e.overallProgress === 1)).toHaveLength(1);
  });
  it("packs rotated non-square content and preserves Phaser logical dimensions", async () => {
    const input = paint(asset(100, 20), { x: 0, y: 0, width: 70, height: 10 });
    const frames = value(
      await normalizeFrames(input, [draft("f", 70, 10)], undefined, ctx()),
    ).frames;
    const options: PackOptions = {
      ...DEFAULT_PACK_OPTIONS,
      maxWidth: 64,
      maxHeight: 128,
      allowRotation: true,
    };
    const pack = value(await packFrames(input.ref, frames, options, ctx()));
    expect(pack.frames[0]).toMatchObject({
      rotated: true,
      rect: { width: 10, height: 70 },
      sourceSize: { width: 70, height: 10 },
    });
    const source = { asset: input, frames, pack };
    const output = value(
      await exportAssets(
        source,
        { format: ExportFormat.PhaserJsonHash, baseName: "atlas", animations: [] },
        { encode: async (p) => p.data.slice().buffer },
        ctx(),
      ),
    );
    const { unzipSync, strFromU8 } = await import("fflate");
    const doc = JSON.parse(strFromU8(unzipSync(new Uint8Array(output.archive))["atlas.json"]!));
    expect(doc.frames.f.frame).toMatchObject({ w: 70, h: 10 });
    expect(doc.frames.f.rotated).toBe(true);
  });
  it("enforces page overflow and incompatible Phaser multipage export", async () => {
    const input = asset(128, 128);
    paint(input, { x: 0, y: 0, width: 40, height: 40 });
    paint(input, { x: 60, y: 60, width: 40, height: 40 });
    const frames = value(
      await normalizeFrames(
        input,
        [draft("a", 40, 40), draft("b", 40, 40, 60, 60)],
        undefined,
        ctx(),
      ),
    ).frames;
    const options = { ...DEFAULT_PACK_OPTIONS, maxWidth: 64, maxHeight: 64 };
    expect(await packFrames(input.ref, frames, options, ctx())).toMatchObject({
      ok: false,
      error: { code: "PACK_OVERFLOW" },
    });
    const pack = value(await packFrames(input.ref, frames, { ...options, maxPages: 2 }, ctx()));
    const source = { asset: input, frames, pack };
    const codec = { encode: async () => new ArrayBuffer(1) };
    expect(
      await exportAssets(
        source,
        { format: ExportFormat.PhaserJsonHash, baseName: "atlas", animations: [] },
        codec,
        ctx(),
      ),
    ).toMatchObject({ ok: false, error: { code: "EXPORT_INCOMPATIBLE" } });
    expect(
      (
        await exportAssets(
          source,
          { format: ExportFormat.GenericJson, baseName: "atlas", animations: [] },
          codec,
          ctx(),
        )
      ).ok,
    ).toBe(true);
  });
  it("rejects invalid animations and an archive that exceeds its byte limit", async () => {
    const input = asset(8, 8),
      frames = value(await normalizeFrames(input, [draft("a", 8, 8)], undefined, ctx())).frames;
    const source = { asset: input, frames, pack: null };
    const codec = { encode: async () => new ArrayBuffer(64) };
    expect(
      await exportAssets(
        source,
        {
          format: ExportFormat.PngSequenceZip,
          baseName: "atlas",
          animations: [{ name: "x", fps: 12, loop: true, frameIds: ["missing"] }],
        },
        codec,
        ctx(),
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(
      await exportAssets(
        source,
        { format: ExportFormat.PngSequenceZip, baseName: "atlas", animations: [] },
        codec,
        createExecutionContext("archive", { limits: { ...DESKTOP_LIMITS, maxArchiveBytes: 20 } }),
      ),
    ).toMatchObject({ ok: false, error: { code: "ARCHIVE_LIMIT" } });
  });
});
