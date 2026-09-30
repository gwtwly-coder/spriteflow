// Part ZIP export tests (contract section 2 export block + section 5 :312-328):
// three pixel assertions before packing and after decode, parts.json/README
// formatting, M1 name rules, structural archive validation, cancellation and
// progress. The codec is the honest minimal PNG/ZIP implementation from
// exportCodec.ts (real formats and checksums, no third-party dependencies).
import { describe, expect, it } from "vitest";
import { createBitMask, setMaskBit } from "../src/bitmask.js";
import { assertPartPixelInvariant, exportPartAssets } from "../src/exportParts.js";
import type { InputAsset, PixelBuffer, Rect } from "../src/m1.js";
import { createPartAsset, extractPartPixels } from "../src/partAsset.js";
import type {
  BitMask,
  CharacterProgressEvent,
  PartAsset,
  PartExportFileEntry,
  PartExportTask,
} from "../src/types.js";
import { PartKind } from "../src/types.js";
import { encodePngBytes, honestCodec, readZipEntry } from "./exportCodec.js";
import { cancellableContext, context, paint, value } from "./helpers.js";

const SOURCE_SIZE = 16;

function asset16(): InputAsset {
  return {
    ref: { assetId: "fixture", revision: 1 },
    name: "fixture.png",
    sourceMime: "application/x-rgba8",
    originalSize: { width: SOURCE_SIZE, height: SOURCE_SIZE },
    scaleFromOriginal: { x: 1, y: 1 },
    pixels: {
      width: SOURCE_SIZE,
      height: SOURCE_SIZE,
      format: "rgba8",
      colorSpace: "srgb",
      alphaMode: "straight",
      data: new Uint8ClampedArray(SOURCE_SIZE * SOURCE_SIZE * 4),
    },
  };
}

function makeSource(): InputAsset {
  const source = paint(asset16(), { x: 0, y: 0, width: 8, height: 4 }, [255, 0, 0, 255]);
  const hole = (2 * SOURCE_SIZE + 2) * 4; // (2,2) inside the hair bbox, but mask-0
  source.pixels.data[hole] = 255;
  source.pixels.data[hole + 1] = 0;
  source.pixels.data[hole + 2] = 255;
  source.pixels.data[hole + 3] = 255;
  paint(source, { x: 4, y: 8, width: 8, height: 8 }, [128, 64, 32, 128]);
  // one source pixel inside the torso mask with alpha 0 (legal: alpha 0 stays 0)
  paint(source, { x: 5, y: 9, width: 1, height: 1 }, [9, 9, 9, 0]);
  return source;
}

function maskFromBits(bits: Array<readonly [number, number]>): BitMask {
  const mask = createBitMask(SOURCE_SIZE, SOURCE_SIZE);
  for (const [x, y] of bits) setMaskBit(mask, x, y, true);
  return mask;
}

let partSequence = 0;

function makePart(
  source: InputAsset,
  kind: PartKind,
  name: string,
  bits: Array<readonly [number, number]>,
): PartAsset {
  partSequence += 1;
  const created = value(
    createPartAsset(source, kind, name, {
      asset: { ...source.ref },
      mask: maskFromBits(bits),
      sourceRect: { x: 0, y: 0, width: SOURCE_SIZE, height: SOURCE_SIZE },
      predictedIou: 0.9,
      provider: "wasm",
    }),
  );
  return { ...created, id: `part_${partSequence}` };
}

function hairBits(): Array<readonly [number, number]> {
  const bits: Array<readonly [number, number]> = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 2 && y === 2) continue; // hole inside the bbox
      bits.push([x, y]);
    }
  }
  return bits;
}

function torsoBits(): Array<readonly [number, number]> {
  const bits: Array<readonly [number, number]> = [];
  for (let y = 8; y < 16; y++) {
    for (let x = 4; x < 12; x++) bits.push([x, y]);
  }
  return bits;
}

function cropRect(pixels: PixelBuffer, bounds: Rect): PixelBuffer {
  const data = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  for (let row = 0; row < bounds.height; row++) {
    const from = ((bounds.y + row) * pixels.width + bounds.x) * 4;
    data.set(pixels.data.subarray(from, from + bounds.width * 4), row * bounds.width * 4);
  }
  return { ...pixels, width: bounds.width, height: bounds.height, data };
}

interface Fixture {
  source: InputAsset;
  hair: PartAsset;
  torso: PartAsset;
  task: PartExportTask;
}

