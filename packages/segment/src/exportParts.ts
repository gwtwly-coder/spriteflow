// Part ZIP export (docs/interface-contract-v3.md section 2 export block and
// section 5 :312-328). Root-entry-pure: PNG/ZIP codecs are injected behind
// PartExportCodec, so this module stays ES2022/TypedArray only and is
// Node-testable with an honest test codec. Pipeline: NO_PARTS gate → per-part
// tight crop (reusing extractPartPixels) → pixel invariant asserted before
// packing → codec.encodePng → codec.decodePng → invariant re-asserted on the
// decoded pixels (size/pixel mismatch = PART_PIXEL_INVARIANT_FAILED, archive
// discarded) → parts.json + README.txt → codec.encodeZip → codec.inspectZip →
// M1-style structural validation → PartExportResult.
import { getMaskBit, maskBounds } from "./bitmask.js";
import { V3_CONTRACT_VERSION, V3_PROTOCOL_VERSION } from "./defaults.js";
import { characterError, failure } from "./errors.js";
import type { AssetRef, InputAsset, PixelBuffer, Rect } from "./m1.js";
import { extractPartPixels, validatePartAsset } from "./partAsset.js";
import type {
  CharacterError,
  CharacterExecutionContext,
  CharacterOutcome,
  CharacterProgressEvent,
  PartAsset,
  PartExportCodec,
  PartExportFile,
  PartExportFileEntry,
  PartExportResult,
  PartExportTask,
  PartPixelInvariantReport,
  PartsManifest,
  PartsManifestEntry,
} from "./types.js";
import { CharacterErrorCode, CharacterStage } from "./types.js";

const MANIFEST_SCHEMA_VERSION = "spriteflow-parts/1" as const;
const MANIFEST_COORDINATE_SYSTEM = "top-left-half-open-working-pixels" as const;
const PARTS_DIR = "parts";
const MANIFEST_PATH = "parts.json";
const README_PATH = "README.txt";

