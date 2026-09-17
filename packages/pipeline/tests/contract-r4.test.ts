// biome-ignore-all lint/style/noNonNullAssertion: Successful fixture construction establishes the single-frame entries under test.
import { createRequire } from "node:module";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  DEFAULT_NORMALIZE_OPTIONS,
  DEFAULT_PACK_OPTIONS,
  ExportFormat,
  exportAssets,
  normalizeFrames,
  packFrames,
} from "../src/index.js";
import type { Frame, FrameDraft, InputAsset, PackResult, PixelBuffer, Rect } from "../src/types.js";
import { asset, paint, value } from "./helpers.js";

const { PNG } = createRequire(new URL("../../../tests/golden/package.json", import.meta.url))(
  "pngjs",
);
const encode = vi.fn(
  async (p: PixelBuffer): Promise<ArrayBuffer> =>
    new Uint8Array(PNG.sync.write({ width: p.width, height: p.height, data: Buffer.from(p.data) }))
      .buffer,
);
const task = { format: ExportFormat.PhaserJsonHash, baseName: "atlas", animations: [] };
const draft = (sourceRect: Rect): FrameDraft => ({
  id: "same_frame",
  name: "frame_000",
  sourceRect,
  origin: "manual",
  sourceFrameIds: [],
  edited: false,
  included: true,
  reviewStatus: "accepted",
});
async function normalize(input: InputAsset, rect: Rect, options = DEFAULT_NORMALIZE_OPTIONS) {
  return value(await normalizeFrames(input, [draft(rect)], options)).frames;
}
async function fixture() {
  const input = paint(
    paint(asset(), { x: 10, y: 10, width: 8, height: 8 }, [255, 0, 0, 255]),
    { x: 110, y: 10, width: 8, height: 8 },
    [0, 255, 0, 255],
  );
  const before = await normalize(input, { x: 0, y: 0, width: 50, height: 50 });
  const after = await normalize(input, { x: 100, y: 0, width: 50, height: 50 });
  return {
    input,
    before,
    after,
    old: value(await packFrames(input.ref, before)),
    fresh: value(await packFrames(input.ref, after)),
  };
}
async function stale(
  input: InputAsset,
  frames: Frame[],
  pack: PackResult,
  field?: string,
  format = task.format,
) {
  encode.mockClear();
  const result = await exportAssets(
    { asset: input, frames, pack },
    { ...task, format },
    { encode },
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "STALE_RESULT",
      stage: "validate",
      messageKey: "pipeline.error.STALE_RESULT",
      recoverable: true,
      recoveryActions: ["retry"],
      ...(field
        ? { details: { field: `source.pack.frames.0.${field}`, frameIds: [frames[0]?.id] } }
        : {}),
    },
  });
  expect(encode).not.toHaveBeenCalled();
}