function fixture(): Fixture {
  const source = makeSource();
  const hair = makePart(source, PartKind.Hair, "hair", hairBits());
  const torso = makePart(source, PartKind.Torso, "torso", torsoBits());
  return {
    source,
    hair,
    torso,
    task: {
      names: [
        { partId: hair.id, fileName: "hair" },
        { partId: torso.id, fileName: "torso" },
      ],
    },
  };
}

describe("assertPartPixelInvariant", () => {
  it("passes an honest tight crop and reports checked/visible pixels", () => {
    const { source, hair, torso } = fixture();
    const hairTight = cropRect(value(extractPartPixels(source, hair)), {
      x: 0,
      y: 0,
      width: 8,
      height: 4,
    });
    const report = value(assertPartPixelInvariant(source, hair, hairTight));
    expect(report).toEqual({
      partId: hair.id,
      checkedPixels: 32,
      visiblePixels: 31, // the hole pixel is mask-0
      passed: true,
    });
    const torsoTight = cropRect(value(extractPartPixels(source, torso)), {
      x: 4,
      y: 8,
      width: 8,
      height: 8,
    });
    const torsoReport = value(assertPartPixelInvariant(source, torso, torsoTight));
    expect(torsoReport.checkedPixels).toBe(64);
    expect(torsoReport.visiblePixels).toBe(63); // one source alpha-0 pixel under the mask
  });

  it("fails when a mask-0 pixel inside the crop carries alpha", () => {
    const { source, hair } = fixture();
    const tight = cropRect(value(extractPartPixels(source, hair)), {
      x: 0,
      y: 0,
      width: 8,
      height: 4,
    });
    tight.data[(2 * 8 + 2) * 4 + 3] = 255; // hole pixel now visible
    const outcome = assertPartPixelInvariant(source, hair, tight);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("PART_PIXEL_INVARIANT_FAILED");
    expect(outcome.error.details.partIds).toEqual([hair.id]);
  });

  it("fails when a visible pixel's RGB differs from the source", () => {
    const { source, hair } = fixture();
    const tight = cropRect(value(extractPartPixels(source, hair)), {
      x: 0,
      y: 0,
      width: 8,
      height: 4,
    });
    tight.data[0] = 254; // R channel of pixel (0,0)
    const outcome = assertPartPixelInvariant(source, hair, tight);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("PART_PIXEL_INVARIANT_FAILED");
  });

  it("fails when output alpha exceeds the source alpha", () => {
    const { source, torso } = fixture();
    const tight = cropRect(value(extractPartPixels(source, torso)), {
      x: 4,
      y: 8,
      width: 8,
      height: 8,
    });
    tight.data[3] = 200; // source alpha is 128 in the torso region
    const outcome = assertPartPixelInvariant(source, torso, tight);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("PART_PIXEL_INVARIANT_FAILED");
  });

  it("fails on tight crop dimension mismatch", () => {
    const { source, hair } = fixture();
    const tight = cropRect(value(extractPartPixels(source, hair)), {
      x: 0,
      y: 0,
      width: 4,
      height: 4,
    });
    const outcome = assertPartPixelInvariant(source, hair, tight);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("PART_PIXEL_INVARIANT_FAILED");
    expect(outcome.error.details.limit).toBe(32);
    expect(outcome.error.details.actual).toBe(16);
  });

  it("rejects an empty-mask part (no tight crop exists)", () => {
    const { source } = fixture();
    const empty = makePart(source, PartKind.Other, "empty", []);
    const onePixel = cropRect(value(extractPartPixels(source, empty)), {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    const outcome = assertPartPixelInvariant(source, empty, onePixel);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("INVALID_ARGUMENT");
  });
});

describe("exportPartAssets validation gates", () => {
  it("returns NO_PARTS for an empty part list", async () => {
    const { source } = fixture();
    const outcome = await exportPartAssets(
      source,
      [],
      { names: [] },
      honestCodec().codec,
      context(),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("NO_PARTS");
  });

  it("fails ASSET_MISMATCH when a part references another revision", async () => {
    const { source, hair, torso, task } = fixture();
    const drifted: PartAsset = { ...hair, asset: { assetId: hair.asset.assetId, revision: 99 } };
    const outcome = await exportPartAssets(
      source,
      [drifted, torso],
      task,
      honestCodec().codec,
      context(),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("ASSET_MISMATCH");
  });

  it("rejects an empty-mask part without encoding anything", async () => {
    const { source, hair } = fixture();
    const empty = makePart(source, PartKind.Other, "empty", []);
    const { codec, calls } = honestCodec();
    const outcome = await exportPartAssets(
      source,
      [empty, hair],
      {
        names: [
          { partId: empty.id, fileName: "empty" },
          { partId: hair.id, fileName: "hair" },
        ],
      },
      codec,
      context(),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("PART_EXPORT_INVALID");
    expect(outcome.error.details.partIds).toEqual([empty.id]);
    expect(calls).toEqual([]);
  });

  const invalidNameCases: Array<{ label: string; build: (f: Fixture) => PartExportTask }> = [
    {
      label: "unknown partId",
      build: (f) => ({
        names: [
          { partId: "ghost", fileName: "hair" },
          { partId: f.torso.id, fileName: "torso" },
        ],
      }),
    },
    {
      label: "count mismatch",
      build: (f) => ({ names: [{ partId: f.hair.id, fileName: "hair" }] }),
    },
    {
      label: "duplicate partId",
      build: (f) => ({
        names: [
          { partId: f.hair.id, fileName: "hair" },
          { partId: f.hair.id, fileName: "torso" },
        ],
      }),
    },
    {
      label: "duplicate case-fold",
      build: (f) => ({
        names: [
          { partId: f.hair.id, fileName: "hair" },
          { partId: f.torso.id, fileName: "HAIR" },
        ],
      }),
    },
    {
      label: "reserved device name",
      build: (f) => ({
        names: [
          { partId: f.hair.id, fileName: "con" },
          { partId: f.torso.id, fileName: "torso" },
        ],
      }),
    },
    {
      label: "reserved JS property name",
      build: (f) => ({
        names: [
          { partId: f.hair.id, fileName: "prototype" },
          { partId: f.torso.id, fileName: "torso" },
        ],
      }),
    },
    {
      label: "path separator",
      build: (f) => ({
        names: [
          { partId: f.hair.id, fileName: "a/b" },
          { partId: f.torso.id, fileName: "torso" },
        ],
      }),
    },
    {
      label: "dot segment",
      build: (f) => ({
        names: [
          { partId: f.hair.id, fileName: ".." },
          { partId: f.torso.id, fileName: "torso" },
        ],
      }),
    },
    {
      label: "empty stem",
      build: (f) => ({
        names: [
          { partId: f.hair.id, fileName: "" },
          { partId: f.torso.id, fileName: "torso" },
        ],
      }),
    },
  ];

  for (const { label, build } of invalidNameCases) {
    it(`rejects invalid name mapping: ${label}`, async () => {
      const f = fixture();
      const { codec, calls } = honestCodec();
      const outcome = await exportPartAssets(
        f.source,
        [f.hair, f.torso],
        build(f),
        codec,
        context(),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("unreachable");
      expect(outcome.error.code).toBe("PART_EXPORT_INVALID");
      expect(outcome.error.stage).toBe("validate");
      expect(calls).toEqual([]);
    });
  }
});

describe("exportPartAssets happy path", () => {
  it("produces a verified archive with manifest, README and per-part PNGs", async () => {
    const f = fixture();
    const { codec, calls } = honestCodec();
    const outcome = await exportPartAssets(f.source, [f.hair, f.torso], f.task, codec, context());
    const result = value(outcome);
    expect(result.fileName).toBe("parts_fixture_r1");
    expect(result.mime).toBe("application/zip");
    expect(result.manifest.schemaVersion).toBe("spriteflow-parts/1");
    expect(result.manifest.coordinateSystem).toBe("top-left-half-open-working-pixels");
    expect(result.manifest.asset).toEqual({ assetId: "fixture", revision: 1 });
    expect(result.manifest.sourceSize).toEqual({ width: 16, height: 16 });
    expect(result.manifest.parts).toEqual([
      {
        id: f.hair.id,
        name: "hair",
        kind: "hair",
        file: "parts/hair.png",
        bbox: { x: 0, y: 0, width: 8, height: 4 },
      },
      {
        id: f.torso.id,
        name: "torso",
        kind: "torso",
        file: "parts/torso.png",
        bbox: { x: 4, y: 8, width: 8, height: 8 },
      },
    ]);
    expect(result.files.map((entry) => entry.path)).toEqual([
      "README.txt",
      "parts.json",
      "parts/hair.png",
      "parts/torso.png",
    ]);
    expect(calls).toEqual([
      "encodePng",
      "decodePng",
      "encodePng",
      "decodePng",
      "encodeZip",
      "inspectZip",
    ]);
  });

  it("writes parts.json as UTF-8 without BOM, 2-space indent and trailing LF", async () => {
    const f = fixture();
    const result = value(
      await exportPartAssets(f.source, [f.hair, f.torso], f.task, honestCodec().codec, context()),
    );
    const raw = readZipEntry(result.archive, "parts.json");
    expect(raw[0]).toBe(0x7b); // "{" — no BOM
    const text = new TextDecoder().decode(raw);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    const lines = text.split("\n");
    expect(lines[1]?.startsWith('  "')).toBe(true);
    expect(lines[1]?.startsWith('   "')).toBe(false);
    expect(JSON.parse(text)).toEqual(result.manifest);
  });

  it("writes README.txt as LF-only text with version, layout and invariant notes", async () => {
    const f = fixture();
    const result = value(
      await exportPartAssets(f.source, [f.hair, f.torso], f.task, honestCodec().codec, context()),
    );
    const text = new TextDecoder().decode(readZipEntry(result.archive, "README.txt"));
    expect(text.includes("\r")).toBe(false);
    expect(text).toContain("3.0.0");
    expect(text).toContain("parts.json");
    expect(text).toContain("half-open");
    expect(text).toContain("No blur");
  });

  it("round-trips the exact encoded PNG bytes through the archive", async () => {
    const f = fixture();
    const result = value(
      await exportPartAssets(f.source, [f.hair, f.torso], f.task, honestCodec().codec, context()),
    );
    const tightHair = cropRect(value(extractPartPixels(f.source, f.hair)), {
      x: 0,
      y: 0,
      width: 8,
      height: 4,
    });
    const expected = new Uint8Array(encodePngBytes(tightHair));
    expect(readZipEntry(result.archive, "parts/hair.png")).toEqual(expected);
    const hairEntry = result.files.find((entry) => entry.path === "parts/hair.png");
    expect(hairEntry?.mime).toBe("image/png");
    expect(hairEntry?.byteLength).toBe(expected.byteLength);
  });

  it("defaults click-mode names to part_000 upward when names are omitted", async () => {
    const f = fixture();
    const result = value(
      await exportPartAssets(
        f.source,
        [f.hair, f.torso],
        { names: [] },
        honestCodec().codec,
        context(),
      ),
    );
    expect(result.manifest.parts.map((entry) => entry.file)).toEqual([
      "parts/part_000.png",
      "parts/part_001.png",
    ]);
    expect(result.manifest.parts[0]?.id).toBe(f.hair.id);
    expect(result.manifest.parts[1]?.id).toBe(f.torso.id);
  });
});

describe("exportPartAssets roundtrip verification", () => {
  it("fails PART_PIXEL_INVARIANT_FAILED and skips the archive when decode tampered a pixel", async () => {
    const f = fixture();
    const { codec, calls } = honestCodec({
      transformDecoded: (pixels) => {
        pixels.data[0] = (pixels.data[0] ?? 0) ^ 0xff;
        return pixels;
      },
    });
    const outcome = await exportPartAssets(f.source, [f.hair, f.torso], f.task, codec, context());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("PART_PIXEL_INVARIANT_FAILED");
    expect(calls).not.toContain("encodeZip");
  });

  it("fails when decoded dimensions differ from the tight crop", async () => {
    const f = fixture();
    const { codec } = honestCodec({ decodedSizeOverride: { width: 4, height: 4 } });
    const outcome = await exportPartAssets(f.source, [f.hair, f.torso], f.task, codec, context());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("PART_PIXEL_INVARIANT_FAILED");
  });

  it("classifies a decode crash as an invariant failure", async () => {
    const f = fixture();
    const outcome = await exportPartAssets(
      f.source,
      [f.hair, f.torso],
      f.task,
      honestCodec({ throwOn: ["decodePng"] }).codec,
      context(),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("PART_PIXEL_INVARIANT_FAILED");
  });

  it("wraps codec crashes into PART_EXPORT_INVALID", async () => {
    const f = fixture();
    for (const stage of ["encodePng", "encodeZip"] as const) {
      const outcome = await exportPartAssets(
        f.source,
        [f.hair, f.torso],
        f.task,
        honestCodec({ throwOn: [stage] }).codec,
        context(),
      );
      expect(outcome.ok, stage).toBe(false);
      if (outcome.ok) throw new Error("unreachable");
      expect(outcome.error.code).toBe("PART_EXPORT_INVALID");
    }
  });

  it("enforces the caller's maxArchiveBytes budget on the finished archive", async () => {
    const f = fixture();
    const outcome = await exportPartAssets(
      f.source,
      [f.hair, f.torso],
      f.task,
      honestCodec().codec,
      context({ maxArchiveBytes: 16 }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("ARCHIVE_LIMIT");
    expect(outcome.error.details.limit).toBe(16);
    expect(outcome.error.details.actual).toBeGreaterThan(16);
  });

  it("validates the unpacked archive structure item by item", async () => {
    const f = fixture();
    const overrides: Array<(entries: PartExportFileEntry[]) => PartExportFileEntry[]> = [
      (entries) => [...entries, { path: "parts/ghost.png", mime: "image/png", byteLength: 10 }],
      (entries) => entries.slice(1),
      (entries) =>
        entries.map((entry) =>
          entry.path === "parts/hair.png" ? { ...entry, byteLength: 3 } : entry,
        ),
      (entries) =>
        entries.map((entry) =>
          entry.path === "parts.json" ? { ...entry, mime: "text/plain" as const } : entry,
        ),
      (entries) =>
        entries.map((entry) =>
          entry.path === "parts/torso.png"
            ? { path: "PARTS/HAIR.PNG", mime: "image/png", byteLength: entry.byteLength }
            : entry,
        ),
      (entries) =>
        entries.map((entry) =>
          entry.path === "parts/torso.png"
            ? { path: "parts/../torso.png", mime: "image/png", byteLength: entry.byteLength }
            : entry,
        ),
      (entries) =>
        entries.map((entry) =>
          entry.path === "parts/torso.png"
            ? { path: "/abs/torso.png", mime: "image/png", byteLength: entry.byteLength }
            : entry,
        ),
    ];
    for (const inspectOverride of overrides) {
      const outcome = await exportPartAssets(
        f.source,
        [f.hair, f.torso],
        f.task,
        honestCodec({ inspectOverride }).codec,
        context(),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("unreachable");
      expect(outcome.error.code).toBe("PART_EXPORT_INVALID");
      expect(outcome.error.stage).toBe("archive");
    }
  });
});

describe("exportPartAssets cancellation and progress", () => {
  it("starts no codec work when already cancelled", async () => {
    const f = fixture();
    const cancellable = cancellableContext();
    cancellable.cancel();
    const { codec, calls } = honestCodec();
    const outcome = await exportPartAssets(f.source, [f.hair, f.torso], f.task, codec, cancellable);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("CANCELLED");
    expect(calls).toEqual([]);
  });

  it("propagates cancellation that happens mid-flight", async () => {
    const f = fixture();
    const cancellable = cancellableContext();
    const { codec, calls } = honestCodec({
      afterCall: (call) => {
        if (call === "encodePng") cancellable.cancel();
      },
    });
    const outcome = await exportPartAssets(f.source, [f.hair, f.torso], f.task, codec, cancellable);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("CANCELLED");
    expect(calls).not.toContain("encodeZip");
  });

  it("emits monotonic progress across crop, pixel-assert, encode and archive stages", async () => {
    const f = fixture();
    const events: CharacterProgressEvent[] = [];
    const observed = {
      ...context(),
      onProgress: (event: CharacterProgressEvent) => events.push(event),
    };
    const result = value(
      await exportPartAssets(f.source, [f.hair, f.torso], f.task, honestCodec().codec, observed),
    );
    expect(result.archive.byteLength).toBeGreaterThan(0);
    let last = 0;
    for (const event of events) {
      expect(event.overallProgress).toBeGreaterThanOrEqual(last);
      last = event.overallProgress;
    }
    const stages = [...new Set(events.map((event) => event.stage))];
    expect(stages).toEqual([
      "validate",
      "part-crop",
      "pixel-assert",
      "png-encode",
      "archive",
      "complete",
    ]);
    const final = events[events.length - 1];
    expect(final?.stage).toBe("complete");
    expect(final?.overallProgress).toBe(1);
    expect(final?.cancellable).toBe(false);
    expect(events.filter((event) => event.stage === "complete")).toHaveLength(1);
  });
});