// M1 frame-name rules (M1 contract :375, mirrored by pipeline input validation):
// 1..64 chars, starts with [A-Za-z0-9], then [A-Za-z0-9_-]; Windows device
// reserved names and JSON-key hazards are banned case-insensitively. The
// pipeline package does not export this validator, so the rules are
// reimplemented here verbatim (registered in the increment receipt).
const EXPORT_STEM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const EXPORT_STEM_RESERVED =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|constructor|prototype|hasownproperty)$/i;
// M1 archive path pattern (pipeline export/archive.ts): relative, single
// extension, ASCII segments only — excludes absolute paths, "..", drive letters
// and backslashes by construction.
const ARCHIVE_PATH_PATTERN = /^[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$/;

const CLICK_DEFAULT_STEM_WIDTH = 3;

type ProgressCallback = (event: CharacterProgressEvent) => void;

/** Emits monotonic overall progress and a single terminal complete event. */
class ProgressReporter {
  private lastOverall = 0;
  private done = false;

  constructor(
    private readonly taskId: string,
    private readonly onProgress: ProgressCallback,
  ) {}

  emit(
    stage: CharacterStage,
    stageProgress: number,
    overall: number,
    completedUnits = 0,
    totalUnits: number | null = null,
  ): void {
    if (this.done) return;
    this.lastOverall = Math.max(this.lastOverall, Math.min(1, Math.max(0, overall)));
    this.onProgress({
      protocolVersion: 1,
      taskId: this.taskId,
      stage,
      stageProgress: Math.min(1, Math.max(0, stageProgress)),
      overallProgress: this.lastOverall,
      completedUnits,
      totalUnits,
      cancellable: true,
    });
  }

  complete(completedUnits: number, totalUnits: number | null): void {
    if (this.done) return;
    this.done = true;
    this.onProgress({
      protocolVersion: 1,
      taskId: this.taskId,
      stage: CharacterStage.Complete,
      stageProgress: 1,
      overallProgress: 1,
      completedUnits,
      totalUnits,
      cancellable: false,
    });
  }
}

function exportError(
  code: CharacterErrorCode,
  stage: CharacterStage,
  options?: {
    recoverable?: boolean;
    partIds?: string[];
    field?: string;
    limit?: number;
    actual?: number;
  },
): CharacterError {
  const recoverable =
    options?.recoverable !== undefined ? { recoverable: options.recoverable } : {};
  return characterError(code, stage, {
    ...recoverable,
    details: {
      ...(options?.partIds !== undefined ? { partIds: options.partIds } : {}),
      ...(options?.field !== undefined ? { field: options.field } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
      ...(options?.actual !== undefined ? { actual: options.actual } : {}),
    },
  });
}

function cancelled(stage: CharacterStage): CharacterError {
  return exportError(CharacterErrorCode.Cancelled, stage, { recoverable: true });
}

function comparePath(a: { path: string }, b: { path: string }): number {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

function isValidExportStem(fileName: unknown): fileName is string {
  return (
    typeof fileName === "string" &&
    EXPORT_STEM_PATTERN.test(fileName) &&
    !EXPORT_STEM_RESERVED.test(fileName)
  );
}

/** Result.fileName: deterministic, name-rule-safe stem derived from the asset ref. */
function deriveResultFileName(asset: AssetRef): string {
  return `parts_${asset.assetId}_r${asset.revision}`;
}

/**
 * Root-pure UTF-8 encoder (no DOM TextEncoder): the root entry must compile
 * with lib ES2022 only. Encodes full code points, 1..4 bytes each.
 */
function utf8Bytes(text: string): ArrayBuffer {
  const bytes: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes).buffer;
}

function cropTightPixels(pixels: PixelBuffer, bounds: Rect): PixelBuffer {
  const data = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  for (let row = 0; row < bounds.height; row++) {
    const sourceRow = ((bounds.y + row) * pixels.width + bounds.x) * 4;
    data.set(pixels.data.subarray(sourceRow, sourceRow + bounds.width * 4), row * bounds.width * 4);
  }
  return {
    width: bounds.width,
    height: bounds.height,
    format: pixels.format,
    colorSpace: pixels.colorSpace,
    alphaMode: pixels.alphaMode,
    data,
  };
}

/**
 * Three pixel assertions on a tight crop against the source working image
 * (:246, :327): (a) every mask-0 pixel must have alpha 0; (b) every pixel must
 * keep alpha at or below the source alpha at the corresponding coordinate
 * (source alpha 0 forces output alpha 0); (c) every alpha>0 pixel must be
 * mask-1 and byte-equal to the source RGB. tight crop source coordinates are
 * part.sourceRect + maskBounds origin + tightCropLocalPoint.
 */
export function assertPartPixelInvariant(
  source: InputAsset,
  part: PartAsset,
  tightPixels: PixelBuffer,
): CharacterOutcome<PartPixelInvariantReport> {
  const stage = CharacterStage.PixelAssert;
  const validated = validatePartAsset(source, part);
  if (!validated.ok) return validated;
  const bounds = maskBounds(part.mask);
  if (bounds === null) {
    return failure(
      exportError(CharacterErrorCode.InvalidArgument, stage, {
        recoverable: false,
        partIds: [part.id],
        field: "part.mask.empty",
      }),
    );
  }
  const dimensionsMatch =
    tightPixels.width === bounds.width && tightPixels.height === bounds.height;
  const dataValid =
    tightPixels.data instanceof Uint8ClampedArray &&
    tightPixels.data.length === tightPixels.width * tightPixels.height * 4;
  if (!dimensionsMatch || !dataValid) {
    return failure(
      exportError(CharacterErrorCode.PartPixelInvariantFailed, stage, {
        recoverable: false,
        partIds: [part.id],
        limit: bounds.width * bounds.height,
        actual: tightPixels.width * tightPixels.height,
      }),
    );
  }
  let visiblePixels = 0;
  const checkedPixels = bounds.width * bounds.height;
  for (let ly = 0; ly < bounds.height; ly++) {
    for (let lx = 0; lx < bounds.width; lx++) {
      const tightOffset = (ly * bounds.width + lx) * 4;
      const alpha = tightPixels.data[tightOffset + 3] ?? 0;
      if (!getMaskBit(part.mask, bounds.x + lx, bounds.y + ly)) {
        // (a) outside the mask the exported pixel must be fully transparent.
        if (alpha !== 0) {
          return failure(
            exportError(CharacterErrorCode.PartPixelInvariantFailed, stage, {
              recoverable: false,
              partIds: [part.id],
              field: "mask.alpha",
            }),
          );
        }
        continue;
      }
      const sourceOffset =
        ((part.sourceRect.y + bounds.y + ly) * source.pixels.width +
          part.sourceRect.x +
          bounds.x +
          lx) *
        4;
      const sourceAlpha = source.pixels.data[sourceOffset + 3] ?? 0;
      // (b) alpha may never exceed the source alpha at the same coordinate.
      if (alpha > sourceAlpha) {
        return failure(
          exportError(CharacterErrorCode.PartPixelInvariantFailed, stage, {
            recoverable: false,
            partIds: [part.id],
            field: "alpha.upperBound",
          }),
        );
      }
      if (alpha === 0) continue;
      // (c) visible pixels copy the source RGB bytes verbatim.
      for (let channel = 0; channel < 3; channel++) {
        if (
          (tightPixels.data[tightOffset + channel] ?? 0) !==
          (source.pixels.data[sourceOffset + channel] ?? 0)
        ) {
          return failure(
            exportError(CharacterErrorCode.PartPixelInvariantFailed, stage, {
              recoverable: false,
              partIds: [part.id],
              field: "rgb.equality",
            }),
          );
        }
      }
      visiblePixels += 1;
    }
  }
  return { ok: true, value: { partId: part.id, checkedPixels, visiblePixels, passed: true } };
}

interface PreparedPart {
  part: PartAsset;
  bounds: Rect;
  tight: PixelBuffer;
  png: ArrayBuffer;
  path: string;
}

function validateTask(
  parts: PartAsset[],
  task: PartExportTask,
): { ok: true; names: Map<string, string> } | { ok: false; error: CharacterError } {
  const bad = (field: string): CharacterError =>
    exportError(CharacterErrorCode.PartExportInvalid, CharacterStage.Validate, {
      recoverable: false,
      field,
    });
  if (typeof task !== "object" || task === null || !Array.isArray(task.names)) {
    return { ok: false, error: bad("task.names") };
  }
  const partIds = new Set(parts.map((part) => part.id));
  if (partIds.size !== parts.length) {
    return { ok: false, error: bad("parts.duplicateId") };
  }
  // Click mode default (:327): with no explicit names the package assigns
  // part_000 upward, zero-padded, in parts order.
  const names = new Map<string, string>();
  if (task.names.length === 0) {
    let index = 0;
    for (const part of parts) {
      names.set(part.id, `part_${String(index).padStart(CLICK_DEFAULT_STEM_WIDTH, "0")}`);
      index += 1;
    }
    return { ok: true, names };
  }
  if (task.names.length !== parts.length) {
    return { ok: false, error: bad("task.names.count") };
  }
  const caseFolded = new Set<string>();
  for (const entry of task.names) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.partId !== "string" ||
      !partIds.has(entry.partId) ||
      names.has(entry.partId)
    ) {
      return { ok: false, error: bad("task.names.partId") };
    }
    if (!isValidExportStem(entry.fileName)) {
      return { ok: false, error: bad("task.names.fileName") };
    }
    const folded = entry.fileName.toLowerCase();
    if (caseFolded.has(folded)) {
      return { ok: false, error: bad("task.names.caseConflict") };
    }
    caseFolded.add(folded);
    names.set(entry.partId, entry.fileName);
  }
  if (names.size !== parts.length) {
    return { ok: false, error: bad("task.names.count") };
  }
  return { ok: true, names };
}