describe("contract 3.0.0 / section 14.3", () => {
  it("publishes the new contract while preserving protocol and file schemas", () =>
    expect(CONTRACT_VERSION).toBe("3.0.0"));
  it("rejects the original 003 crop move and renders the fresh green sprite", async () => {
    const f = await fixture();
    expect(f.old).not.toEqual(f.fresh);
    for (const [pack, frames] of [
      [f.old, f.before],
      [f.fresh, f.after],
    ] as const) {
      expect(pack.frames[0]).toMatchObject({
        sourceRect: frames[0]?.sourceRect,
        bbox: frames[0]?.bbox,
      });
    }
    await stale(f.input, f.after, structuredClone(f.old), "sourceRect");
    const result = value(
      await exportAssets(
        { asset: f.input, frames: f.after, pack: structuredClone(f.fresh) },
        task,
        { encode },
      ),
    );
    const decoded = PNG.sync.read(
      Buffer.from(unzipSync(new Uint8Array(result.archive))["atlas.png"]!),
    );
    const rect = f.fresh.frames[0]!.rect;
    expect([
      ...decoded.data.subarray(
        (rect.y * decoded.width + rect.x) * 4,
        (rect.y * decoded.width + rect.x) * 4 + 4,
      ),
    ]).toEqual([0, 255, 0, 255]);
  });
  it("detects bbox changes independently from sourceRect at different alpha thresholds", async () => {
    const input = paint(
      paint(asset(100, 100), { x: 10, y: 10, width: 8, height: 8 }, [255, 0, 0, 80]),
      { x: 30, y: 10, width: 8, height: 8 },
    );
    const rect = { x: 0, y: 0, width: 50, height: 50 };
    const before = await normalize(input, rect, {
      ...DEFAULT_NORMALIZE_OPTIONS,
      alphaThreshold: 0,
    });
    const after = await normalize(input, rect, {
      ...DEFAULT_NORMALIZE_OPTIONS,
      alphaThreshold: 100,
    });
    expect(before[0]?.sourceRect).toEqual(after[0]?.sourceRect);
    await stale(input, after, value(await packFrames(input.ref, before)), "bbox");
  });
  it("detects sourceRect changes with identical bbox and canvas", async () => {
    const f = await fixture();
    const after = await normalize(f.input, { x: 1, y: 0, width: 49, height: 50 });
    expect(after[0]?.bbox).toEqual(f.before[0]?.bbox);
    expect(after[0]?.canvas).toEqual(f.before[0]?.canvas);
    await stale(f.input, after, f.old, "sourceRect");
  });
  it("keeps empty snapshots and placeholders while rejecting moved empty frames", async () => {
    const input = asset();
    const before = await normalize(input, { x: 0, y: 0, width: 50, height: 50 });
    const after = await normalize(input, { x: 100, y: 0, width: 50, height: 50 });
    const pack = value(await packFrames(input.ref, after));
    expect(pack.frames[0]).toMatchObject({
      sourceRect: after[0]?.sourceRect,
      bbox: null,
      empty: true,
      spriteSourceSize: { x: 0, y: 0, width: 1, height: 1 },
    });
    value(await exportAssets({ asset: input, frames: after, pack }, task, { encode }));
    await stale(input, after, value(await packFrames(input.ref, before)), "sourceRect");
  });
  it.each([false, true])("rejects empty/nonempty transitions (reverse=%s)", async (reverse) => {
    const input = paint(asset(), { x: 10, y: 10, width: 8, height: 8 }, [0, 255, 0, 80]);
    const rect = { x: 0, y: 0, width: 50, height: 50 };
    const a = await normalize(input, rect, { ...DEFAULT_NORMALIZE_OPTIONS, alphaThreshold: 0 });
    const b = await normalize(input, rect, { ...DEFAULT_NORMALIZE_OPTIONS, alphaThreshold: 100 });
    await stale(
      input,
      reverse ? a : b,
      value(await packFrames(input.ref, reverse ? b : a)),
      "bbox",
    );
  });
  it.each([
    "sourceRect",
    "bbox",
  ] as const)("classifies a missing %s as stale, without filling it", async (field) => {
    const f = await fixture(),
      pack = structuredClone(f.fresh);
    delete (pack.frames[0] as unknown as Record<string, unknown>)[field];
    await stale(f.input, f.after, pack, field);
    expect(Object.hasOwn(pack.frames[0]!, field)).toBe(false);
  });
  it.each([
    ["sourceRect", undefined],
    ["bbox", undefined],
    ["sourceRect", null],
    ["sourceRect", { x: 100.5, y: 0, width: 50, height: 50 }],
    ["sourceRect", { x: 199, y: 0, width: 50, height: 50 }],
    ["bbox", { x: 90, y: 10, width: 8, height: 8 }],
    ["bbox", { x: 110, y: 10, width: 0, height: 8 }],
    ["bbox", { x: 110, y: Number.NaN, width: 8, height: 8 }],
    ["bbox", { x: 110, y: 10, width: 8, height: 8, extra: true }],
    ["unknown", true],
  ])("rejects illegal snapshot %s (%j) before rendering", async (field, bad) => {
    const f = await fixture(),
      pack = structuredClone(f.fresh);
    (pack.frames[0] as unknown as Record<string, unknown>)[field as string] = bad;
    encode.mockClear();
    expect(
      await exportAssets({ asset: f.input, frames: f.after, pack }, task, { encode }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT", stage: "validate" } });
    expect(encode).not.toHaveBeenCalled();
  });
  it("checks missing fields before illegal values and illegal values before mismatches", async () => {
    const f = await fixture(),
      pack = structuredClone(f.old);
    (pack.frames[0] as unknown as Record<string, unknown>).sourceRect = undefined;
    delete (pack.frames[0] as unknown as Record<string, unknown>).bbox;
    await stale(f.input, f.after, pack, "bbox");
    pack.frames[0]!.sourceRect = { ...f.before[0]!.sourceRect };
    (pack.frames[0] as unknown as Record<string, unknown>).bbox = undefined;
    expect(
      await exportAssets({ asset: f.input, frames: f.after, pack }, task, { encode }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });
  it.each([
    "clone",
    "json",
    "new-module",
  ])("validates persisted DTOs by value: %s", async (method) => {
    const f = await fixture();
    const clone = (p: PackResult): PackResult =>
      method === "json" ? JSON.parse(JSON.stringify(p)) : structuredClone(p);
    let run = exportAssets;
    if (method === "new-module") {
      vi.resetModules();
      run = (await import("../src/index.js")).exportAssets;
    }
    const fresh = clone(f.fresh),
      old = clone(f.old);
    for (const p of [fresh, old])
      for (const item of p.frames) {
        const { x, y, width, height } = item.sourceRect;
        item.sourceRect = { height, width, y, x };
        if (item.bbox) {
          const { x, y, width, height } = item.bbox;
          item.bbox = { height, width, y, x };
        }
      }
    value(await run({ asset: f.input, frames: f.after, pack: fresh }, task, { encode }));
    encode.mockClear();
    expect(
      await run({ asset: f.input, frames: f.after, pack: old }, task, { encode }),
    ).toMatchObject({ ok: false, error: { code: "STALE_RESULT" } });
    expect(encode).not.toHaveBeenCalled();
  });
  it("allows repeat normalization with equal public geometry and layout", async () => {
    const f = await fixture();
    const again = await normalize(f.input, { ...f.after[0]!.sourceRect });
    expect(value(await packFrames(f.input.ref, again))).toEqual(f.fresh);
    value(await exportAssets({ asset: f.input, frames: again, pack: f.fresh }, task, { encode }));
  });
  it("keeps the bbox snapshot independent when the caller mutates a normalized frame", async () => {
    const f = await fixture(),
      snapshot = structuredClone(f.fresh);
    f.after[0]!.bbox!.x++;
    expect(f.fresh).toEqual(snapshot);
    await stale(f.input, f.after, f.fresh, "bbox");
  });
  it("copies both rectangles in both directions", async () => {
    const f = await fixture(),
      snapshot = structuredClone(f.fresh);
    expect(f.fresh.frames[0]!.sourceRect).not.toBe(f.after[0]!.sourceRect);
    expect(f.fresh.frames[0]!.bbox).not.toBe(f.after[0]!.bbox);
    f.after[0]!.sourceRect.x--;
    f.after[0]!.sourceRect.width++;
    expect(f.fresh).toEqual(snapshot);
    await stale(f.input, f.after, f.fresh, "sourceRect");
    const original = structuredClone(f.after);
    f.fresh.frames[0]!.sourceRect.x++;
    f.fresh.frames[0]!.bbox!.x++;
    expect(f.after).toEqual(original);
  });
  it.each([
    ExportFormat.PhaserJsonHash,
    ExportFormat.PhaserJsonArray,
    ExportFormat.GenericJson,
  ])("guards %s and keeps download schemas unchanged", async (format) => {
    const f = await fixture();
    await stale(f.input, f.after, f.old, "sourceRect", format);
    const zip = unzipSync(
      new Uint8Array(
        value(
          await exportAssets(
            { asset: f.input, frames: f.after, pack: f.fresh },
            { ...task, format },
            { encode },
          ),
        ).archive,
      ),
    );
    for (const [path, bytes] of Object.entries(zip))
      if (path.endsWith(".json")) {
        const text = strFromU8(bytes);
        expect(text).not.toMatch(/"(?:sourceRect|bbox)"/);
        if (path === "atlas.json")
          expect(JSON.parse(text)).toMatchObject(
            format === ExportFormat.GenericJson
              ? { schemaVersion: "spriteflow-atlas/1" }
              : { meta: { version: "3.0.0" } },
          );
      }
  });
  it.each([
    "revision",
    "id",
    "count",
    "order",
    "name",
    "canvas",
    "empty",
    "layout",
    "rotation",
  ])("preserves prior checks: %s", async (mutation) => {
    const f = await fixture(),
      pack = structuredClone(f.fresh),
      p = pack.frames[0]!;
    switch (mutation) {
      case "revision":
        pack.asset.revision++;
        break;
      case "id":
        p.frameId = "other";
        break;
      case "count":
        pack.frames = [];
        break;
      case "order":
        pack.frameOrder = ["other"];
        break;
      case "name":
        p.name = "other";
        break;
      case "canvas":
        p.sourceSize.width++;
        break;
      case "empty":
        p.empty = true;
        break;
      case "layout":
        p.rect.x++;
        break;
      case "rotation":
        p.rotated = true;
        break;
    }
    await stale(f.input, f.after, pack);
  });
  it("ignores excluded frames and checks review/empty timeline before legacy packs", async () => {
    const f = await fixture();
    const excluded = { ...f.before[0]!, id: "excluded", name: "excluded", included: false };
    value(
      await exportAssets({ asset: f.input, frames: [excluded, ...f.after], pack: f.fresh }, task, {
        encode,
      }),
    );
    delete (f.fresh.frames[0] as unknown as Record<string, unknown>).bbox;
    expect(
      await exportAssets({ asset: f.input, frames: [excluded], pack: f.fresh }, task, { encode }),
    ).toMatchObject({ ok: false, error: { code: "NO_FRAMES" } });
    f.after[0]!.reviewStatus = "pending";
    expect(
      await exportAssets({ asset: f.input, frames: f.after, pack: f.fresh }, task, { encode }),
    ).toMatchObject({ ok: false, error: { code: "REVIEW_REQUIRED" } });
  });
  it("supports untrimmed multipage geometry with padding and extrude", async () => {
    const f = await fixture();
    const drafts = [
      draft({ x: 0, y: 0, width: 50, height: 50 }),
      { ...draft({ x: 100, y: 0, width: 50, height: 50 }), id: "second", name: "second" },
    ];
    const frames = value(
      await normalizeFrames(f.input, drafts, {
        ...DEFAULT_NORMALIZE_OPTIONS,
        trim: false,
        padding: 3,
      }),
    ).frames;
    const pack = value(
      await packFrames(f.input.ref, frames, {
        ...DEFAULT_PACK_OPTIONS,
        maxWidth: 64,
        maxHeight: 64,
        maxPages: 2,
        padding: 3,
        extrude: 2,
      }),
    );
    expect(pack.pages).toHaveLength(2);
    expect(frames[0]?.canvas.offset).toEqual({ x: 3, y: 3 });
    value(
      await exportAssets(
        { asset: f.input, frames, pack: structuredClone(pack) },
        { ...task, format: ExportFormat.GenericJson },
        { encode },
      ),
    );
  });
});
