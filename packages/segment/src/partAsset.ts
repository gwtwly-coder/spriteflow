// PartAsset pure functions (docs/interface-contract-v3.md section 2, :229-246):
// validation, pixel-invariant extraction, SAM result wrapping, immutable removal.
import { countSetBits, getMaskBit, validateBitMask } from "./bitmask.js";
import { characterError, failure } from "./errors.js";
import type { AssetRef, InputAsset, PixelBuffer, Rect } from "./m1.js";
import {
  CharacterErrorCode,
  type CharacterOutcome,
  CharacterStage,
  type PartAsset,
  type PartCanvas,
  type PartId,
  PartKind,
  type SamMaskResult,
} from "./types.js";

const PART_KIND_VALUES: ReadonlySet<string> = new Set<string>(Object.values(PartKind));

export function isPartKind(value: unknown): value is PartKind {
  return typeof value === "string" && PART_KIND_VALUES.has(value);
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isIntegerRect(value: unknown): value is Rect {
  if (typeof value !== "object" || value === null) return false;
  const rect = value as Partial<Rect>;
  return (
    Number.isInteger(rect.x) &&
    Number.isInteger(rect.y) &&
    Number.isInteger(rect.width) &&
    Number.isInteger(rect.height)
  );
}

function refsEqual(a: AssetRef, b: AssetRef): boolean {
  return a.assetId === b.assetId && a.revision === b.revision;
}

function isPartCanvas(value: unknown): value is PartCanvas {
  if (typeof value !== "object" || value === null) return false;
  const canvas = value as Partial<PartCanvas>;
  return (
    Number.isInteger(canvas.width) &&
    Number.isInteger(canvas.height) &&
    typeof canvas.offset === "object" &&
    canvas.offset !== null &&
    Number.isInteger(canvas.offset.x) &&
    Number.isInteger(canvas.offset.y)
  );
}

function sourceRectOutOfBounds(sourceRect: Rect, assetWidth: number, assetHeight: number): boolean {
  return (
    sourceRect.x < 0 ||
    sourceRect.y < 0 ||
    sourceRect.width < 1 ||
    sourceRect.height < 1 ||
    sourceRect.x + sourceRect.width > assetWidth ||
    sourceRect.y + sourceRect.height > assetHeight
  );
}

function argumentError(
  stage: CharacterStage,
  field: string,
  limit?: number,
  actual?: number,
): CharacterOutcome<never> {
  const details: { field: string; limit?: number; actual?: number } = { field };
  if (limit !== undefined) details.limit = limit;
  if (actual !== undefined) details.actual = actual;
  return failure(characterError(CharacterErrorCode.InvalidArgument, stage, { details }));
}

/**
 * Validates part identity, asset reference, sourceRect, canvas (v3.0: fixed to
 * sourceRect size, offset (0,0)) and the mask bitset against the source asset.
 */
export function validatePartAsset(asset: InputAsset, part: PartAsset): CharacterOutcome<void> {
  const stage = CharacterStage.Validate;
  if (typeof part.id !== "string" || part.id.length === 0) {
    return argumentError(stage, "part.id");
  }
  if (typeof part.name !== "string" || part.name.length === 0) {
    return argumentError(stage, "part.name");
  }
  if (!isPartKind(part.kind)) {
    return argumentError(stage, "part.kind");
  }
  if (
    typeof part.asset !== "object" ||
    part.asset === null ||
    typeof asset.ref !== "object" ||
    !refsEqual(part.asset, asset.ref)
  ) {
    return failure(
      characterError(CharacterErrorCode.AssetMismatch, stage, { details: { field: "part.asset" } }),
    );
  }
  if (!isIntegerRect(part.sourceRect)) {
    return argumentError(stage, "part.sourceRect");
  }
  if (sourceRectOutOfBounds(part.sourceRect, asset.pixels.width, asset.pixels.height)) {
    return argumentError(
      stage,
      "part.sourceRect",
      asset.pixels.width * asset.pixels.height,
      part.sourceRect.width * part.sourceRect.height,
    );
  }
  const structure = validateBitMask(part.mask, part.sourceRect.width, part.sourceRect.height);
  if (!structure.ok) {
    return structure;
  }
  if (!isPartCanvas(part.canvas)) {
    return argumentError(stage, "part.canvas");
  }
  if (
    part.canvas.width !== part.sourceRect.width ||
    part.canvas.height !== part.sourceRect.height
  ) {
    return argumentError(stage, "part.canvas.size", part.sourceRect.width, part.canvas.width);
  }
  if (part.canvas.offset.x !== 0 || part.canvas.offset.y !== 0) {
    return argumentError(stage, "part.canvas.offset");
  }
  if (!isUnitInterval(part.confidence)) {
    return argumentError(stage, "part.confidence");
  }
  if (!isUnitInterval(part.visibleFraction)) {
    return argumentError(stage, "part.visibleFraction");
  }
  return { ok: true, value: undefined };
}

/**
 * Pixel-invariant extraction: the returned PixelBuffer is sourceRect-sized; every
 * mask=1 pixel copies the source RGBA verbatim (all four bytes, so source alpha=0
 * stays alpha=0), every mask=0 pixel is fully transparent (0,0,0,0). The input
 * asset is never modified.
 */
export function extractPartPixels(
  asset: InputAsset,
  part: PartAsset,
): CharacterOutcome<PixelBuffer> {
  const validated = validatePartAsset(asset, part);
  if (!validated.ok) return validated;
  const { sourceRect } = part;
  const width = sourceRect.width;
  const height = sourceRect.height;
  const source = asset.pixels.data;
  const sourceWidth = asset.pixels.width;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceRow = (sourceRect.y + y) * sourceWidth + sourceRect.x;
    for (let x = 0; x < width; x++) {
      if (!getMaskBit(part.mask, x, y)) continue;
      const sourceOffset = (sourceRow + x) * 4;
      const targetOffset = (y * width + x) * 4;
      data[targetOffset] = source[sourceOffset] ?? 0;
      data[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
      data[targetOffset + 2] = source[sourceOffset + 2] ?? 0;
      data[targetOffset + 3] = source[sourceOffset + 3] ?? 0;
    }
  }
  const pixels: PixelBuffer = {
    width,
    height,
    format: "rgba8",
    colorSpace: "srgb",
    alphaMode: "straight",
    data,
  };
  return { ok: true, value: pixels };
}

let nextPartSequence = 0;

/**
 * Package-generated stable unique part ID; LLM-provided IDs are never trusted and
 * SAM results never carry one, so a fresh identifier is minted per call.
 */
function generatePartId(): string {
  nextPartSequence += 1;
  const sequence = nextPartSequence.toString(36).padStart(3, "0");
  const random = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `part_${sequence}_${random}`;
}

/**
 * Wraps a SAM mask (source working-image coordinates) into a PartAsset owned by
 * the package. Validates result.asset === source.ref and the mask geometry; the
 * mask bytes are copied, so later in-place SAM edits cannot leak into the part.
 * An all-zero mask is a legal result here; callers attach EMPTY_MASK warnings.
 */
export function createPartAsset(
  source: InputAsset,
  kind: PartKind,
  name: string,
  result: SamMaskResult,
): CharacterOutcome<PartAsset> {
  const stage = CharacterStage.MaskPostprocess;
  if (!isPartKind(kind)) {
    return argumentError(stage, "kind");
  }
  if (typeof name !== "string" || name.length === 0) {
    return argumentError(stage, "name");
  }
  if (
    typeof result.asset !== "object" ||
    result.asset === null ||
    typeof source.ref !== "object" ||
    !refsEqual(result.asset, source.ref)
  ) {
    return failure(
      characterError(CharacterErrorCode.AssetMismatch, stage, {
        details: { field: "result.asset" },
      }),
    );
  }
  if (!isIntegerRect(result.sourceRect)) {
    return argumentError(stage, "result.sourceRect");
  }
  if (sourceRectOutOfBounds(result.sourceRect, source.pixels.width, source.pixels.height)) {
    return argumentError(stage, "result.sourceRect");
  }
  const structure = validateBitMask(result.mask, result.sourceRect.width, result.sourceRect.height);
  if (!structure.ok) {
    return structure;
  }
  if (!isUnitInterval(result.predictedIou)) {
    return argumentError(stage, "result.predictedIou");
  }
  if (result.provider !== "webgpu" && result.provider !== "wasm") {
    return argumentError(stage, "result.provider");
  }
  const total = result.sourceRect.width * result.sourceRect.height;
  const setBits = countSetBits(result.mask);
  const part: PartAsset = {
    id: generatePartId(),
    asset: { assetId: source.ref.assetId, revision: source.ref.revision },
    name,
    kind,
    sourceRect: {
      x: result.sourceRect.x,
      y: result.sourceRect.y,
      width: result.sourceRect.width,
      height: result.sourceRect.height,
    },
    mask: {
      width: result.mask.width,
      height: result.mask.height,
      encoding: result.mask.encoding,
      data: result.mask.data.slice(),
    },
    canvas: {
      width: result.sourceRect.width,
      height: result.sourceRect.height,
      offset: { x: 0, y: 0 },
    },
    confidence: result.predictedIou,
    occluded: false,
    visibleFraction: total === 0 ? 0 : setBits / total,
  };
  return { ok: true, value: part };
}

/**
 * Returns a new array without the part(s) with the given ID; the input array and
 * its parts are untouched (undo stacks keep holding the previous array).
 */
export function removePartAsset(parts: PartAsset[], partId: PartId): CharacterOutcome<PartAsset[]> {
  const stage = CharacterStage.PartCrop;
  if (typeof partId !== "string" || partId.length === 0) {
    return argumentError(stage, "partId");
  }
  if (!Array.isArray(parts) || !parts.some((part) => part.id === partId)) {
    return failure(
      characterError(CharacterErrorCode.InvalidArgument, stage, { details: { field: "partId" } }),
    );
  }
  return { ok: true, value: parts.filter((part) => part.id !== partId) };
}