function buildReadme(): string {
  return [
    "SpriteFlow part export",
    `Generated by @spriteflow/segment (contract ${V3_CONTRACT_VERSION}, protocol ${V3_PROTOCOL_VERSION})`,
    "",
    "Directory layout:",
    "  parts/<fileName>.png  One RGBA8 PNG per confirmed part, 1:1 with the source region, no scaling.",
    "  parts.json            Parts manifest (schemaVersion spriteflow-parts/1) mapping part ids to PNG files and source bboxes.",
    "  README.txt            This file.",
    "",
    "Coordinate rules:",
    "  All bboxes are source working-image pixels, top-left origin, half-open ranges [x, x+width) x [y, y+height).",
    "  PNG pixel (0,0) corresponds to the part bbox top-left corner in the source working image.",
    "",
    "Pixel invariant:",
    "  Where the part mask is 1, exported pixels keep the exact source RGBA bytes; where the mask is 0,",
    "  pixels are fully transparent (0,0,0,0). No blur, color fill, alpha feathering, interpolation,",
    "  palette conversion or model-generated pixels are introduced by v3.0 segmentation.",
    "  The three pixel assertions run before packing and again after PNG encode/decode;",
    "  any mismatch aborts the export and no archive is returned.",
    "",
  ].join("\n");
}

function validateArchiveEntries(
  inspected: PartExportFileEntry[],
  expected: PartExportFile[],
): CharacterError | null {
  const bad = (field: string) =>
    exportError(CharacterErrorCode.PartExportInvalid, CharacterStage.Archive, {
      recoverable: false,
      field,
    });
  if (inspected.length !== expected.length) {
    return bad("archive.entryCount");
  }
  const expectedByPath = new Map<string, PartExportFile>();
  for (const file of expected) expectedByPath.set(file.path, file);
  const seen = new Set<string>();
  for (const entry of inspected) {
    if (typeof entry?.path !== "string" || !ARCHIVE_PATH_PATTERN.test(entry.path)) {
      return bad("archive.path");
    }
    if (entry.path.startsWith("/") || entry.path.includes("..")) {
      return bad("archive.path");
    }
    const folded = entry.path.toLowerCase();
    if (seen.has(folded)) {
      return bad("archive.duplicatePath");
    }
    seen.add(folded);
    const expectedFile = expectedByPath.get(entry.path);
    if (expectedFile === undefined) {
      return bad("archive.unexpectedEntry");
    }
    if (entry.mime !== expectedFile.mime) {
      return bad("archive.mime");
    }
    if (entry.byteLength !== expectedFile.bytes.byteLength) {
      return exportError(CharacterErrorCode.PartExportInvalid, CharacterStage.Archive, {
        recoverable: false,
        field: "archive.byteLength",
        limit: expectedFile.bytes.byteLength,
        actual: entry.byteLength,
      });
    }
  }
  return null;
}

/**
 * Full part ZIP export. The injected codec must implement the archive
 * requirements from the contract (:327): PNG entries stored (method 0),
 * parts.json/README.txt deflate level 6, entries sorted by path, mtime fixed
 * to 1980-01-01, no permission bits/absolute paths; encodeZip/inspectZip must
 * round-trip losslessly so the structural checks below are meaningful.
 */
export async function exportPartAssets(
  source: InputAsset,
  parts: PartAsset[],
  task: PartExportTask,
  codec: PartExportCodec,
  context: CharacterExecutionContext,
): Promise<CharacterOutcome<PartExportResult>> {
  if (context.isCancelled()) return failure(cancelled(CharacterStage.Validate));
  if (!Array.isArray(parts) || parts.length === 0) {
    return failure(
      exportError(CharacterErrorCode.NoParts, CharacterStage.Validate, { recoverable: false }),
    );
  }
  for (const part of parts) {
    const validated = validatePartAsset(source, part);
    if (!validated.ok) return validated;
  }
  const names = validateTask(parts, task);
  if (!names.ok) return failure(names.error);

  const reporter = new ProgressReporter(context.taskId, context.onProgress);
  reporter.emit(CharacterStage.Validate, 1, 0.05);
  const total = parts.length;
  const prepared: PreparedPart[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === undefined) break;
    const stem = names.names.get(part.id);
    if (stem === undefined) {
      return failure(
        exportError(CharacterErrorCode.PartExportInvalid, CharacterStage.Validate, {
          recoverable: false,
          partIds: [part.id],
          field: "task.names.missing",
        }),
      );
    }
    const bounds = maskBounds(part.mask);
    if (bounds === null) {
      // Empty masks never enter the exportable set and never silently drop a
      // PNG (:250).
      return failure(
        exportError(CharacterErrorCode.PartExportInvalid, CharacterStage.PartCrop, {
          recoverable: false,
          partIds: [part.id],
          field: "part.mask.empty",
        }),
      );
    }
    const within = (index + 1) / Math.max(1, total);
    reporter.emit(CharacterStage.PartCrop, within, 0.05 + 0.2 * within, index + 1, total);
    const extracted = extractPartPixels(source, part);
    if (!extracted.ok) return extracted;
    const tight = cropTightPixels(extracted.value, bounds);
    reporter.emit(CharacterStage.PixelAssert, within, 0.25 + 0.1 * within, index + 1, total);
    const beforePack = assertPartPixelInvariant(source, part, tight);
    if (!beforePack.ok) return beforePack;
    if (context.isCancelled()) return failure(cancelled(CharacterStage.PngEncode));
    reporter.emit(CharacterStage.PngEncode, within, 0.35 + 0.2 * within, index + 1, total);
    let png: ArrayBuffer;
    try {
      png = await codec.encodePng(tight, context);
    } catch {
      return failure(
        exportError(CharacterErrorCode.PartExportInvalid, CharacterStage.PngEncode, {
          recoverable: true,
          partIds: [part.id],
          field: "codec.encodePng",
        }),
      );
    }
    if (context.isCancelled()) return failure(cancelled(CharacterStage.PngEncode));
    let decoded: PixelBuffer;
    try {
      decoded = await codec.decodePng(png, context);
    } catch {
      return failure(
        exportError(CharacterErrorCode.PartPixelInvariantFailed, CharacterStage.PixelAssert, {
          recoverable: false,
          partIds: [part.id],
          field: "codec.decodePng",
        }),
      );
    }
    const afterDecode = assertPartPixelInvariant(source, part, decoded);
    if (!afterDecode.ok) return afterDecode;
    prepared.push({
      part,
      bounds,
      tight,
      png,
      path: `${PARTS_DIR}/${stem}.png`,
    });
  }

  if (context.isCancelled()) return failure(cancelled(CharacterStage.Archive));
  const assetRef: AssetRef = {
    assetId: source.ref.assetId,
    revision: source.ref.revision,
  };
  const manifest: PartsManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    coordinateSystem: MANIFEST_COORDINATE_SYSTEM,
    asset: assetRef,
    sourceSize: { width: source.pixels.width, height: source.pixels.height },
    parts: prepared.map((entry): PartsManifestEntry => {
      const part = entry.part;
      return {
        id: part.id,
        name: part.name,
        kind: part.kind,
        file: entry.path,
        bbox: {
          x: part.sourceRect.x + entry.bounds.x,
          y: part.sourceRect.y + entry.bounds.y,
          width: entry.bounds.width,
          height: entry.bounds.height,
        },
      };
    }),
  };
  // UTF-8, no BOM, 2-space indent, trailing LF (:327).
  const manifestBytes = utf8Bytes(`${JSON.stringify(manifest, null, 2)}\n`);
  const readmeBytes = utf8Bytes(buildReadme());
  const files: PartExportFile[] = [
    ...prepared.map((entry) => ({
      path: entry.path,
      mime: "image/png" as const,
      bytes: entry.png,
    })),
    { path: MANIFEST_PATH, mime: "application/json" as const, bytes: manifestBytes },
    { path: README_PATH, mime: "text/plain" as const, bytes: readmeBytes },
  ].sort(comparePath);

  reporter.emit(CharacterStage.Archive, 0, 0.55);
  let archive: ArrayBuffer;
  try {
    archive = await codec.encodeZip(files, context);
  } catch {
    return failure(
      exportError(CharacterErrorCode.PartExportInvalid, CharacterStage.Archive, {
        recoverable: true,
        field: "codec.encodeZip",
      }),
    );
  }
  if (context.isCancelled()) return failure(cancelled(CharacterStage.Archive));
  // M1-inherited resource limit: the finished archive must fit the caller's
  // maxArchiveBytes budget, reporting actual/limit (:879).
  if (archive.byteLength > context.limits.maxArchiveBytes) {
    return failure(
      exportError(CharacterErrorCode.ArchiveLimit, CharacterStage.Archive, {
        recoverable: true,
        limit: context.limits.maxArchiveBytes,
        actual: archive.byteLength,
      }),
    );
  }
  reporter.emit(CharacterStage.Archive, 0.5, 0.75, files.length, files.length);
  let inspected: PartExportFileEntry[];
  try {
    inspected = await codec.inspectZip(archive, context);
  } catch {
    return failure(
      exportError(CharacterErrorCode.PartExportInvalid, CharacterStage.Archive, {
        recoverable: true,
        field: "codec.inspectZip",
      }),
    );
  }
  const structureError = validateArchiveEntries(inspected, files);
  if (structureError !== null) return failure(structureError);
  reporter.emit(CharacterStage.Archive, 1, 0.95, files.length, files.length);
  reporter.complete(files.length, files.length);
  return {
    ok: true,
    value: {
      fileName: deriveResultFileName(assetRef),
      mime: "application/zip",
      archive,
      files: [...inspected].sort(comparePath),
      manifest,
    },
  };
}
